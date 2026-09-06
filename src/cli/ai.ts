import { homedir } from "node:os";
import { join } from "node:path";
import type { DataLoader } from "../engine/data.js";
import { HttpHiseConnection, type HiseConnection } from "../engine/hise.js";
import { CapturingHiseConnection } from "./capture.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import { createSession } from "../session-bootstrap.js";
import { classifyAgentCommand } from "./agentContext.js";
import { RestMcpClient } from "../mcp/restClient.js";
import { executeCliCommand } from "./run.js";
import { listCliCommands } from "./commands.js";
import { createHiseCommandTool, createHiseResearchTool, createHiseHelpTool, createHiseScriptTool, createJsTool, type HiseCliRunner, type HiseCliResult } from "./ai-tools.js";
import { HISESCRIPT_CHEAT_SHEET } from "./ai-guidance.js";
import { COMPACT_CLI_CONTRACT } from "./generated-ai-contract.js";
import { registerPiOAuthFlows } from "./pi-runtime.js";

const AGENT_TIMEOUT_MS = 15 * 60_000;
export function isMutatingCliCommand(argv: string[]): boolean {
	return classifyAgentCommand(argv) !== "read-only";
}
const HISE_AGENT_PROMPT = `You are an embedded HISE development agent. Running HISE is the source of truth; this is not a repository exploration task.
For routine builder, UI, DSP, project, and script operations: call hise_help for the relevant mode first, inspect only the minimum live HISE state with hise_command, then mutate and verify with hise_command. Use canonical argv arrays without the executable or --agent. Never search project files to discover HISE state or CLI syntax.
Use hise_research only when hise_help and live inspection cannot answer an unfamiliar HISE API or semantic question, or when the user explicitly asks for documentation or examples. Do not use it for ordinary command syntax, node/component discovery, or routine add/set/connect operations.
Use hise_script only for callback and included external-file edits. Use js only when the user explicitly requests project-file data processing or media inspection. Keep the task focused, avoid speculative calls, correct one failed command from its exact error, and stop after one successful verification.

${HISESCRIPT_CHEAT_SHEET}

${COMPACT_CLI_CONTRACT}`;

export interface AiCommandFlags {
	json: boolean;
	mock: boolean;
	apply: boolean;
	agentDir: string;
	model?: string;
	command: string;
}

function parseAiArgs(argv: string[]): AiCommandFlags | { error: string } {
	let json = false;
	let mock = false;
	let apply = false;
	let agentDir = join(homedir(), ".hise", "agent");
	let model: string | undefined;
	const positional: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--json") json = true;
		else if (arg === "--mock") mock = true;
		else if (arg === "--apply") apply = true;
		else if (arg === "--agent-dir") {
			const value = argv[++i];
			if (!value) return { error: "--agent-dir requires a path" };
			agentDir = value;
		} else if (arg === "--model") {
			const value = argv[++i];
			if (!value) return { error: "--model requires provider/model-id" };
			model = value;
		} else positional.push(arg);
	}
	if (positional.length === 0) return { error: 'usage: hise-cli ai [--apply] [--json] [--mock] [--agent-dir <path>] [--model provider/id] "<request>"' };
	return { json, mock, apply, agentDir, model, command: positional.join(" ") };
}

function flag(argv: string[], name: string): string | undefined {
	const index = argv.indexOf(name);
	return index >= 0 ? argv[index + 1] : undefined;
}

export async function runCanonical(
	argv: string[],
	stdin: string | undefined,
	connection: HiseConnection,
	dataLoader: DataLoader,
	cliCommands: import("../engine/commands/registry.js").CommandEntry[],
): Promise<HiseCliResult> {
	const args = argv[0] === "hise-cli" ? argv.slice(1) : argv.slice();
	if (args.includes("--agent")) args.splice(args.indexOf("--agent"), 1);

	// The normal dispatcher reads stdin from the process. The embedded tool
	// supplies it directly for callback writes instead.
	if (stdin !== undefined && args[0] === "script" && args[1] === "set") {
		const moduleId = flag(args, "--module-id");
		const callback = flag(args, "--callback");
		if (!moduleId || !callback || !args.includes("--stdin")) {
			return { ok: false, text: "script set --stdin requires --module-id and --callback", error: "invalid script set arguments" };
		}
		const response = await connection.post("/api/set_script", {
			moduleId,
			callbacks: { [callback]: stdin },
		});
		const payload = response as unknown as Record<string, unknown>;
		const ok = payload.success === true && (!Array.isArray(payload.errors) || payload.errors.length === 0);
		const text = JSON.stringify({ ok, value: payload }, null, 1);
		return ok ? { ok: true, text } : { ok: false, text, error: String(payload.result ?? "script set failed") };
	}

	const result = await executeCliCommand(
		["node", "hise-cli", ...args, "--agent"],
		cliCommands,
		dataLoader,
		{ connectionOverride: connection },
	);
	if (result.kind === "json") {
		const text = JSON.stringify(result.payload, null, 1);
		return result.payload.ok
			? { ok: true, text }
			: { ok: false, text, error: "error" in result.payload ? result.payload.error : text };
	}
	if (result.kind === "error") return { ok: false, text: result.message, error: result.message };
	if (result.kind === "help") return { ok: true, text: result.scope ?? "" };
	if (result.kind === "text") return { ok: true, text: result.text };
	return { ok: false, text: JSON.stringify(result), error: "unsupported CLI result" };
}

export async function runAiCommand(argv: string[], deps: { dataLoader: DataLoader }): Promise<void> {
	registerPiOAuthFlows();
	const parsed = parseAiArgs(argv);
	if ("error" in parsed) {
		process.stderr.write(parsed.error + "\n");
		process.exitCode = 1;
		return;
	}

	const mockRuntime = parsed.mock ? createDefaultMockRuntime() : null;
	const connection = new CapturingHiseConnection(mockRuntime?.connection ?? new HttpHiseConnection());
	let projectDir = process.cwd();
	try {
		const status = await connection.get("/api/status") as unknown as { project?: { projectFolder?: string } };
		if (status.project?.projectFolder) projectDir = status.project.projectFolder;
	} catch { /* agent can still operate without project metadata */ }

	const bootstrap = createSession({ connection, forLlm: true, enableLlm: false });
	const cliCommands = listCliCommands(bootstrap.session.allCommands());
	const runner: HiseCliRunner = {
		run: async (commandArgv, stdin) => {
			if (!parsed.apply && isMutatingCliCommand(commandArgv)) {
				const text = "Mutation blocked: rerun hise-cli ai with --apply to permit writes.";
				return { ok: false, text, error: text };
			}
			return runCanonical(commandArgv, stdin, connection, deps.dataLoader, cliCommands);
		},
	};
	const pi = await import("@earendil-works/pi-coding-agent");
	const settingsManager = pi.SettingsManager.create(projectDir, parsed.agentDir);
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: projectDir,
		agentDir: parsed.agentDir,
		settingsManager,
		systemPrompt: HISE_AGENT_PROMPT,
	});
	await resourceLoader.reload();
	const { session: piSession, modelFallbackMessage } = await pi.createAgentSession({
		cwd: projectDir,
		agentDir: parsed.agentDir,
		resourceLoader,
		settingsManager,
		sessionManager: pi.SessionManager.inMemory(projectDir),
		tools: ["hise_command", "hise_help", "hise_research", "hise_script", "js"],
		customTools: [
			createHiseCommandTool(runner),
			createHiseHelpTool(),
			createHiseResearchTool({ mcpClient: new RestMcpClient({ defaultUrl: process.env.HISE_DOCS_API_URL ?? process.env.HISE_MCP_URL }), connection, cwd: projectDir, agentDir: parsed.agentDir }),
			createHiseScriptTool({ connection, projectDir }),
			createJsTool({ projectDir, allowWrites: parsed.apply }),
		],
	});

	const toolCalls = new Map<string, { name: string; args?: unknown; error?: boolean }>();
	const debug = process.env.HISE_AI_DEBUG === "1";
	let settleTimeout: ReturnType<typeof setTimeout> | undefined;
	let unsubscribe: (() => void) | undefined;
	const settled = new Promise<void>((resolve, reject) => {
		settleTimeout = setTimeout(() => {
			piSession.abort();
			reject(new Error(`agent did not settle within ${Math.round(AGENT_TIMEOUT_MS / 1000)}s`));
		}, AGENT_TIMEOUT_MS);
		unsubscribe = piSession.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				toolCalls.set(event.toolCallId, { name: event.toolName, args: event.args });
				if (!parsed.json) process.stderr.write(`→ ${event.toolName} ${JSON.stringify(event.args ?? {})}\n`);
			} else if (event.type === "tool_execution_end") {
				const call = toolCalls.get(event.toolCallId) ?? { name: event.toolName };
				call.error = event.isError;
				if (!parsed.json) process.stderr.write(`${event.isError ? "✗" : "✓"} ${event.toolName}\n`);
				if (debug && event.isError) {
					const content = JSON.stringify(event.result ?? { error: "no error content" });
					process.stderr.write(`[tool-error] ${event.toolName}: ${content}\\n`);
				}
			} else if (event.type === "agent_settled") {
				if (settleTimeout) clearTimeout(settleTimeout);
				unsubscribe?.();
				resolve();
			}
		});
	});

	try {
		if (parsed.model) {
			// SDK startup restores local caches only. Refresh remote catalogs so a
			// newly released model works on the first invocation.
			await piSession.modelRuntime.refresh({ allowNetwork: true });
			const slash = parsed.model.indexOf("/");
			const model = slash > 0 ? piSession.modelRuntime.getModel(parsed.model.slice(0, slash), parsed.model.slice(slash + 1)) : undefined;
			if (!model) throw new Error(`Unknown model "${parsed.model}". ${modelFallbackMessage ?? "Authenticate or configure a model."}`);
			await piSession.setModel(model);
		} else if (!piSession.model || piSession.model.provider === "unknown") {
			throw new Error(`No default model available for agentDir ${parsed.agentDir}. ${modelFallbackMessage ?? "Authenticate or configure a model."}`);
		}
		await piSession.prompt(parsed.command);
		await settled;
		let text = "";
		for (let i = piSession.messages.length - 1; i >= 0; i--) {
			const message = piSession.messages[i];
			if (message.role === "assistant" && Array.isArray(message.content)) {
				text = message.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
				if (text) break;
			}
		}
		if (parsed.json) console.log(JSON.stringify({ ok: true, value: { text, toolCalls: [...toolCalls.values()] } }));
		else process.stdout.write(`${text || "(no response)"}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (parsed.json) console.log(JSON.stringify({ ok: false, code: "agent_error", error: message }));
		else process.stderr.write(`ai: ${message}\n`);
		process.exitCode = 1;
	} finally {
		if (settleTimeout) clearTimeout(settleTimeout);
		unsubscribe?.();
		piSession.dispose();
		connection.destroy();
	}
}
