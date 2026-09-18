import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import type { AgentSession, AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";

export type AiThinkingLevel = Parameters<AgentSession["setThinkingLevel"]>[0];
import type { DataLoader } from "../engine/data.js";
import type { HiseConnection } from "../engine/hise.js";
import { CapturingHiseConnection } from "../cli/capture.js";
import { createHiseCommandTool, createHiseResearchTool, createHiseHelpTool, createHiseScriptTool, createHiseWhichTool, createJsTool, runHiseResearch, TUI_HELP_TOPICS, type HiseCliRunner, type HiseResearchProgress } from "../cli/ai-tools.js";
import { executeCliCommand } from "../cli/run.js";
import { listCliCommands } from "../cli/commands.js";
import { classifyAgentCommand } from "../cli/agentContext.js";
import { createSession } from "../session-bootstrap.js";
import { RestMcpClient } from "../mcp/restClient.js";
import { HISESCRIPT_CHEAT_SHEET } from "../cli/ai-guidance.js";
import { COMPACT_CLI_CONTRACT } from "../cli/generated-ai-contract.js";
import { registerPiOAuthFlows } from "../cli/pi-runtime.js";

const MODEL_SETTING_KEYS = ["defaultProvider", "defaultModel", "defaultThinkingLevel", "modelThinkingLevels", "enabledModels", "workerModel"] as const;

/** Remove embedded-agent credentials, custom providers, caches, and model defaults. */
export async function removeAiModelConfig(agentDir: string): Promise<void> {
	await Promise.all([
		rm(join(agentDir, "auth.json"), { force: true }),
		rm(join(agentDir, "models.json"), { force: true }),
		rm(join(agentDir, "models-store.json"), { force: true }),
	]);
	const settingsPath = join(agentDir, "settings.json");
	try {
		const settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
		for (const key of MODEL_SETTING_KEYS) delete settings[key];
		if (Object.keys(settings).length === 0) await rm(settingsPath, { force: true });
		else await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
	} catch (error) {
		const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
		if (code !== "ENOENT") await rm(settingsPath, { force: true });
	}
}

export interface TuiAiStats {
	input: number;
	output: number;
	cacheRead: number;
	total: number;
	cost: number;
	toolCalls: number;
	contextTokens?: number;
	contextWindow?: number;
	contextPercent?: number;
}

export interface TuiAiEvent {
	type: "tool-start" | "tool-end" | "research-progress" | "assistant" | "stats" | "settled" | "error";
	toolName?: string;
	args?: unknown;
	isError?: boolean;
	result?: unknown;
	text?: string;
	error?: string;
	stats?: TuiAiStats;
	progress?: HiseResearchProgress;
}

export interface TuiAiOptions {
	connection: HiseConnection;
	dataLoader: DataLoader;
	projectDir: string;
	agentDir?: string;
	model?: string;
	thinkingLevel?: AiThinkingLevel;
	onEvent: (event: TuiAiEvent) => void;
}

/** Persistent Pi session adapter for the inline TUI. */
export class TuiAiSession {
	private readonly options: TuiAiOptions;
	private piSession: AgentSession | null = null;
	private workerModel: Model<Api> | undefined;
	private unsubscribe: (() => void) | null = null;
	private running = false;
	private freshSession = false;
	private sessionPath: string | undefined;

	constructor(options: TuiAiOptions) {
		this.options = options;
	}

	get isRunning(): boolean {
		return this.running;
	}

	get modelLabel(): string {
		const model = this.piSession?.model;
		return model ? `${model.provider}/${model.id}` : "no model";
	}

	get modelDisplayLabel(): string {
		return this.hasModel ? `${this.modelLabel} (${this.thinkingLevel})` : this.modelLabel;
	}

	get hasModel(): boolean {
		const model = this.piSession?.model;
		// Pi may create a placeholder `unknown` model when no credentials are
		// configured. Treat that as an onboarding state, not as a usable model.
		return Boolean(model && model.provider !== "unknown");
	}

	async how(query: string): Promise<string> {
		if (!this.piSession) await this.start();
		if (!this.piSession || !this.hasModel) throw new Error("No model available. Use /ai, then /login to configure one.");
		const pi = await import("@earendil-works/pi-coding-agent");
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		const settingsManager = pi.SettingsManager.create(this.options.projectDir, agentDir);
		const resourceLoader = new pi.DefaultResourceLoader({
			cwd: this.options.projectDir,
			agentDir,
			settingsManager,
			systemPromptOverride: () => HOW_AGENT_PROMPT,
			appendSystemPromptOverride: () => [],
		});
		await resourceLoader.reload();
		const created = await pi.createAgentSession({
			cwd: this.options.projectDir,
			agentDir,
			resourceLoader,
			settingsManager,
			sessionManager: pi.SessionManager.inMemory(this.options.projectDir),
			model: this.workerModel ?? this.piSession.model,
			thinkingLevel: "off",
			noTools: "builtin",
			tools: ["hise_which", "hise_help"],
			customTools: [createHiseWhichTool(), createHiseHelpTool({ surface: "tui" })],
		});
		const session = created.session;
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "tool_execution_start") this.options.onEvent({ type: "tool-start", toolName: event.toolName, args: event.args });
			else if (event.type === "tool_execution_end") this.options.onEvent({ type: "tool-end", toolName: event.toolName, isError: event.isError, result: event.result });
		});
		try {
			if (!session.model || session.model.provider === "unknown") throw new Error("No worker model available. Use /model to configure one.");
			await session.prompt(query);
			return lastAssistantText(session.messages) || "No explanation was returned.";
		} finally {
			unsubscribe();
			session.dispose();
		}
	}

	async research(query: string, onProgress?: (progress: HiseResearchProgress) => void): Promise<string> {
		return runHiseResearch(query, {
			mcpClient: new RestMcpClient({ defaultUrl: process.env.HISE_DOCS_API_URL ?? process.env.HISE_MCP_URL }),
			connection: this.options.connection,
			cwd: this.options.projectDir,
			agentDir: this.options.agentDir ?? join(homedir(), ".hise", "agent"),
			model: this.piSession?.model,
			workerModel: this.workerModel,
			thinkerModel: this.piSession?.model,
			getModel: () => this.piSession?.model,
			thinkingLevel: this.piSession?.thinkingLevel,
			onProgress,
		});
	}

	get modelChoices(): string[] {
		// Match pi's selector: don't offer models whose provider has no credentials.
		return this.piSession?.modelRuntime.getAvailableSnapshot().map((model) => `${model.provider}/${model.id}`) ?? [];
	}

	get thinkerModelLabel(): string { return this.modelLabel; }
	get workerModelLabel(): string { return this.workerModel ? `${this.workerModel.provider}/${this.workerModel.id}` : this.modelLabel; }

	get providerChoices(): string[] {
		return this.piSession?.modelRuntime.getProviders().map((provider) => provider.id) ?? [];
	}

	get thinkingLevel(): string {
		return this.piSession?.thinkingLevel ?? "off";
	}

	getAvailableThinkingLevels(modelId?: string): string[] {
		if (!modelId) return this.piSession?.getAvailableThinkingLevels() ?? ["off"];
		const slash = modelId.indexOf("/");
		if (!this.piSession || slash <= 0) return ["off"];
		const model = this.piSession.modelRuntime.getModel(modelId.slice(0, slash), modelId.slice(slash + 1));
		return model ? [...getSupportedThinkingLevels(model)] : ["off"];
	}

	/** Refresh cached and remote provider catalogs before presenting the model picker. */
	async refreshModels(allowNetwork = true): Promise<string[]> {
		if (!this.piSession) await this.start();
		if (!this.piSession) return [];
		await this.piSession.modelRuntime.refresh({ allowNetwork });
		return this.modelChoices;
	}

	/** Add an OpenAI-compatible provider without requiring a hand-edited models.json. */
	async addProvider(input: { id: string; name?: string; baseUrl: string; apiKey: string; modelId: string }): Promise<string> {
		if (!this.piSession) await this.start();
		if (!this.piSession) throw new Error("AI session is not started");
		if (!/^[a-zA-Z0-9._-]+$/.test(input.id)) throw new Error("Provider id may contain only letters, numbers, '.', '_' and '-'");
		try { new URL(input.baseUrl); } catch { throw new Error("Provider URL must be a valid URL"); }
		if (!input.modelId.trim()) throw new Error("Model id is required");

		const config = {
			name: input.name?.trim() || input.id,
			baseUrl: input.baseUrl.replace(/\/$/, ""),
			api: "openai-completions" as const,
			authHeader: true,
			models: [{
				id: input.modelId.trim(), name: input.modelId.trim(), reasoning: false,
				input: ["text" as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000, maxTokens: 16384,
			}],
		};
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		const modelsPath = join(agentDir, "models.json");
		let modelsConfig: { providers?: Record<string, unknown> } = {};
		try { modelsConfig = JSON.parse(await readFile(modelsPath, "utf8")) as typeof modelsConfig; } catch { /* first provider */ }
		modelsConfig.providers ??= {};
		// Keep secrets in pi's auth store; models.json is deliberately credential-free.
		modelsConfig.providers[input.id] = config;
		await mkdir(agentDir, { recursive: true });
		await writeFile(modelsPath, JSON.stringify(modelsConfig, null, 2) + "\n", { mode: 0o600 });
		this.piSession.modelRuntime.registerProvider(input.id, config);
		await this.persistApiKey(input.id, input.apiKey);
		const model = this.piSession.modelRuntime.getModel(input.id, input.modelId.trim());
		if (!model) throw new Error(`Provider added, but model "${input.modelId}" was not available`);
		await this.selectModel(`${input.id}/${input.modelId.trim()}`, "off");
		return `${input.id}/${input.modelId.trim()}`;
	}

	get stats(): TuiAiStats | undefined {
		if (!this.piSession) return undefined;
		const stats = this.piSession.getSessionStats();
		const context = this.piSession.getContextUsage();
		return {
			input: stats.tokens.input,
			output: stats.tokens.output,
			cacheRead: stats.tokens.cacheRead,
			total: stats.tokens.total,
			cost: stats.cost,
			toolCalls: stats.toolCalls,
			contextTokens: context?.tokens ?? undefined,
			contextWindow: context?.contextWindow,
			contextPercent: context?.percent ?? undefined,
		};
	}

	async start(): Promise<void> {
		if (this.piSession) return;
		registerPiOAuthFlows();
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		const connection = new CapturingHiseConnection(this.options.connection);
		const bootstrap = createSession({ connection, forLlm: true, enableLlm: false });
		const cliCommands = listCliCommands(bootstrap.session.allCommands());
		const runner: HiseCliRunner = {
			run: async (argv, stdin) => {
				// TUI AI is optimistic: mutations are enabled, but classification
				// remains available to event consumers and future confirmation policy.
				void classifyAgentCommand(argv);
				return executeEmbeddedCli(argv, stdin, connection, this.options.dataLoader, cliCommands);
			},
		};
		const pi = await import("@earendil-works/pi-coding-agent");
		const settingsManager = pi.SettingsManager.create(this.options.projectDir, agentDir);
		const resourceLoader = new pi.DefaultResourceLoader({
			cwd: this.options.projectDir,
			agentDir,
			settingsManager,
			systemPrompt: HISE_AGENT_PROMPT,
		});
		// createAgentSession only reloads loaders it constructs itself.
		await resourceLoader.reload();
		const sessionManager = this.freshSession
			? pi.SessionManager.create(this.options.projectDir, agentDir)
			: this.sessionPath
			? pi.SessionManager.open(this.sessionPath, agentDir, this.options.projectDir)
			: pi.SessionManager.continueRecent(this.options.projectDir, agentDir);
		this.freshSession = false;
		const created = await pi.createAgentSession({
			cwd: this.options.projectDir,
			agentDir,
			resourceLoader,
			sessionManager,
			settingsManager,
			tools: ["hise_command", "hise_help", "hise_research", "hise_script", "js"],
			customTools: [createHiseCommandTool(runner), createHiseHelpTool(), createHiseResearchTool({
				mcpClient: new RestMcpClient({ defaultUrl: process.env.HISE_DOCS_API_URL ?? process.env.HISE_MCP_URL }),
				connection,
				cwd: this.options.projectDir,
				agentDir,
				getModel: () => this.piSession?.model,
				getWorkerModel: () => this.workerModel,
				getThinkerModel: () => this.piSession?.model,
				getThinkingLevel: () => this.piSession?.thinkingLevel,
				onProgress: (progress) => this.options.onEvent({ type: "research-progress", progress }),
			}), createHiseScriptTool({ connection, projectDir: this.options.projectDir }), createJsTool({ projectDir: this.options.projectDir, allowWrites: true })],
		});
		this.piSession = created.session;
		const settingsPath = join(agentDir, "settings.json");
		try {
			const settings = JSON.parse(await readFile(settingsPath, "utf8")) as { workerModel?: unknown };
			if (typeof settings.workerModel === "string") {
				const slash = settings.workerModel.indexOf("/");
				if (slash > 0) this.workerModel = this.piSession.modelRuntime.getModel(settings.workerModel.slice(0, slash), settings.workerModel.slice(slash + 1));
			}
		} catch { /* use thinker as the worker by default */ }
		this.workerModel ??= this.piSession.model;
		if (this.options.model) {
			await this.applyModel(this.options.model, false);
			if (this.options.thinkingLevel) this.piSession.setThinkingLevel(this.options.thinkingLevel);
		}
		this.unsubscribe = this.piSession.subscribe((event: AgentSessionEvent) => this.handleEvent(event));
	}

	async sessionChoices(): Promise<Array<{ id: string; label: string; detail?: string }>> {
		const pi = await import("@earendil-works/pi-coding-agent");
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		const sessions = await pi.SessionManager.list(this.options.projectDir, agentDir);
		return sessions.map((session) => ({
			id: session.id,
			label: session.name ?? session.id,
			detail: `${session.name ?? session.firstMessage.slice(0, 48)} · ${session.messageCount} messages`,
		}));
	}

	async openSession(id: string): Promise<void> {
		const pi = await import("@earendil-works/pi-coding-agent");
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		const session = (await pi.SessionManager.list(this.options.projectDir, agentDir)).find((entry) => entry.id === id);
		if (!session) throw new Error(`Unknown AI session "${id}"`);
		this.dispose();
		this.sessionPath = session.path;
		await this.start();
	}

	async prompt(text: string): Promise<void> {
		if (!this.piSession) await this.start();
		if (!this.piSession || this.running) return;
		this.running = true;
		try {
			await this.piSession.prompt(text);
		} catch (error) {
			this.options.onEvent({ type: "error", error: error instanceof Error ? error.message : String(error) });
			this.running = false;
		}
	}

	abort(): void {
		this.piSession?.abort();
	}

	async clear(): Promise<void> {
		this.dispose();
		this.sessionPath = undefined;
		this.freshSession = true;
		await this.start();
	}

	async nukeModelConfig(): Promise<void> {
		this.dispose();
		const agentDir = this.options.agentDir ?? join(homedir(), ".hise", "agent");
		await removeAiModelConfig(agentDir);
		this.sessionPath = undefined;
		this.freshSession = true;
		await this.start();
	}

	async configureApiKey(providerId: string, apiKey: string): Promise<void> {
		if (!this.piSession) throw new Error("AI session is not started");
		if (!this.piSession.modelRuntime.getProvider(providerId)) throw new Error(`Unknown provider "${providerId}"`);
		await this.persistApiKey(providerId, apiKey);
		// Login refreshes auth availability; this second pass also updates remote
		// catalogs so newly released models are visible immediately.
		await this.piSession.modelRuntime.refresh({ allowNetwork: true, providers: [providerId] });
	}

	private async persistApiKey(providerId: string, apiKey: string): Promise<void> {
		await this.piSession!.modelRuntime.login(providerId, "api_key", {
			prompt: async () => apiKey,
			notify: () => { /* provider-owned login messages are not needed for API keys */ },
		});
	}

	async login(providerId: string, interaction: import("@earendil-works/pi-ai").AuthInteraction): Promise<void> {
		if (!this.piSession) throw new Error("AI session is not started");
		const provider = this.piSession.modelRuntime.getProvider(providerId);
		if (!provider) throw new Error(`Unknown provider "${providerId}"`);
		await this.piSession.modelRuntime.login(providerId, "api_key", interaction);
	}

	/** Select and durably persist model and reasoning defaults for future sessions. */
	async selectModel(modelId: string, thinkingLevel: AiThinkingLevel): Promise<void> {
		await this.selectModels(modelId, this.workerModel ? this.workerModelLabel : modelId, thinkingLevel);
	}

	async selectModels(thinkerModelId: string, workerModelId: string, thinkingLevel: AiThinkingLevel): Promise<void> {
		if (!this.piSession) return;
		const thinkerProvider = thinkerModelId.split("/")[0];
		const workerProvider = workerModelId.split("/")[0];
		if (thinkerProvider !== workerProvider) throw new Error("Thinker and worker models must use the same provider");
		await this.applyModel(thinkerModelId, true);
		this.piSession.settingsManager.setDefaultModelAndProvider(thinkerProvider, thinkerModelId.slice(thinkerProvider.length + 1));
		this.piSession.settingsManager.setDefaultThinkingLevel(thinkingLevel);
		const worker = this.piSession.modelRuntime.getModel(workerProvider, workerModelId.slice(workerProvider.length + 1));
		if (!worker) throw new Error(`Unknown worker model "${workerModelId}"`);
		this.workerModel = worker;
		this.piSession.setThinkingLevel(thinkingLevel, { persist: true });
		await this.piSession.settingsManager.flush();
		const settingsPath = join(this.options.agentDir ?? join(homedir(), ".hise", "agent"), "settings.json");
		let settings: Record<string, unknown> = {};
		try { settings = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>; } catch { /* first save */ }
		settings.workerModel = workerModelId;
		await mkdir(join(this.options.agentDir ?? join(homedir(), ".hise", "agent")), { recursive: true });
		await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", { mode: 0o600 });
		const errors = this.piSession.settingsManager.drainErrors();
		if (errors.length > 0) throw errors[0]!.error;
	}

	private async applyModel(modelId: string, persist: boolean): Promise<void> {
		if (!this.piSession) return;
		const slash = modelId.indexOf("/");
		if (slash <= 0) throw new Error("Model must use provider/model-id syntax");
		const model = this.piSession.modelRuntime.getModel(modelId.slice(0, slash), modelId.slice(slash + 1));
		if (!model) throw new Error(`Unknown model "${modelId}"`);
		await this.piSession.setModel(model, { persist });
	}

	dispose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.piSession?.dispose();
		this.piSession = null;
		this.workerModel = undefined;
		this.running = false;
	}

	private handleEvent(event: AgentSessionEvent): void {
		const stats = this.stats;
		if (stats) this.options.onEvent({ type: "stats", stats });
		if (event.type === "tool_execution_start") {
			this.options.onEvent({ type: "tool-start", toolName: event.toolName, args: event.args });
		} else if (event.type === "tool_execution_end") {
			this.options.onEvent({ type: "tool-end", toolName: event.toolName, isError: event.isError, result: event.result });
		} else if (event.type === "agent_end") {
			const text = event.messages
				.filter((message): message is typeof message & { role: "assistant" } => message.role === "assistant")
				.flatMap((message) => Array.isArray(message.content) ? message.content : [])
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("\n");
			if (text) this.options.onEvent({ type: "assistant", text });
		} else if (event.type === "agent_settled") {
			this.running = false;
			this.options.onEvent({ type: "settled" });
		}
	}
}

export const HOW_AGENT_PROMPT = `Explain only how to perform the requested task in hise-cli. This is a small documentation lookup, not a development task.
Before answering, always call both tools exactly once: call hise_which with the user's complete request, and call hise_help for the high-level mode you infer from the request. Available help modes: ${TUI_HELP_TOPICS.join(", ")}. Neither call depends on the other; hise_which may return no matches. Synthesise only their combined results; do not inspect or modify HISE, browse files, or invent commands.
Return concise Markdown: a short explanation followed by exact interactive TUI commands in execution order. A slash is used only to enter a mode, eg. /ui or /hise. Each following line starts directly with the documented command verb, eg. set Button.text "OK", launch, or shutdown; never prefix it with a slash, dot, or mode name. Dots are only part of documented operand paths such as Button.text. Copy command forms from the retrieved help verbatim. Never emit shell-style flags such as /ui set --component or invocations beginning with hise-cli. Mention choices or required values only when documented. If the docs do not support the task, say so.`;

const HISE_AGENT_PROMPT = `You are the HISE development assistant inside the persistent TUI. Running HISE is the source of truth; this is not a repository exploration task.
For routine builder, UI, DSP, project, and script operations: call hise_help for the relevant mode first, inspect only the minimum live HISE state with hise_command, then mutate and verify with hise_command. Use canonical argv arrays without the executable or --agent. Never search project files to discover HISE state or CLI syntax.
Use hise_research only when hise_help and live inspection cannot answer an unfamiliar HISE API or semantic question, or when the user explicitly asks for documentation or examples. Do not use it for ordinary command syntax, node/component discovery, or routine add/set/connect operations.
Use hise_script only for callback and included external-file edits. Use js only when the user explicitly requests project-file data processing or media inspection. Keep the task focused, avoid speculative calls, verify each mutation once, and report what changed and how it can be undone.

${HISESCRIPT_CHEAT_SHEET}

${COMPACT_CLI_CONTRACT}`;

function lastAssistantText(messages: readonly unknown[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant" || !("content" in message) || !Array.isArray(message.content)) continue;
		const text = message.content
			.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"))
			.map((part) => part.text)
			.join("\n");
		if (text) return text;
	}
	return "";
}

async function executeEmbeddedCli(
	argv: string[],
	stdin: string | undefined,
	connection: HiseConnection,
	dataLoader: DataLoader,
	cliCommands: import("../engine/commands/registry.js").CommandEntry[],
): Promise<import("../cli/ai-tools.js").HiseCliResult> {
	const args = argv[0] === "hise-cli" ? argv.slice(1) : argv.slice();
	if (args.includes("--agent")) args.splice(args.indexOf("--agent"), 1);
	if (stdin !== undefined && args[0] === "script" && args[1] === "set" && args.includes("--stdin")) {
		const moduleId = valueAfter(args, "--module-id");
		const callback = valueAfter(args, "--callback");
		if (!moduleId || !callback) return { ok: false, text: "script set --stdin requires --module-id and --callback", error: "invalid script set arguments" };
		const payload = await connection.post("/api/set_script", { moduleId, callbacks: { [callback]: stdin } }) as unknown as Record<string, unknown>;
		const ok = payload.success === true && (!Array.isArray(payload.errors) || payload.errors.length === 0);
		const text = JSON.stringify({ ok, value: payload }, null, 1);
		return ok ? { ok: true, text } : { ok: false, text, error: String(payload.result ?? "script set failed") };
	}
	const result = await executeCliCommand(["node", "hise-cli", ...args, "--agent"], cliCommands, dataLoader, { connectionOverride: connection });
	if (result.kind === "json") {
		const text = JSON.stringify(result.payload, null, 1);
		return result.payload.ok ? { ok: true, text } : { ok: false, text, error: "error" in result.payload ? result.payload.error : text };
	}
	if (result.kind === "error") return { ok: false, text: result.message, error: result.message };
	if (result.kind === "help") return { ok: true, text: result.scope ?? "" };
	if (result.kind === "text") return { ok: true, text: result.text };
	return { ok: false, text: JSON.stringify(result), error: "unsupported CLI result" };
}

function valueAfter(args: string[], flag: string): string | undefined {
	const index = args.indexOf(flag);
	return index >= 0 ? args[index + 1] : undefined;
}
