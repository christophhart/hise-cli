import type { CompletionItem, CompletionResult } from "../engine/modes/mode.js";

export interface AiSessionChoice {
	id: string;
	label: string;
	detail?: string;
}

const AI_COMMANDS: CompletionItem[] = [
	{ label: "/clear", detail: "Clear the AI conversation" },
	{ label: "/login", detail: "Configure provider authentication" },
	{ label: "/exit", detail: "Leave AI mode" },
	{ label: "/model", detail: "Select model and reasoning level" },
	{ label: "/nuke", detail: "Remove embedded AI model configuration" },
	{ label: "/sessions", detail: "List or switch AI sessions" },
	{ label: "/stop", detail: "Stop the active generation" },
];

export function completeAiSlash(
	value: string,
	cursor: number = value.length,
	models: string[] = [],
	sessions: AiSessionChoice[] = [],
): CompletionResult {
	const before = value.slice(0, cursor);
	const match = before.match(/(?:^|\s)(\/[^\s]*)?\s*([^\s]*)$/);
	const command = match?.[1] ?? "";
	const argument = match?.[2] ?? "";
	const from = cursor - argument.length;
	if (command === "/provider" || command === "/model") {
		// Both commands open their selector; they intentionally take no arguments.
		return { items: [], from, to: cursor, label: command === "/provider" ? "AI providers" : "AI models" };
	}
	if (command === "/sessions") {
		return { items: sessions.filter((session) => session.id.startsWith(argument)).map((session) => ({ label: session.id, detail: session.detail })), from, to: cursor, label: "AI sessions" };
	}
	const token = before.split(/\s/).pop() ?? "";
	const slashFrom = cursor - token.length;
	return { items: AI_COMMANDS.filter((item) => item.label.startsWith(token)), from: slashFrom, to: cursor, label: "AI commands" };
}
