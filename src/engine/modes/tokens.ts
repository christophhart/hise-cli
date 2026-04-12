// ── Shared Chevrotain token types ───────────────────────────────────

// Reused by builder, DSP, and sampler mode grammars. Each grammar
// extends this base set with mode-specific keywords.

import { createToken, Lexer } from "chevrotain";

// ── Whitespace (skipped) ────────────────────────────────────────────
export const WhiteSpace = createToken({
	name: "WhiteSpace",
	pattern: /\s+/,
	group: Lexer.SKIPPED,
});

// ── Literals ────────────────────────────────────────────────────────
export const QuotedString = createToken({
	name: "QuotedString",
	pattern: /"(?:[^"\\]|\\.)*"/,
});

export const NumberLiteral = createToken({
	name: "NumberLiteral",
	pattern: /-?\d+(\.\d+)?/,
});

// Multiplier token: x4, x10, etc. Must come before Identifier.
export const XCount = createToken({
	name: "XCount",
	pattern: /x\d+/i,
});

// ── Identifiers ─────────────────────────────────────────────────────
export const DotPath = createToken({
	name: "DotPath",
	pattern: /[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+ /,
	longer_alt: undefined, // resolved below
});

export const Identifier = createToken({
	name: "Identifier",
	pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
});

// DotPath must be tried before Identifier (longer match wins)
// but since DotPath has a trailing space requirement we handle
// this differently in the builder grammar.

// ── Builder keywords ────────────────────────────────────────────────
export const Add = createToken({
	name: "Add",
	pattern: /add/i,
	longer_alt: Identifier,
});

export const Clone = createToken({
	name: "Clone",
	pattern: /clone/i,
	longer_alt: Identifier,
});

export const Remove = createToken({
	name: "Remove",
	pattern: /remove/i,
	longer_alt: Identifier,
});

export const Move = createToken({
	name: "Move",
	pattern: /move/i,
	longer_alt: Identifier,
});

export const Rename = createToken({
	name: "Rename",
	pattern: /rename/i,
	longer_alt: Identifier,
});

export const Load = createToken({
	name: "Load",
	pattern: /load/i,
	longer_alt: Identifier,
});

export const Into = createToken({
	name: "Into",
	pattern: /into/i,
	longer_alt: Identifier,
});

export const Bypass = createToken({
	name: "Bypass",
	pattern: /bypass/i,
	longer_alt: Identifier,
});

export const Enable = createToken({
	name: "Enable",
	pattern: /enable/i,
	longer_alt: Identifier,
});

export const Show = createToken({
	name: "Show",
	pattern: /show/i,
	longer_alt: Identifier,
});

export const Set = createToken({
	name: "Set",
	pattern: /set/i,
	longer_alt: Identifier,
});

export const Get = createToken({
	name: "Get",
	pattern: /get/i,
	longer_alt: Identifier,
});

export const To = createToken({
	name: "To",
	pattern: /to/i,
	longer_alt: Identifier,
});

export const As = createToken({
	name: "As",
	pattern: /as/i,
	longer_alt: Identifier,
});

export const Tree = createToken({
	name: "Tree",
	pattern: /tree/i,
	longer_alt: Identifier,
});

export const Types = createToken({
	name: "Types",
	pattern: /types/i,
	longer_alt: Identifier,
});

// ── UI keywords ────────────────────────────────────────────────────
export const At = createToken({
	name: "At",
	pattern: /at/i,
	longer_alt: Identifier,
});

// ── Punctuation ─────────────────────────────────────────────────────
export const Dot = createToken({
	name: "Dot",
	pattern: /\./,
});

export const Comma = createToken({
	name: "Comma",
	pattern: /,/,
});

// ── Token order for the builder lexer ───────────────────────────────
// Keywords must come before Identifier so they match first.
// XCount must come before Identifier (x4 should not lex as Identifier).

export const BUILDER_TOKENS = [
	WhiteSpace,
	QuotedString,
	NumberLiteral,
	XCount,
	Add,
	Clone,
	Remove,
	Move,
	Rename,
	Load,
	Into,
	Bypass,
	Enable,
	Show,
	Set,
	Get,
	To,
	As,
	Tree,
	Types,
	Comma,
	Dot,
	Identifier,
];

// ── Verb keywords (for comma pre-processor) ────────────────────────
const _Set = globalThis.Set;
export const VERB_KEYWORDS: ReadonlySet<string> = new _Set([
	"add", "clone", "remove", "move", "rename",
	"load", "set", "get", "show", "bypass", "enable",
]);

export const builderLexer = new Lexer(BUILDER_TOKENS);

// ── UI mode token order ─────────────────────────────────────────────
// Shares most tokens with builder but adds At, drops builder-only tokens.

export const UI_TOKENS = [
	WhiteSpace,
	QuotedString,
	NumberLiteral,
	Add,
	Remove,
	Move,
	Rename,
	Into,
	Show,
	Set,
	Get,
	To,
	As,
	At,
	Comma,
	Dot,
	Identifier,
];

export const UI_VERB_KEYWORDS: ReadonlySet<string> = new _Set([
	"add", "remove", "move", "rename", "set", "get", "show",
]);

export const uiLexer = new Lexer(UI_TOKENS);
