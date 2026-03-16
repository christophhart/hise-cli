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

// ── Output line model ───────────────────────────────────────────────

export interface OutputLine {
	text: string;
	color: string;
	prefix?: string;
	prefixColor?: string;
	borderColor?: string;  // left border ▎ color (mode accent)
	bgColor?: string;
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
	}));
}

// ── Result → OutputLine conversion ──────────────────────────────────

export function resultToLines(
	result: CommandResult,
	scheme: ColorScheme,
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
		case "code":
			// Pre-computed highlighting would go here; for now plain text
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
			}));
		case "table":
			return formatTable(result.headers, result.rows, scheme);
		case "tree":
			return formatTree(result.root, scheme);
		case "markdown":
			// Simplified markdown rendering — full marked renderer in Phase 2
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
			}));
		case "overlay":
			// Overlay results are handled by App (shows Overlay component).
			// If we get here, fall through to empty for non-TUI contexts.
			return [];
	}
}

function formatTable(
	headers: string[],
	rows: string[][],
	scheme: ColorScheme,
): OutputLine[] {
	// Calculate column widths
	const colWidths = headers.map((h, i) => {
		const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] ?? "").length), 0);
		return Math.max(h.length, maxRow);
	});

	const separator = "\u2500"; // ─
	const divider = colWidths.map((w) => separator.repeat(w + 2)).join("\u253C"); // ┼
	const headerLine = headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join("\u2502"); // │

	const lines: OutputLine[] = [
		{ text: headerLine, color: scheme.foreground.bright },
		{ text: divider, color: scheme.foreground.muted },
	];

	for (const row of rows) {
		const rowLine = row.map((cell, i) => ` ${(cell ?? "").padEnd(colWidths[i] ?? 0)} `).join("\u2502");
		lines.push({ text: rowLine, color: scheme.foreground.default });
	}

	return lines;
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
): OutputLine {
	return {
		text: input,
		color: accent || scheme.foreground.default,
		prefix: "> ",
		prefixColor: accent || scheme.foreground.default,
		borderColor: accent,
		bgColor: scheme.backgrounds.darker,
	};
}

// ── Output component ────────────────────────────────────────────────

export interface OutputProps {
	lines: OutputLine[];
	scrollOffset: number;
	viewportHeight: number;
	columns: number;
}

export const Output = React.memo(function Output({
	lines,
	scrollOffset,
	viewportHeight,
	columns,
}: OutputProps) {
	const { scheme } = useTheme();
	if (lines.length === 0) {
		const emptyRows: React.ReactNode[] = [];
		const midRow = Math.floor(viewportHeight / 2);
		const hint = "Type a command or /help to get started";
		for (let i = 0; i < viewportHeight; i++) {
			if (i === midRow) {
				const pad = Math.max(0, Math.floor((columns - hint.length) / 2));
				const padRight = Math.max(0, columns - pad - hint.length);
				emptyRows.push(
					<Box key={i}>
						<Text backgroundColor={scheme.backgrounds.standard}>
							{" ".repeat(pad)}
							<Text color={scheme.foreground.muted}>{hint}</Text>
							{" ".repeat(padRight)}
						</Text>
					</Box>,
				);
			} else {
				emptyRows.push(
					<Box key={i}>
						<Text backgroundColor={scheme.backgrounds.standard}>
							{" ".repeat(columns)}
						</Text>
					</Box>,
				);
			}
		}
		return <Box flexDirection="column">{emptyRows}</Box>;
	}

	const PAD = "  "; // 2 chars horizontal padding
	const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
	const showScrollbar = lines.length > viewportHeight;
	// Content width: total - left pad - right pad - scrollbar (1 char + 1 space gap)
	const scrollbarWidth = showScrollbar ? 2 : 0;
	const contentWidth = columns - PAD.length - PAD.length - scrollbarWidth;

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
		let displayText = line.text;
		if (displayText.length > maxTextWidth) {
			displayText = displayText.slice(0, maxTextWidth - 1) + "\u2026"; // …
		}
		const usedWidth = border.length + prefix.length + displayText.length;
		const padRight = Math.max(0, contentWidth - usedWidth);

		const lineBg = line.bgColor ?? scheme.backgrounds.standard;
		const stdBg = scheme.backgrounds.standard;

		renderedLines.push(
			<Box key={i}>
				<Text backgroundColor={stdBg}>{PAD}</Text>
				<Text backgroundColor={lineBg}>
					{line.borderColor ? (
						<Text color={line.borderColor}>{border}</Text>
					) : (
						<Text>{border}</Text>
					)}
					{prefix ? <Text color={line.prefixColor ?? line.color}>{prefix}</Text> : null}
					<Text color={line.color}>{displayText}</Text>
					<Text>{" ".repeat(padRight)}</Text>
				</Text>
				<Text backgroundColor={stdBg}>{PAD}</Text>
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
