// ── Output — virtual scrolling output with result rendering ─────────

// Performance rules from DESIGN.md:
// - History is a plain array, not React state
// - Only visible slice enters the React tree
// - Scroll offset is a useRef (no re-render on scroll)
// - Syntax highlighting is pre-computed (cached ANSI strings)
// - React.memo on the component
// - Cap at 10,000 lines

import React from "react";
import { Box, Text } from "ink";
import type { CommandResult, TreeNode } from "../../engine/result.js";
import { brand, darkenHex, type ColorScheme } from "../theme.js";
import { useTheme } from "../theme-context.js";
import { scrollbarChar } from "./scrollbar.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";
import { tokenize } from "../../engine/highlight/hisescript.js";
import { tokenizeXml } from "../../engine/highlight/xml.js";
import { LandingLogo } from "./LandingLogo.js";
import { formatTable as formatTableShared } from "./table.js";
import type { LayoutScale } from "../layout.js";
import { parseMarkdown } from "../../engine/markdown/parser.js";
import { renderMarkdownToLines } from "./MarkdownRenderer.js";

// ── Output line model ───────────────────────────────────────────────

export interface OutputLine {
	text: string;
	color: string;
	prefix?: string;
	prefixColor?: string;
	borderColor?: string;  // left border ▎ color (mode accent)
	bgColor?: string;
	bold?: boolean;  // render text in bold (does not affect prefix/border)
	/** Pre-computed syntax highlighting spans. When present, rendered as
	 *  per-token colored <Text> elements instead of a single flat color. */
	spans?: TokenSpan[];
}

export const MAX_HISTORY_LINES = 10000;

/**
 * Darken all colors in an OutputLine array.
 * Returns a new array with every color field darkened by the factor.
 */
export function darkenOutputLines(
	lines: OutputLine[],
	factor: number,
): OutputLine[] {
	return lines.map((line) => ({
		text: line.text,
		color: darkenHex(line.color, factor),
		prefix: line.prefix,
		prefixColor: line.prefixColor ? darkenHex(line.prefixColor, factor) : undefined,
		borderColor: line.borderColor ? darkenHex(line.borderColor, factor) : undefined,
		bgColor: line.bgColor ? darkenHex(line.bgColor, factor) : undefined,
		// Drop spans in dimmed lines — TOKEN_COLORS are static and can't be
		// dimmed per-span. Falls back to the already-darkened flat color.
		spans: undefined,
	}));
}

// ── Result → OutputLine conversion ──────────────────────────────────

export function resultToLines(
	result: CommandResult,
	scheme: ColorScheme,
	layout: LayoutScale,
): OutputLine[] {
	switch (result.type) {
		case "empty":
			return [];
		case "text":
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
			}));
		case "error":
			return [
				{
					text: result.message,
					color: brand.error,
					prefix: "\u2717 ",
					prefixColor: brand.error,
				},
				...(result.detail
					? result.detail.split("\n").map((line) => ({
						text: line,
						color: scheme.foreground.muted,
					}))
					: []),
			];
		case "code": {
			// Select tokenizer by language
			const codeTokenizer = result.language === "xml"
				? tokenizeXml
				: (result.language === "hisescript" || result.language === "javascript")
					? tokenize
					: null;

			return result.content.split("\n").map((line) => {
				if (codeTokenizer && line.length > 0) {
					return {
						text: line,
						color: scheme.foreground.bright,
						spans: codeTokenizer(line),
					};
				}
				return { text: line, color: scheme.foreground.bright };
			});
		}
		case "table":
			return formatTableShared(result.headers, result.rows, scheme, layout.density);
		case "tree":
			return formatTree(result.root, scheme);
		case "markdown": {
			const ast = parseMarkdown(result.content);
			return renderMarkdownToLines(ast, scheme, layout, result.accent);
		}
		case "overlay":
			// Overlay results are handled by App (shows Overlay component).
			// If we get here, fall through to empty for non-TUI contexts.
			return [];
	}
}

function formatTree(
	node: TreeNode,
	scheme: ColorScheme,
	prefix = "",
	isLast = true,
): OutputLine[] {
	const connector = isLast ? "\u2514\u2500\u2500 " : "\u251C\u2500\u2500 "; // └── or ├──
	const label = node.type
		? `${node.label} (${node.type})`
		: node.label;

	const lines: OutputLine[] = [
		{
			text: prefix ? `${prefix}${connector}${label}` : label,
			color: scheme.foreground.bright,
		},
	];

	if (node.children) {
		const childPrefix = prefix + (isLast ? "    " : "\u2502   "); // │
		node.children.forEach((child, i) => {
			const childIsLast = i === node.children!.length - 1;
			lines.push(...formatTree(child, scheme, childPrefix, childIsLast));
		});
	}

	return lines;
}

// ── Spacer line (empty row for vertical breathing room) ─────────────

export function spacerLine(scheme: ColorScheme, borderColor?: string, bgColor?: string): OutputLine {
	return {
		text: "",
		color: scheme.foreground.default,
		borderColor,
		bgColor,
	};
}

// ── Command echo line ───────────────────────────────────────────────

export function commandEchoLine(
	input: string,
	accent: string,
	scheme: ColorScheme,
	spans?: TokenSpan[],
): OutputLine {
	return {
		text: input,
		color: accent || scheme.foreground.default,
		prefix: "> ",
		prefixColor: accent || scheme.foreground.default,
		borderColor: accent,
		bgColor: scheme.backgrounds.darker,
		spans,
	};
}

// ── Output component ────────────────────────────────────────────────

export interface OutputProps {
	lines: OutputLine[];
	scrollOffset: number;
	viewportHeight: number;
	columns: number;
	animate?: boolean;
}

export const Output = React.memo(function Output({
	lines,
	scrollOffset,
	viewportHeight,
	columns,
	animate,
}: OutputProps) {
	const { scheme, layout } = useTheme();
	if (lines.length === 0) {
		return (
			<LandingLogo
				viewportHeight={viewportHeight}
				columns={columns}
				scheme={scheme}
				animate={animate}
			/>
		);
	}

	const pad = " ".repeat(layout.horizontalPad);
	const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
	const showScrollbar = lines.length > viewportHeight;
	// Content width: total - left pad - right pad - scrollbar (1 char + 1 space gap)
	const scrollbarWidth = showScrollbar ? 2 : 0;
	const contentWidth = columns - pad.length - pad.length - scrollbarWidth;

	const renderedLines: React.ReactNode[] = [];

	for (let i = 0; i < viewportHeight; i++) {
		const line = visible[i];
		const scrollChar = showScrollbar
			? scrollbarChar(i, viewportHeight, lines.length, scrollOffset, scheme)
			: null;

		if (!line) {
			// Empty row to fill viewport
			const emptyWidth = columns - scrollbarWidth;
			renderedLines.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{" ".repeat(emptyWidth)}
					</Text>
					{scrollChar ? (
						<Text backgroundColor={scheme.backgrounds.standard}>
							<Text color={scrollChar.color}> {scrollChar.char}</Text>
						</Text>
					) : null}
				</Box>,
			);
			continue;
		}

		const border = line.borderColor ? "\u258E " : "  "; // ▎ + space, or 2 spaces
		const prefix = line.prefix ?? "";
		const maxTextWidth = Math.max(0, contentWidth - border.length - prefix.length);
		const truncated = line.text.length > maxTextWidth;
		const displayText = truncated
			? line.text.slice(0, maxTextWidth - 1) + "\u2026" // …
			: line.text;
		const usedWidth = border.length + prefix.length + displayText.length;
		const padRight = Math.max(0, contentWidth - usedWidth);

		const lineBg = line.bgColor ?? scheme.backgrounds.standard;
		const stdBg = scheme.backgrounds.standard;

		// Render text content: use spans for highlighted lines, flat color otherwise.
		// When truncated, fall back to flat color (truncation mid-span is complex).
		const hasSpans = line.spans && line.spans.length > 0 && !truncated;
		const textContent = hasSpans
			? line.spans!.map((span, si) => (
				<Text key={si} color={span.color || TOKEN_COLORS[span.token]} bold={line.bold}>{span.text}</Text>
			))
			: <Text color={line.color} bold={line.bold}>{displayText}</Text>;

		renderedLines.push(
			<Box key={i}>
				<Text backgroundColor={stdBg}>{pad}</Text>
				<Text backgroundColor={lineBg}>
					{line.borderColor ? (
						<Text color={line.borderColor}>{border}</Text>
					) : (
						<Text>{border}</Text>
					)}
					{prefix ? <Text color={line.prefixColor ?? line.color}>{prefix}</Text> : null}
					{textContent}
					<Text>{" ".repeat(padRight)}</Text>
				</Text>
				<Text backgroundColor={stdBg}>{pad}</Text>
				{scrollChar ? (
					<Text backgroundColor={stdBg}>
						<Text color={scrollChar.color}> {scrollChar.char}</Text>
					</Text>
				) : null}
			</Box>,
		);
	}

	return (
		<Box flexDirection="column">
			{renderedLines}
		</Box>
	);
});
