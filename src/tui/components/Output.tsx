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
import { brand, type ColorScheme } from "../theme.js";

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

// ── Result → OutputLine conversion ──────────────────────────────────

export function resultToLines(
	result: CommandResult,
	accent: string,
	scheme: ColorScheme,
): OutputLine[] {
	switch (result.type) {
		case "empty":
			return [];
		case "text":
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
				borderColor: accent,
			}));
		case "error":
			return [
				{
					text: result.message,
					color: brand.error,
					prefix: "\u2717 ",
					prefixColor: brand.error,
					borderColor: accent,
				},
				...(result.detail
					? result.detail.split("\n").map((line) => ({
						text: line,
						color: scheme.foreground.muted,
						borderColor: accent,
					}))
					: []),
			];
		case "code":
			// Pre-computed highlighting would go here; for now plain text
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
				borderColor: accent,
			}));
		case "table":
			return formatTable(result.headers, result.rows, scheme, accent);
		case "tree":
			return formatTree(result.root, scheme, accent);
		case "markdown":
			// Simplified markdown rendering — full marked renderer in Phase 2
			return result.content.split("\n").map((line) => ({
				text: line,
				color: scheme.foreground.bright,
				borderColor: accent,
			}));
	}
}

function formatTable(
	headers: string[],
	rows: string[][],
	scheme: ColorScheme,
	accent: string,
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
		{ text: headerLine, color: scheme.foreground.bright, borderColor: accent },
		{ text: divider, color: scheme.foreground.muted, borderColor: accent },
	];

	for (const row of rows) {
		const rowLine = row.map((cell, i) => ` ${(cell ?? "").padEnd(colWidths[i] ?? 0)} `).join("\u2502");
		lines.push({ text: rowLine, color: scheme.foreground.default, borderColor: accent });
	}

	return lines;
}

function formatTree(
	node: TreeNode,
	scheme: ColorScheme,
	accent: string,
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
			borderColor: accent,
		},
	];

	if (node.children) {
		const childPrefix = prefix + (isLast ? "    " : "\u2502   "); // │
		node.children.forEach((child, i) => {
			const childIsLast = i === node.children!.length - 1;
			lines.push(...formatTree(child, scheme, accent, childPrefix, childIsLast));
		});
	}

	return lines;
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

// ── Scrollbar calculation ───────────────────────────────────────────

function scrollbarChar(
	row: number,
	viewportHeight: number,
	totalLines: number,
	scrollOffset: number,
	scheme: ColorScheme,
): { char: string; color: string } | null {
	if (totalLines <= viewportHeight) return null;

	const thumbHeight = Math.max(1, Math.round((viewportHeight * viewportHeight) / totalLines));
	const maxOffset = totalLines - viewportHeight;
	const thumbPosition = Math.round((scrollOffset / maxOffset) * (viewportHeight - thumbHeight));

	if (row >= thumbPosition && row < thumbPosition + thumbHeight) {
		return { char: "\u2588", color: brand.signal }; // █
	}
	return { char: "\u2502", color: scheme.foreground.muted }; // │
}

// ── Output component ────────────────────────────────────────────────

export interface OutputProps {
	lines: OutputLine[];
	scrollOffset: number;
	viewportHeight: number;
	scheme: ColorScheme;
	columns: number;
}

export const Output = React.memo(function Output({
	lines,
	scrollOffset,
	viewportHeight,
	scheme,
	columns,
}: OutputProps) {
	if (lines.length === 0) {
		return (
			<Box
				height={viewportHeight}
				flexDirection="column"
				justifyContent="center"
				alignItems="center"
			>
				<Text color={scheme.foreground.muted}>
					Type a command or /help to get started
				</Text>
			</Box>
		);
	}

	const visible = lines.slice(scrollOffset, scrollOffset + viewportHeight);
	const showScrollbar = lines.length > viewportHeight;
	const contentWidth = columns - (showScrollbar ? 3 : 0) - 4; // 2 pad each side, scrollbar

	const renderedLines: React.ReactNode[] = [];

	for (let i = 0; i < viewportHeight; i++) {
		const line = visible[i];
		const scrollChar = showScrollbar
			? scrollbarChar(i, viewportHeight, lines.length, scrollOffset, scheme)
			: null;

		if (!line) {
			// Empty row to fill viewport
			renderedLines.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{" ".repeat(columns - (scrollChar ? 1 : 0))}
					</Text>
					{scrollChar ? <Text color={scrollChar.color}>{scrollChar.char}</Text> : null}
				</Box>,
			);
			continue;
		}

		const border = line.borderColor ? "\u258E " : "  "; // ▎ or spaces
		const prefix = line.prefix ?? "";
		const maxTextWidth = Math.max(0, contentWidth - border.length - prefix.length);
		let displayText = line.text;
		if (displayText.length > maxTextWidth) {
			displayText = displayText.slice(0, maxTextWidth - 1) + "\u2026"; // …
		}
		const padRight = Math.max(0, contentWidth - border.length - prefix.length - displayText.length);

		renderedLines.push(
			<Box key={i}>
				<Text backgroundColor={line.bgColor ?? scheme.backgrounds.standard}>
					{line.borderColor ? (
						<Text color={line.borderColor}>{border}</Text>
					) : (
						<Text>{border}</Text>
					)}
					{prefix ? <Text color={line.prefixColor ?? line.color}>{prefix}</Text> : null}
					<Text color={line.color}>{displayText}</Text>
					<Text>{" ".repeat(padRight)}</Text>
				</Text>
				{scrollChar ? <Text color={scrollChar.color}>{scrollChar.char}</Text> : null}
			</Box>,
		);
	}

	return (
		<Box flexDirection="column">
			{renderedLines}
		</Box>
	);
});
