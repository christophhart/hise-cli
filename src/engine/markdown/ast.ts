// ── Markdown AST — plain data structure ────────────────────────────

// Isomorphic markdown abstract syntax tree. No DOM, no terminal escapes,
// no Ink components. The same AST feeds TUI renderer (Ink), CLI renderer
// (ANSI), and future web renderer (react-markdown).

// ── Block-level nodes ───────────────────────────────────────────────

export type MarkdownNode =
	| HeadingNode
	| ParagraphNode
	| BlockquoteNode
	| CodeBlockNode
	| TableNode
	| ListNode
	| RuleNode;

export interface HeadingNode {
	type: "heading";
	level: 1 | 2 | 3 | 4 | 5 | 6;
	content: InlineNode[];
}

export interface ParagraphNode {
	type: "paragraph";
	content: InlineNode[];
}

export interface BlockquoteNode {
	type: "blockquote";
	/** Nested block content (paragraphs, lists, code, etc.) */
	content: MarkdownNode[];
}

export interface CodeBlockNode {
	type: "code";
	language?: string;
	content: string;
}

export interface TableNode {
	type: "table";
	headers: string[];
	rows: string[][];
}

export interface ListNode {
	type: "list";
	ordered: boolean;
	/** Each item is an array of block nodes (paragraphs, nested lists, etc.) */
	items: MarkdownNode[][];
}

export interface RuleNode {
	type: "rule";
}

// ── Inline nodes ────────────────────────────────────────────────────

export type InlineNode =
	| TextNode
	| BoldNode
	| ItalicNode
	| InlineCodeNode
	| LinkNode;

export interface TextNode {
	type: "text";
	content: string;
}

export interface BoldNode {
	type: "bold";
	content: InlineNode[];
}

export interface ItalicNode {
	type: "italic";
	content: InlineNode[];
}

export interface InlineCodeNode {
	type: "code";
	content: string;
}

export interface LinkNode {
	type: "link";
	text: string;
	url: string;
}

// ── Document root ───────────────────────────────────────────────────

export interface MarkdownAST {
	nodes: MarkdownNode[];
}

// ── Type guards ─────────────────────────────────────────────────────

export function isHeading(node: MarkdownNode): node is HeadingNode {
	return node.type === "heading";
}

export function isParagraph(node: MarkdownNode): node is ParagraphNode {
	return node.type === "paragraph";
}

export function isBlockquote(node: MarkdownNode): node is BlockquoteNode {
	return node.type === "blockquote";
}

export function isCodeBlock(node: MarkdownNode): node is CodeBlockNode {
	return node.type === "code";
}

export function isTable(node: MarkdownNode): node is TableNode {
	return node.type === "table";
}

export function isList(node: MarkdownNode): node is ListNode {
	return node.type === "list";
}

export function isRule(node: MarkdownNode): node is RuleNode {
	return node.type === "rule";
}

export function isText(node: InlineNode): node is TextNode {
	return node.type === "text";
}

export function isBold(node: InlineNode): node is BoldNode {
	return node.type === "bold";
}

export function isItalic(node: InlineNode): node is ItalicNode {
	return node.type === "italic";
}

export function isInlineCode(node: InlineNode): node is InlineCodeNode {
	return node.type === "code";
}

export function isLink(node: InlineNode): node is LinkNode {
	return node.type === "link";
}
