// ── MarkdownRenderer — AST to OutputLine[] ─────────────────────────

// Renders markdown AST nodes to OutputLine[] for consumption by Output.tsx
// and Overlay.tsx. Handles all markdown elements with density-aware styling.

import terminalLink from "terminal-link";
import type { OutputLine } from "./Output.js";
import type { ColorScheme } from "../theme.js";
import type { LayoutScale } from "../layout.js";
import { lerpHex, darkenHex } from "../theme.js";
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
	context?: "overlay" | "output",
): OutputLine[] {
	const lines: OutputLine[] = [];
	const baseBg = context === "overlay" 
		? scheme.backgrounds.overlay 
		: scheme.backgrounds.standard;

	for (const node of ast.nodes) {
		lines.push(...renderNode(node, scheme, layout, accent, baseBg));
	}

	return lines;
}

// ── Block node rendering ────────────────────────────────────────────

function renderNode(
	node: MarkdownNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
	baseBg?: string,
): OutputLine[] {
	switch (node.type) {
		case "heading":
			return renderHeading(node, scheme, accent);
		case "paragraph":
			return renderParagraph(node, scheme, accent);
		case "blockquote":
			return renderBlockquote(node, scheme, layout, accent, baseBg);
		case "code":
			return renderCodeBlock(node, scheme, baseBg || scheme.backgrounds.standard);
		case "table":
			return formatTable(node.headers, node.rows, scheme, layout.density);
		case "list":
			return renderList(node, scheme, layout, accent, baseBg);
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
	
	// H1 and H2 use accent color, H3+ use bright
	const color = (node.level === 1 || node.level === 2)
		? (accent || scheme.foreground.bright)
		: scheme.foreground.bright;
	
	const lines: OutputLine[] = [];
	
	// All heading levels get 1 blank line before (padding above)
	lines.push({ text: "", color: scheme.foreground.default });
	
	// The heading line itself (H1, H2, H3 are bold)
	lines.push({
		text,
		color,
		bold: node.level <= 3,
	});
	
	// Spacing after: H1 gets 2, H2/H3 get 1
	const spacerCount = node.level === 1 ? 2 : 1;
	for (let i = 0; i < spacerCount; i++) {
		lines.push({ text: "", color: scheme.foreground.default });
	}

	return lines;
}

function renderParagraph(
	node: ParagraphNode,
	scheme: ColorScheme,
	accent?: string,
): OutputLine[] {
	const spans = renderInlineNodesToSpans(node.content, scheme, accent);
	
	return [{
		text: "",  // Empty since we use spans
		color: scheme.foreground.default,
		spans,
	}];
}

function renderBlockquote(
	node: BlockquoteNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
	baseBg?: string,
): OutputLine[] {
	const lines: OutputLine[] = [];

	// Recursively render child nodes
	for (const child of node.content) {
		const childLines = renderNode(child, scheme, layout, accent, baseBg);
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
	baseBg: string,
): OutputLine[] {
	const codeBg = darkenHex(baseBg, 0.95);
	
	// Select tokenizer by language
	const tokenizer =
		node.language === "hisescript" || node.language === "javascript"
			? tokenize
			: node.language === "xml"
				? tokenizeXml
				: null;
	
	const lines: OutputLine[] = [];
	
	// EXTERNAL padding top (normal background)
	lines.push({ 
		text: "", 
		color: scheme.foreground.default,
		bgColor: baseBg
	});
	
	// INTERNAL padding top (code background)
	lines.push({ 
		text: "", 
		color: scheme.foreground.default,
		bgColor: codeBg
	});
	
	// Code content lines (with code background + syntax highlighting)
	node.content.split("\n").forEach((line) => {
		const outputLine: OutputLine = {
			text: line,
			color: scheme.foreground.bright,
			bgColor: codeBg,
		};
		
		if (tokenizer && line.length > 0) {
			outputLine.spans = tokenizer(line);
		}
		
		lines.push(outputLine);
	});
	
	// INTERNAL padding bottom (code background)
	lines.push({ 
		text: "", 
		color: scheme.foreground.default,
		bgColor: codeBg
	});
	
	// EXTERNAL padding bottom (normal background)
	lines.push({ 
		text: "", 
		color: scheme.foreground.default,
		bgColor: baseBg
	});
	
	return lines;
}

function renderList(
	node: ListNode,
	scheme: ColorScheme,
	layout: LayoutScale,
	accent?: string,
	baseBg?: string,
): OutputLine[] {
	const lines: OutputLine[] = [];

	node.items.forEach((item, index) => {
		const marker = node.ordered ? `${index + 1}. ` : "\u2022 "; // • or 1.
		const itemLines: OutputLine[] = [];

		// Render all blocks within the item
		for (const block of item) {
			itemLines.push(...renderNode(block, scheme, layout, accent, baseBg));
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
 * Render inline nodes to TokenSpan[] instead of flattening to text.
 * Preserves inline code with special styling (blended color).
 */
function renderInlineNodesToSpans(
	content: InlineNode[],
	scheme: ColorScheme,
	accent?: string,
): TokenSpan[] {
	const spans: TokenSpan[] = [];
	const textColor = scheme.foreground.default;
	const inlineCodeColor = accent 
		? lerpHex(textColor, accent, 0.4)  // 40% blend with accent
		: scheme.foreground.bright;
	
	for (const node of content) {
		if (node.type === "text") {
			spans.push({ 
				text: node.content, 
				token: "plain",
				color: textColor,
			});
		} else if (node.type === "code") {
			// Inline code gets blended color (no background)
			spans.push({ 
				text: node.content, 
				token: "keyword",
				color: inlineCodeColor,
			});
		} else if (node.type === "bold") {
			// Recursively handle bold - flatten for now
			const boldText = renderInlineNodesToText(node.content);
			spans.push({ 
				text: boldText, 
				token: "plain",
				color: textColor,
			});
		} else if (node.type === "italic") {
			// Recursively handle italic - flatten for now
			const italicText = renderInlineNodesToText(node.content);
			spans.push({ 
				text: italicText, 
				token: "plain",
				color: textColor,
			});
		} else if (node.type === "link") {
			// Flatten link to text with terminal-link
			const linkText = terminalLink(node.text, node.url, {
				fallback: (text, url) => `${text} (${url})`,
			});
			spans.push({ 
				text: linkText, 
				token: "plain",
				color: textColor,
			});
		}
	}
	
	return spans;
}

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
