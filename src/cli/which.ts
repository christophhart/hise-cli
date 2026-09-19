import { GENERATED_AGENT_CONTEXT } from "./generated-agent-context.js";
import { GENERATED_COMMAND_CATALOG } from "../engine/commands/generatedCatalog.js";
import { catalogCommands, type CommandSurface } from "../engine/commands/catalogTypes.js";
import type { AgentCommand } from "./agentContextTypes.js";
import { cliError, type CliErrorPayload } from "./errors.js";

export interface WhichMatch {
	id: string;
	mode?: string;
	surface?: CommandSurface;
	title: string;
	purpose: string;
	command: { argv?: string[]; display: string; lines?: string[] };
	score: number;
	reason: string;
	tags: string[];
	aliases: string[];
}

const SYNONYMS: Record<string, string[]> = {
	edit: ["set", "update", "replace"],
	update: ["set", "edit", "replace"],
	read: ["get", "show"],
	show: ["get", "read"],
	callback: ["oninit", "oncontrol", "script"],
	callbacks: ["callback", "script"],
	compile: ["recompile"],
	recompile: ["compile"],
	file: ["path"],
	stdin: ["pipe", "input"],
	expression: ["repl", "evaluate"],
	evaluate: ["repl", "expression"],
};

export function executeWhich(query: string, limit: number, surface: CommandSurface = "cli"): { ok: true; value: WhichMatch[] } | CliErrorPayload {
	const catalog = catalogCommands(GENERATED_COMMAND_CATALOG, surface);
	const commands = catalog.map((command) => ({
		...command,
		syntax: command.recipes[surface]?.display ?? "",
		command: command.recipes[surface] ?? { argv: [], display: "" },
	})) as unknown as AgentCommand[];
	if (!query) {
		return { ok: true, value: commands.slice(0, limit).map((command) => toMatch(command, 0, "listed command")) };
	}

	const queryTokens = expandTokens(tokenize(query));
	const matches = commands
		.map((command) => scoreCommand(command, queryTokens, surface))
		.filter((match) => match.score >= 3)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
		.slice(0, limit);

	if (matches.length === 0) {
		return cliError("usage_error", `No matching hise-cli command found for: ${query}`);
	}

	return { ok: true, value: matches };
}

function scoreCommand(command: AgentCommand, queryTokens: Set<string>, surface: CommandSurface): WhichMatch {
	let score = 0;
	const reasons: string[] = [];
	const fields: Array<[string, number, string[]]> = [
		["title", 5, tokenize(command.title)],
		["aliases", 6, command.aliases.flatMap(tokenize)],
		["tags", 4, command.tags.flatMap(tokenize)],
		["purpose", 2, tokenize(command.purpose)],
		["syntax", 2, tokenize(command.syntax)],
		["command", 1, (command.command.argv ?? (command.command as AgentCommand["command"] & { lines?: string[] }).lines ?? []).flatMap(tokenize)],
	];

	for (const [name, weight, tokens] of fields) {
		const hits = [...new Set(tokens.filter((token) => queryTokens.has(token)))];
		if (hits.length > 0) {
			score += hits.length * weight;
			reasons.push(`${name}: ${hits.slice(0, 4).join(", ")}`);
		}
	}

	return toMatch(command, score, reasons.join("; ") || "no direct match", surface);
}

function toMatch(command: AgentCommand, score: number, reason: string, surface: CommandSurface = "cli"): WhichMatch {
	return {
		id: command.id,
		mode: (command as AgentCommand & { mode?: string }).mode,
		surface,
		title: command.title,
		purpose: command.purpose,
		command: command.command,
		score,
		reason,
		tags: command.tags,
		aliases: command.aliases,
	};
}

function tokenize(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
}

function expandTokens(tokens: string[]): Set<string> {
	const out = new Set(tokens);
	for (const token of tokens) {
		for (const synonym of SYNONYMS[token] ?? []) out.add(synonym);
	}
	return out;
}
