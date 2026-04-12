// ── .hsc script parser ──────────────────────────────────────────────
//
// Tokenizes a multiline string into ScriptLine[], stripping comments,
// blank lines, and leading/trailing whitespace. No mode awareness —
// just line classification.

import type { ParsedScript, ScriptLine } from "./types.js";

/**
 * Parse a raw .hsc script string into a ParsedScript.
 * - Lines starting with `#` (after trimming) are comments → skipped
 * - Empty lines (after trimming) → skipped
 * - Leading/trailing whitespace is stripped (indentation is cosmetic)
 * - Lines starting with `/` are classified as "slash" commands
 * - Everything else is a mode-specific "command"
 */
export function parseScript(source: string): ParsedScript {
	const rawLines = source.split(/\r?\n/);
	const lines: ScriptLine[] = [];

	for (let i = 0; i < rawLines.length; i++) {
		const raw = rawLines[i]!;
		const trimmed = raw.trim();

		// Skip empty lines and full-line comments (# or //)
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

		// Strip inline comments (# or //) respecting quoted strings
		let content = trimmed;
		let inDouble = false;
		let inSingle = false;
		for (let j = 0; j < content.length; j++) {
			const ch = content[j]!;
			if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
			if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
			if (inDouble || inSingle) continue;
			if (ch === "#" || (ch === "/" && content[j + 1] === "/")) {
				content = content.slice(0, j).trimEnd();
				break;
			}
		}

		if (content === "") continue;

		lines.push({
			lineNumber: i + 1,
			raw,
			content,
			kind: content.startsWith("/") ? "slash" : "command",
		});
	}

	return { lines };
}

// ── /expect parsing ─────────────────────────────────────────────────

import type { ParsedExpect } from "./types.js";

/**
 * Parse the arguments of an /expect command.
 *
 * Syntax: `/expect <command> is <value> [within <tolerance>] [or abort]`
 *
 * Parsing is right-to-left to avoid ambiguity:
 * 1. Strip trailing "or abort" → sets abortOnFail
 * 2. Find last " within " → extract tolerance (default 0.01)
 * 3. Find last " is " → split into command and expected value
 */
export function parseExpect(args: string): ParsedExpect | string {
	let remaining = args.trim();
	let abortOnFail = false;
	let tolerance = 0.01;

	// 1. Check for trailing "or abort"
	if (remaining.endsWith(" or abort")) {
		abortOnFail = true;
		remaining = remaining.slice(0, -" or abort".length);
	}

	// 2. Check for "within <tolerance>"
	const withinIdx = remaining.lastIndexOf(" within ");
	if (withinIdx !== -1) {
		const tolStr = remaining.slice(withinIdx + " within ".length).trim();
		const tolVal = Number(tolStr);
		if (Number.isNaN(tolVal) || tolVal < 0) {
			return `Invalid tolerance value: "${tolStr}"`;
		}
		tolerance = tolVal;
		remaining = remaining.slice(0, withinIdx);
	}

	// 3. Find last " is " to split command from expected value
	const isIdx = remaining.lastIndexOf(" is ");
	if (isIdx === -1) {
		return `Missing "is" keyword. Syntax: /expect <command> is <value>`;
	}

	const command = remaining.slice(0, isIdx).trim();
	const expected = remaining.slice(isIdx + " is ".length).trim();

	if (!command) {
		return `Missing command before "is"`;
	}
	if (!expected) {
		return `Missing expected value after "is"`;
	}

	return { command, expected, tolerance, abortOnFail };
}

// ── /wait parsing ───────────────────────────────────────────────────

import type { ParsedWait } from "./types.js";

/**
 * Parse the arguments of a /wait command.
 *
 * Syntax: `/wait <number><unit>` where unit is `ms` or `s`.
 * Examples: `500ms`, `0.5s`, `2s`, `100ms`
 */
export function parseWait(args: string): ParsedWait | string {
	const trimmed = args.trim();

	const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i);
	if (!match) {
		return `Invalid duration: "${trimmed}". Use format: 500ms or 0.5s`;
	}

	const value = Number(match[1]);
	const unit = match[2]!.toLowerCase();
	const ms = unit === "s" ? value * 1000 : value;

	if (ms < 0 || !Number.isFinite(ms)) {
		return `Invalid duration value: ${value}${unit}`;
	}

	return { ms };
}

// ── /expect comparison ──────────────────────────────────────────────

const TRUTHY = new Set(["true", "1"]);
const FALSY = new Set(["false", "0"]);

/** Normalize a value to a canonical form for lenient comparison. */
function normalize(s: string): string {
	const lower = s.toLowerCase();
	if (TRUTHY.has(lower)) return "true";
	if (FALSY.has(lower)) return "false";
	return s;
}

/** Parse a percentage string ("25%") to its decimal value, or NaN. */
function parsePercent(s: string): number {
	if (s.endsWith("%")) {
		const n = Number(s.slice(0, -1));
		return Number.isNaN(n) ? NaN : n / 100;
	}
	return NaN;
}

/**
 * Compare an actual result string against an expected value.
 *
 * Comparison tiers (first match wins):
 * 1. Truthy/falsy coercion: true == 1 == "true" == "1", false == 0 == "false" == "0"
 * 2. Numeric with tolerance (including percentage: 0.25 == "25%")
 * 3. Case-insensitive string equality
 */
export function compareValues(
	actual: string,
	expected: string,
	tolerance: number,
): boolean {
	// 1. Truthy/falsy coercion
	const normActual = normalize(actual);
	const normExpected = normalize(expected);
	if (
		(TRUTHY.has(actual.toLowerCase()) || FALSY.has(actual.toLowerCase())) &&
		(TRUTHY.has(expected.toLowerCase()) || FALSY.has(expected.toLowerCase()))
	) {
		return normActual === normExpected;
	}

	// 2. Numeric comparison (with percentage support)
	let actualNum = Number(actual);
	let expectedNum = Number(expected);

	// Try percentage parsing if one side is a percent string
	if (Number.isNaN(actualNum)) actualNum = parsePercent(actual);
	if (Number.isNaN(expectedNum)) expectedNum = parsePercent(expected);

	if (!Number.isNaN(actualNum) && !Number.isNaN(expectedNum)) {
		return Math.abs(actualNum - expectedNum) <= tolerance;
	}

	// 3. Case-insensitive string equality
	return actual.toLowerCase() === expected.toLowerCase();
}
