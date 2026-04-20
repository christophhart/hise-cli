// ── Public entry point — fence-language to tokenizer mapping ────────

// Barrel for external consumers (e.g. docs website) and internal use.
// Pairs fence language strings with the matching tokenizer.

import { tokenize as tokenizeHsc } from "./hisescript.js";
import { tokenizeBuilder } from "./builder.js";
import { tokenizeDsp } from "./dsp.js";
import { tokenizeUi } from "./ui.js";
import { tokenizeSequence } from "./sequence.js";
import { tokenizeInspect } from "./inspect.js";
import { tokenizeUndo } from "./undo.js";
import { tokenizeSlash } from "./slash.js";
import { tokenizeXml } from "./xml.js";
import type { TokenSpan } from "./tokens.js";

export { TOKEN_COLORS } from "./tokens.js";
export type { TokenSpan, TokenType } from "./tokens.js";
export { MODE_ACCENTS, SLASH_MODE_IDS } from "./constants.js";

export type HiseLanguage =
	| "hsc"
	| "builder"
	| "dsp"
	| "ui"
	| "sequence"
	| "inspect"
	| "undo"
	| "slash"
	| "xml";

const TOKENIZERS: Record<HiseLanguage, (source: string) => TokenSpan[]> = {
	hsc: tokenizeHsc,
	builder: tokenizeBuilder,
	dsp: tokenizeDsp,
	ui: tokenizeUi,
	sequence: tokenizeSequence,
	inspect: tokenizeInspect,
	undo: tokenizeUndo,
	slash: tokenizeSlash,
	xml: tokenizeXml,
};

/** Returns null for unsupported languages so caller can fall through
 *  to a default highlighter. */
export function tokenizeHise(language: string, source: string): TokenSpan[] | null {
	const tokenizer = TOKENIZERS[language as HiseLanguage];
	return tokenizer ? tokenizer(source) : null;
}

export function isHiseLanguage(language: string): language is HiseLanguage {
	return language in TOKENIZERS;
}
