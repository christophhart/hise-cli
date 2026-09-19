import { homedir } from "node:os";
import { join } from "node:path";
import { createHiseHelpTool, createHiseWhichTool, TUI_HELP_TOPICS } from "./ai-tools.js";
import { registerPiOAuthFlows } from "./pi-runtime.js";

export type HowSurface = "cli" | "tui";

export interface HowEvent {
	type: "tool-start" | "tool-end";
	toolName: string;
	args?: unknown;
	isError?: boolean;
	result?: unknown;
}

export interface RunHowOptions {
	query: string;
	surface: HowSurface;
	/** Optional explicit mode context; TUI supplies its active mode. */
	mode?: string;
	projectDir: string;
	agentDir?: string;
	/** A selected TUI worker model. Omit it to use the configured default. */
	model?: unknown;
	onEvent?: (event: HowEvent) => void;
	/** Test seam; production callers use the Pi worker session below. */
	worker?: (request: { query: string; prompt: string; surface: HowSurface }) => Promise<string>;
}

export interface HowGuidance {
	query: string;
	surface: HowSurface;
	guidance: string;
}

/**
 * Shared `/how` worker flow. It has only surface-aware documentation tools:
 * the model receives authored recipes and must copy them rather than translate
 * syntax between the CLI and the modal TUI.
 */
export async function runHow(options: RunHowOptions): Promise<HowGuidance> {
	const prompt = howPrompt(options.surface, options.mode);
	if (options.worker) return { query: options.query, surface: options.surface, guidance: await options.worker({ query: options.query, prompt, surface: options.surface }) };

	registerPiOAuthFlows();
	const pi = await import("@earendil-works/pi-coding-agent");
	const agentDir = options.agentDir ?? join(homedir(), ".hise", "agent");
	const settingsManager = pi.SettingsManager.create(options.projectDir, agentDir);
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: options.projectDir,
		agentDir,
		settingsManager,
		systemPromptOverride: () => prompt,
		appendSystemPromptOverride: () => [],
	});
	await resourceLoader.reload();
	const created = await pi.createAgentSession({
		cwd: options.projectDir,
		agentDir,
		resourceLoader,
		settingsManager,
		sessionManager: pi.SessionManager.inMemory(options.projectDir),
		model: options.model as never,
		thinkingLevel: "off",
		noTools: "builtin",
		tools: ["hise_which", "hise_help"],
		customTools: [createHiseWhichTool({ surface: options.surface, mode: options.mode }), createHiseHelpTool({ surface: options.surface, mode: options.mode })],
	});
	const session = created.session;
	const unsubscribe = session.subscribe((event) => {
		if (event.type === "tool_execution_start") options.onEvent?.({ type: "tool-start", toolName: event.toolName, args: event.args });
		else if (event.type === "tool_execution_end") options.onEvent?.({ type: "tool-end", toolName: event.toolName, isError: event.isError, result: event.result });
	});
	try {
		if (!session.model || session.model.provider === "unknown") throw new Error("No worker model available. Configure one with /ai then /login.");
		await session.prompt(options.query);
		return { query: options.query, surface: options.surface, guidance: lastAssistantText(session.messages) || "No explanation was returned." };
	} finally {
		unsubscribe();
		await session.dispose();
	}
}

export function howPrompt(surface: HowSurface, mode?: string): string {
	const syntax = surface === "tui"
		? "exact interactive TUI commands in execution order. A slash is used only to enter a mode; following lines start with the command verb, so never prefix it with a slash, dot, or mode name. Use forms such as set Button.text \"OK\", never /ui set --component. Never emit hise-cli invocations or shell flags."
		: "exact shell hise-cli commands. Never emit slash commands or modal input lines.";
	const context = mode ? `The active mode is ${mode}; use it as the authoritative mode context and make that clear in the answer. Do not select a different mode.` : "Infer the relevant mode from the lookup evidence.";
	return `Explain only how to perform the requested task in hise-cli. ${context} Before answering, always call both tools exactly once: call hise_which with the complete request and hise_help for the relevant mode. hise_which may return no matches. Synthesise only their combined results; do not inspect or modify HISE, browse files, or invent commands. Return concise Markdown with a short explanation followed by ${syntax} Copy retrieved command forms verbatim: never translate syntax yourself. If the documentation does not support the task, say so. Available TUI help modes: ${TUI_HELP_TOPICS.join(", ")}.`;
}

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
