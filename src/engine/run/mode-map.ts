// ── Mode map — per-line mode tracking for multiline editors ─────────

import type { ModeId } from "../modes/mode.js";
import { MODE_ACCENTS } from "../modes/mode.js";
import type { TokenSpan } from "../highlight/tokens.js";

export interface ModeMapEntry {
	/** The active mode for this line */
	modeId: ModeId;
	/** This line IS a mode-entry command (/builder, /script, etc.) */
	isModeEntry: boolean;
	/** This line IS /exit */
	isModeExit: boolean;
	/** Accent color for the active mode */
	accent: string;
}

const MODE_IDS = new Set<string>([
	"builder", "script", "dsp", "sampler", "inspect",
	"project", "compile", "undo", "ui",
]);

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
		if (trimmed === "" || trimmed.startsWith("#")) {
			map.push({ modeId: current, isModeEntry: false, isModeExit: false, accent: MODE_ACCENTS[current] });
			continue;
		}

		if (trimmed.startsWith("/")) {
			const match = trimmed.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)/);
			const cmdName = match?.[1] ?? "";

			if (MODE_IDS.has(cmdName)) {
				const modeId = cmdName as ModeId;
				const rest = trimmed.slice(match![0].length).trim();

				if (rest) {
					// One-shot: mode for this line only, don't push stack
					map.push({ modeId, isModeEntry: true, isModeExit: false, accent: MODE_ACCENTS[modeId] });
				} else {
					// Enter mode
					modeStack.push(modeId);
					map.push({ modeId, isModeEntry: true, isModeExit: false, accent: MODE_ACCENTS[modeId] });
				}
				continue;
			}

			if (cmdName === "exit") {
				map.push({ modeId: current, isModeEntry: false, isModeExit: true, accent: MODE_ACCENTS[current] });
				if (modeStack.length > 1) modeStack.pop();
				continue;
			}

			// Other slash commands (tool commands, builtins) — current mode
			map.push({ modeId: current, isModeEntry: false, isModeExit: false, accent: MODE_ACCENTS[current] });
			continue;
		}

		// Non-slash: mode-specific command in current mode
		map.push({ modeId: current, isModeEntry: false, isModeExit: false, accent: MODE_ACCENTS[current] });
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

type Tokenizer = (source: string) => TokenSpan[];

const MODE_TOKENIZERS: Partial<Record<ModeId, Tokenizer>> = {
	builder: tokenizeBuilder,
	script: tokenizeHiseScript,
	ui: tokenizeUi,
	undo: tokenizeUndo,
	inspect: tokenizeInspect,
};

/**
 * Select the correct tokenizer for a given line based on its mode map entry.
 * Slash command lines always use the slash tokenizer.
 * Mode-specific lines use the mode's tokenizer (if available).
 */
/** Tokenizer that returns the entire line as a comment span. */
function tokenizeComment(source: string): TokenSpan[] {
	return [{ text: source, token: "comment" }];
}

export function tokenizerForLine(entry: ModeMapEntry, lineText: string): Tokenizer | undefined {
	const trimmed = lineText.trim();
	if (trimmed.startsWith("#")) return tokenizeComment;
	if (trimmed.startsWith("/")) return tokenizeSlash;
	return MODE_TOKENIZERS[entry.modeId];
}
