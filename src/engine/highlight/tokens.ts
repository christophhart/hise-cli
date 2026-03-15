// ── Token types and color mapping for syntax highlighting ───────────

// Layer 3 colors from TUI_STYLE.md — hardcoded, matches HISE editor.

export type TokenType =
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
	| "plain";

export const TOKEN_COLORS: Record<TokenType, string> = {
	keyword: "#bbbbff",
	identifier: "#DDDDFF",
	scopedStatement: "#88bec5",
	integer: "#DDAADD",
	float: "#EEAA00",
	string: "#DDAAAA",
	comment: "#77CC77",
	operator: "#CCCCCC",
	bracket: "#FFFFFF",
	punctuation: "#CCCCCC",
	plain: "#DDDDFF",
} as const;

export interface TokenSpan {
	text: string;
	token: TokenType;
}
