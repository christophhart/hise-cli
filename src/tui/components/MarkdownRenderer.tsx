// ── MarkdownRenderer — AST to OutputLine[] ─────────────────────────

// Renders markdown AST nodes to OutputLine[] for consumption by Output.tsx
// and Overlay.tsx. Handles all markdown elements with density-aware styling.

import terminalLink from "terminal-link";
import type { OutputLine } from "./Output.js";
import type { ColorScheme } from "../theme.js";
import type { LayoutScale } from "../layout.js";
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
} from "../../engine/markdown/ast.js";
import { formatTable } from "./table.js";
import { tokenize } from "../../engine/highlight/hisescript.js";
import { tokenizeXml } from "../../engine/highlight/xml.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";

/**
 * Render a markdown AST to OutputLine[] for terminal display.
 * Applies density-aware styling, syntax highlighting, and clickable links.
 */
export function renderMarkdownToLines(
	ast: MarkdownAST,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
): OutputLine[] {
	const lines: OutputLine[] = [];

	for (const node of ast.nodes) {
		lines.push(...renderNode(node, scheme, layout, accent));
	}

	return lines;
}

// ── Block node rendering ────────────────────────────────────────────

function renderNode(
	node: MarkdownNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
): OutputLine[] {
	switch (node.type) {
		case "heading":
			return renderHeading(node, scheme, accent);
		case "paragraph":
			return renderParagraph(node, scheme);
		case "blockquote":
			return renderBlockquote(node, scheme, layout, accent);
		case "code":
			return renderCodeBlock(node, scheme);
		case "table":
			return formatTable(node.headers, node.rows, scheme, layout.density);
		case "list":
			return renderList(node, scheme, layout, accent);
		case "rule":
			return [{ text: "\u2500".repeat(60), color: scheme.foreground.muted }];
	}
}

function renderHeading(
	node: HeadingNode,
	scheme: ColorScheme,
	accent?: string,
): OutputLine[] {
	const text = renderInlineNodesToText(node.content);
	const color = node.level === 1 ? (accent || scheme.foreground.bright) : scheme.foreground.bright;

	const lines: OutputLine[] = [
		{ text, color },
	];

	// H1 gets 2 blank lines after, H2/H3 get 1
	const spacerCount = node.level === 1 ? 2 : 1;
	for (let i = 0; i < spacerCount; i++) {
		lines.push({ text: "", color: scheme.foreground.default });
	}

	return lines;
}

function renderParagraph(
	node: ParagraphNode,
	scheme: ColorScheme,
): OutputLine[] {
	const text = renderInlineNodesToText(node.content);
	// Split on newlines to prevent line breaks inside Ink <Text> components
	// This ensures each line gets its own OutputLine for proper rendering
	return text.split("\n").map((line) => ({
		text: line,
		color: scheme.foreground.default,
	}));
}

function renderBlockquote(
	node: BlockquoteNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
): OutputLine[] {
	const lines: OutputLine[] = [];

	// Recursively render child nodes
	for (const child of node.content) {
		const childLines = renderNode(child, scheme, layout, accent);
		// Prefix each line with vertical bar and apply muted color to all text
		for (const line of childLines) {
			lines.push({
				...line,
				prefix: (line.prefix || "") + "\u2502 ", // │
				prefixColor: scheme.foreground.muted,
				color: scheme.foreground.muted,  // Dim blockquoted text
			});
		}
	}

	return lines;
}

function renderCodeBlock(
	node: CodeBlockNode,
	scheme: ColorScheme,
): OutputLine[] {
	// Select tokenizer by language
	const tokenizer =
		node.language === "hisescript" || node.language === "javascript"
			? tokenize
			: node.language === "xml"
				? tokenizeXml
				: null;

	return node.content.split("\n").map((line) => {
		if (tokenizer && line.length > 0) {
			return {
				text: line,
				color: scheme.foreground.bright,
				spans: tokenizer(line),
			};
		}
		return { text: line, color: scheme.foreground.bright };
	});
}

function renderList(
	node: ListNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
): OutputLine[] {
	const lines: OutputLine[] = [];

	node.items.forEach((item, index) => {
		const marker = node.ordered ? `${index + 1}. ` : "\u2022 "; // • or 1.
		const itemLines: OutputLine[] = [];

		// Render all blocks within the item
		for (const block of item) {
			itemLines.push(...renderNode(block, scheme, layout, accent));
		}

		// Prefix first line with marker, subsequent lines with spaces
		if (itemLines.length > 0) {
			lines.push({
				...itemLines[0],
				text: marker + itemLines[0].text,
			});
			for (let i = 1; i < itemLines.length; i++) {
				lines.push({
					...itemLines[i],
					text: " ".repeat(marker.length) + itemLines[i].text,
				});
			}
		}
	});

	return lines;
}

// ── Inline node rendering ───────────────────────────────────────────

/**
 * Convert inline nodes to plain text with terminal-link for URLs.
 * Formatting (bold, italic, code) is flattened — TUI uses OutputLine.spans
 * for styling, not inline markup.
 */
function renderInlineNodesToText(nodes: InlineNode[]): string {
	return nodes.map(renderInlineNode).join("");
}

function renderInlineNode(node: InlineNode): string {
	switch (node.type) {
		case "text":
			return node.content;
		case "bold":
		case "italic":
			// Flatten formatting — TUI doesn't support nested inline styles
			return renderInlineNodesToText(node.content);
		case "code":
			return node.content;
		case "link":
			// Make links clickable with terminal-link
			return terminalLink(node.text, node.url, {
				fallback: (text, url) => `${text} (${url})`,
			});
	}
}
