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

// ── Punctuation ─────────────────────────────────────────────────────
export const Dot = createToken({
	name: "Dot",
	pattern: /\./,
});

// ── Token order for the builder lexer ───────────────────────────────
// Keywords must come before Identifier so they match first.

export const BUILDER_TOKENS = [
	WhiteSpace,
	QuotedString,
	NumberLiteral,
	Add,
	Show,
	Set,
	To,
	As,
	Tree,
	Types,
	Dot,
	Identifier,
];

export const builderLexer = new Lexer(BUILDER_TOKENS);
