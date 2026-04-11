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

		// Skip empty lines and comments
		if (trimmed === "" || trimmed.startsWith("#")) continue;

		lines.push({
			lineNumber: i + 1,
			raw,
			content: trimmed,
			kind: trimmed.startsWith("/") ? "slash" : "command",
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

/**
 * Compare an actual result string against an expected value.
 * - If both parse as numbers: float comparison with tolerance
 * - Otherwise: strict string equality
 */
export function compareValues(
	actual: string,
	expected: string,
	tolerance: number,
): boolean {
	const actualNum = Number(actual);
	const expectedNum = Number(expected);

	if (!Number.isNaN(actualNum) && !Number.isNaN(expectedNum)) {
		return Math.abs(actualNum - expectedNum) <= tolerance;
	}

	return actual === expected;
}
