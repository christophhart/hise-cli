// ── Markdown Parser — marked integration ────────────────────────────

// Parse markdown strings to our isomorphic AST using the `marked` library.
// The parser transforms marked's token stream into our plain data structure.

import { marked, type Token, type Tokens } from "marked";
import type {
	MarkdownAST,
	MarkdownNode,
	InlineNode,
	HeadingNode,
	ParagraphNode,
	BlockquoteNode,
	CodeBlockNode,
	TableNode,
	ListNode,
} from "./ast.js";

// ── Main parser entry point ─────────────────────────────────────────

export function parseMarkdown(source: string): MarkdownAST {
	const tokens = marked.lexer(source);
	const nodes: MarkdownNode[] = [];

	for (const token of tokens) {
		const node = parseBlockToken(token);
		if (node) {
			nodes.push(node);
		}
	}

	return { nodes };
}

// ── Block token parsing ─────────────────────────────────────────────

function parseBlockToken(token: Token): MarkdownNode | null {
	switch (token.type) {
		case "heading":
			return parseHeading(token as Tokens.Heading);
		case "paragraph":
			return parseParagraph(token as Tokens.Paragraph);
		case "blockquote":
			return parseBlockquote(token as Tokens.Blockquote);
		case "code":
			return parseCodeBlock(token as Tokens.Code);
		case "table":
			return parseTable(token as Tokens.Table);
		case "list":
			return parseList(token as Tokens.List);
		case "hr":
			return { type: "rule" };
		case "space":
			// Skip whitespace-only tokens
			return null;
		default:
			// Unknown block type — skip
			return null;
	}
}

function parseHeading(token: Tokens.Heading): HeadingNode {
	return {
		type: "heading",
		level: token.depth as 1 | 2 | 3 | 4 | 5 | 6,
		content: parseInlineTokens(token.tokens),
	};
}

function parseParagraph(token: Tokens.Paragraph): ParagraphNode {
	return {
		type: "paragraph",
		content: parseInlineTokens(token.tokens),
	};
}

function parseBlockquote(token: Tokens.Blockquote): BlockquoteNode {
	const content: MarkdownNode[] = [];
	for (const child of token.tokens) {
		const node = parseBlockToken(child);
		if (node) {
			content.push(node);
		}
	}
	return {
		type: "blockquote",
		content,
	};
}

function parseCodeBlock(token: Tokens.Code): CodeBlockNode {
	return {
		type: "code",
		language: token.lang || undefined,
		content: token.text,
	};
}

function parseTable(token: Tokens.Table): TableNode {
	// Extract header text from tokens
	const headers = token.header.map((cell) => {
		const inlineNodes = parseInlineTokens(cell.tokens);
		return inlineNodesToPlainText(inlineNodes);
	});

	// Extract row text from tokens
	const rows = token.rows.map((row) =>
		row.map((cell) => {
			const inlineNodes = parseInlineTokens(cell.tokens);
			return inlineNodesToPlainText(inlineNodes);
		}),
	);

	return {
		type: "table",
		headers,
		rows,
	};
}

function parseList(token: Tokens.List): ListNode {
	const items: MarkdownNode[][] = [];

	for (const item of token.items) {
		const itemNodes: MarkdownNode[] = [];
		for (const child of item.tokens) {
			const node = parseBlockToken(child);
			if (node) {
				itemNodes.push(node);
			}
		}
		items.push(itemNodes);
	}

	return {
		type: "list",
		ordered: token.ordered,
		items,
	};
}

// ── Inline token parsing ────────────────────────────────────────────

function parseInlineTokens(tokens: Token[]): InlineNode[] {
	const nodes: InlineNode[] = [];

	for (const token of tokens) {
		const node = parseInlineToken(token);
		if (node) {
			if (Array.isArray(node)) {
				nodes.push(...node);
			} else {
				nodes.push(node);
			}
		}
	}

	return nodes;
}

function parseInlineToken(
	token: Token,
): InlineNode | InlineNode[] | null {
	switch (token.type) {
		case "text":
			return { type: "text", content: token.text };
		case "strong":
			return {
				type: "bold",
				content: parseInlineTokens(token.tokens || []),
			};
		case "em":
			return {
				type: "italic",
				content: parseInlineTokens(token.tokens || []),
			};
		case "codespan":
			return { type: "code", content: token.text };
		case "link":
			return {
				type: "link",
				text: token.text,
				url: token.href,
			};
		case "escape":
			// Escaped character — treat as plain text
			return { type: "text", content: token.text };
		case "br":
			// Line break — treat as newline text
			return { type: "text", content: "\n" };
		default:
			// Unknown inline type — skip
			return null;
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Convert inline nodes to plain text (for table cells). */
function inlineNodesToPlainText(nodes: InlineNode[]): string {
	return nodes
		.map((node) => {
			switch (node.type) {
				case "text":
					return node.content;
				case "bold":
				case "italic":
					return inlineNodesToPlainText(node.content);
				case "code":
					return node.content;
				case "link":
					return node.text;
			}
		})
		.join("");
}
