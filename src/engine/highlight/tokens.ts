// ── Token types and color mapping for syntax highlighting ───────────

// Hardcoded syntax-highlighting colors matching the HISE C++ editor.
// Mode token types use MODE_ACCENTS from mode.ts as their colors.

import { MODE_ACCENTS } from "./constants.js";

export type TokenType =
	// Language tokens
	| "keyword"
	| "identifier"
	| "scopedStatement"
	| "integer"
	| "float"
	| "string"
	| "comment"
	| "operator"
	| "bracket"
	| "punctuation"
	| "plain"
	// Slash command tokens
	| "command"      // generic slash commands (/help, /exit, etc.)
	// Mode-colored tokens (slash commands that enter modes)
	| "builder"
	| "script"
	| "dsp"
	| "sampler"
	| "inspect"
	| "project"
	| "export"
	| "compile"
	| "undo"
	| "ui"
	| "sequence"
	| "hise"
	| "analyse";

export const TOKEN_COLORS: Record<TokenType, string> = {
	// Language tokens
	keyword: "#bbbbff",
	identifier: "#DDDDFF",
	scopedStatement: "#88bec5",
	integer: "#DDAADD",
	float: "#EEAA00",
	string: "#DDAAAA",
	comment: "#666666",
	operator: "#CCCCCC",
	bracket: "#FFFFFF",
	punctuation: "#CCCCCC",
	plain: "#DDDDFF",
	// Slash command tokens
	command: "#FFFFFF",
	// Mode-colored tokens — accent colors from MODE_ACCENTS
	builder: MODE_ACCENTS.builder,
	script: MODE_ACCENTS.script,
	dsp: MODE_ACCENTS.dsp,
	sampler: MODE_ACCENTS.sampler,
	inspect: MODE_ACCENTS.inspect,
	project: MODE_ACCENTS.project,
	export: MODE_ACCENTS.compile,
	compile: MODE_ACCENTS.compile,
	undo: MODE_ACCENTS.undo,
	ui: MODE_ACCENTS.ui,
	sequence: MODE_ACCENTS.sequence,
	hise: MODE_ACCENTS.hise,
	analyse: MODE_ACCENTS.analyse,
} as const;

export interface TokenSpan {
	text: string;
	token: TokenType;
	/** Optional direct color override (hex string). When present, takes
	 *  precedence over TOKEN_COLORS mapping. Used for theme-aware colors
	 *  like table cell separators. */
	color?: string;
	/** When true, render this span in bold. */
	bold?: boolean;
}
