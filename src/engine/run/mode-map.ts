// ── Mode map — per-line mode tracking for multiline editors ─────────

import type { ModeId } from "../modes/mode.js";
import { MODE_ACCENTS, SLASH_MODE_IDS } from "../modes/mode.js";
import type { TokenSpan } from "../highlight/tokens.js";

export interface ModeMapEntry {
	/** The active mode for this line */
	modeId: ModeId;
	/** This line IS a mode-entry command (/builder, /script, etc.) */
	isModeEntry: boolean;
	/** This line IS a one-shot mode command (/script Math.random(), /builder add X) */
	isOneShot: boolean;
	/** This line IS /exit */
	isModeExit: boolean;
	/** Accent color for the active mode */
	accent: string;
}

const MODE_IDS = SLASH_MODE_IDS;

/**
 * Build a mode map from raw lines. Each entry describes which mode
 * is active for that line, whether it's a mode-entry line, and the
 * accent color. Used for per-line syntax highlighting and gutter indicators.
 */
export function buildModeMap(lines: string[]): ModeMapEntry[] {
	const map: ModeMapEntry[] = [];
	const modeStack: ModeId[] = ["root"];

	for (const line of lines) {
		const trimmed = line.trim();
		const current = modeStack[modeStack.length - 1]!;

		// Empty/comment lines inherit current mode
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith("//")) {
			map.push({ modeId: current, isModeEntry: false, isOneShot: false, isModeExit: false, accent: MODE_ACCENTS[current] });
			continue;
		}

		if (trimmed.startsWith("/")) {
			const match = trimmed.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)/);
			const cmdName = match?.[1] ?? "";

			if (MODE_IDS.has(cmdName)) {
				const modeId = (cmdName === "export" ? "compile" : cmdName) as ModeId;
				const rest = trimmed.slice(match![0].length).trim();

				if (rest) {
					// One-shot: mode for this line only, don't push stack
					map.push({ modeId, isModeEntry: true, isOneShot: true, isModeExit: false, accent: MODE_ACCENTS[modeId] });
				} else {
					// Enter mode
					modeStack.push(modeId);
					map.push({ modeId, isModeEntry: true, isOneShot: false, isModeExit: false, accent: MODE_ACCENTS[modeId] });
				}
				continue;
			}

			if (cmdName === "exit") {
				map.push({ modeId: current, isModeEntry: false, isOneShot: false, isModeExit: true, accent: MODE_ACCENTS[current] });
				if (modeStack.length > 1) modeStack.pop();
				continue;
			}

			// Other slash commands (tool commands, builtins) — current mode
			map.push({ modeId: current, isModeEntry: false, isOneShot: false, isModeExit: false, accent: MODE_ACCENTS[current] });
			continue;
		}

		// Non-slash: mode-specific command in current mode
		map.push({ modeId: current, isModeEntry: false, isOneShot: false, isModeExit: false, accent: MODE_ACCENTS[current] });
	}

	return map;
}

// ── Per-line tokenizer selection ────────────────────────────────────

import { tokenizeSlash } from "../highlight/slash.js";
import { tokenizeBuilder } from "../highlight/builder.js";
import { tokenize as tokenizeHiseScript } from "../highlight/hisescript.js";
import { tokenizeUi } from "../highlight/ui.js";
import { tokenizeUndo } from "../highlight/undo.js";
import { tokenizeInspect } from "../highlight/inspect.js";
import { tokenizeSequence } from "../highlight/sequence.js";

type Tokenizer = (source: string) => TokenSpan[];

const MODE_TOKENIZERS: Partial<Record<ModeId, Tokenizer>> = {
	builder: tokenizeBuilder,
	script: tokenizeHiseScript,
	ui: tokenizeUi,
	undo: tokenizeUndo,
	inspect: tokenizeInspect,
	sequence: tokenizeSequence,
};

/**
 * Select the correct tokenizer for a given line based on its mode map entry.
 * Slash command lines always use the slash tokenizer.
 * Mode-specific lines use the mode's tokenizer (if available).
 */
/** Tokenizer that returns the entire line as a comment span. */
function tokenizeFullComment(source: string): TokenSpan[] {
	return [{ text: source, token: "comment" }];
}

/**
 * Find the start of an inline comment (# or //) in a line,
 * respecting quoted strings. Returns -1 if no comment found.
 */
function findInlineComment(text: string): number {
	let inDouble = false;
	let inSingle = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
		if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
		if (inDouble || inSingle) continue;
		if (ch === "#") return i;
		if (ch === "/" && text[i + 1] === "/") return i;
	}
	return -1;
}

/**
 * Wrap a mode tokenizer to handle inline comments.
 * Splits at the comment start, tokenizes the code part with the mode
 * tokenizer, and appends the comment as a dimmed span.
 */
function withInlineComment(base: Tokenizer | undefined, lineText: string): TokenSpan[] {
	const commentIdx = findInlineComment(lineText);
	if (commentIdx <= 0) {
		// No inline comment (or full-line comment handled elsewhere)
		return base ? base(lineText) : [{ text: lineText, token: "plain" }];
	}
	const codePart = lineText.slice(0, commentIdx);
	const commentPart = lineText.slice(commentIdx);
	const codeSpans = base ? base(codePart) : [{ text: codePart, token: "plain" as const }];
	return [...codeSpans, { text: commentPart, token: "comment" as const }];
}

export function tokenizerForLine(entry: ModeMapEntry, lineText: string): Tokenizer | undefined {
	const trimmed = lineText.trim();
	// Full-line comments (# or //)
	if (trimmed.startsWith("#") || trimmed.startsWith("//")) return tokenizeFullComment;
	// Slash commands (but not //)
	if (trimmed.startsWith("/")) {
		// Check for inline comment
		const commentIdx = findInlineComment(lineText);
		if (commentIdx > 0) {
			return (src: string) => withInlineComment(tokenizeSlash, src);
		}
		return tokenizeSlash;
	}
	// Mode-specific with inline comment support
	const baseTokenizer = MODE_TOKENIZERS[entry.modeId];
	const commentIdx = findInlineComment(lineText);
	if (commentIdx > 0) {
		return (src: string) => withInlineComment(baseTokenizer, src);
	}
	return baseTokenizer;
}
