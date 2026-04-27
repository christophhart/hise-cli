// ── /project mode argument parsers ──────────────────────────────────
//
// Lenient OS / target / boolean / preprocessor filename parsers shared
// by the engine mode and its tests. Server only accepts canonical
// values, so each parser fails closed when input cannot be reduced.

export type CanonicalOS = "Windows" | "macOS" | "Linux" | "all";
export type CanonicalTarget = "Project" | "Dll" | "all";

const OS_ALIASES: Record<string, CanonicalOS> = {
	windows: "Windows",
	win: "Windows",
	x64: "Windows",
	macos: "macOS",
	mac: "macOS",
	osx: "macOS",
	macosx: "macOS",
	apple: "macOS",
	darwin: "macOS",
	linux: "Linux",
	all: "all",
	"*": "all",
	any: "all",
};

const TARGET_ALIASES: Record<string, CanonicalTarget> = {
	project: "Project",
	plugin: "Project",
	dll: "Dll",
	all: "all",
	"*": "all",
	any: "all",
};

export function parseOS(input: string | undefined): CanonicalOS | null {
	if (input === undefined || input === "") return "all";
	return OS_ALIASES[input.toLowerCase()] ?? null;
}

export function parseTarget(input: string | undefined): CanonicalTarget | null {
	if (input === undefined || input === "") return "all";
	return TARGET_ALIASES[input.toLowerCase()] ?? null;
}

const TRUE_TOKENS = new Set(["true", "yes", "on", "1", "enable", "enabled"]);
const FALSE_TOKENS = new Set(["false", "no", "off", "0", "disable", "disabled"]);

/** Lenient bool token recognition; returns null if input is not a bool. */
export function parseBoolToken(input: string): boolean | null {
	const lower = input.toLowerCase();
	if (TRUE_TOKENS.has(lower)) return true;
	if (FALSE_TOKENS.has(lower)) return false;
	return null;
}

/**
 * Tokenize a /project command line, splitting on whitespace but preserving
 * quoted strings. Used by show preprocessors / set / set preprocessor / etc.
 */
export function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < input.length) {
		const ch = input[i]!;
		if (ch === " " || ch === "\t") {
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			let buf = "";
			while (i < input.length && input[i] !== quote) {
				if (input[i] === "\\" && i + 1 < input.length) {
					buf += input[i + 1];
					i += 2;
				} else {
					buf += input[i];
					i++;
				}
			}
			i++;
			tokens.push(buf);
			continue;
		}
		let buf = "";
		while (i < input.length && input[i] !== " " && input[i] !== "\t") {
			buf += input[i];
			i++;
		}
		tokens.push(buf);
	}
	return tokens;
}

/**
 * Pull `for <target>` and `on <os>` clauses out of a token stream.
 * Returns the remaining tokens plus the resolved OS/target (defaulting to "all").
 * Errors when an unknown alias is supplied.
 */
export interface ScopeClauses {
	tokens: string[];
	os: CanonicalOS;
	target: CanonicalTarget;
}

export function extractScopeClauses(tokens: string[]): ScopeClauses | { error: string } {
	let os: CanonicalOS = "all";
	let target: CanonicalTarget = "all";
	const remaining: string[] = [];
	let i = 0;
	while (i < tokens.length) {
		const tok = tokens[i]!.toLowerCase();
		if (tok === "on" && i + 1 < tokens.length) {
			const parsed = parseOS(tokens[i + 1]);
			if (!parsed) return { error: `Unknown OS "${tokens[i + 1]}"` };
			os = parsed;
			i += 2;
			continue;
		}
		if (tok === "for" && i + 1 < tokens.length) {
			const parsed = parseTarget(tokens[i + 1]);
			if (!parsed) return { error: `Unknown target "${tokens[i + 1]}"` };
			target = parsed;
			i += 2;
			continue;
		}
		remaining.push(tokens[i]!);
		i++;
	}
	return { tokens: remaining, os, target };
}

/**
 * Parse `save <format> [as <filename>]`. Filename is optional; quotes
 * supported via tokenize().
 */
export interface SaveCommand {
	format: "xml" | "hip";
	filename?: string;
}

export function parseSaveCommand(args: string): SaveCommand | { error: string } {
	const tokens = tokenize(args);
	if (tokens.length === 0) {
		return { error: "save requires a format (xml or hip)" };
	}
	const format = tokens[0]!.toLowerCase();
	if (format !== "xml" && format !== "hip") {
		return { error: `save format must be "xml" or "hip", got "${format}"` };
	}
	const result: SaveCommand = { format };
	if (tokens.length === 1) return result;
	if (tokens[1]!.toLowerCase() !== "as" || tokens.length < 3) {
		return { error: "save filename must be specified as 'save <format> as <filename>'" };
	}
	result.filename = tokens.slice(2).join(" ");
	return result;
}
