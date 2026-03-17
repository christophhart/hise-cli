// ── Table formatter — density-aware column rendering ───────────────

// Shared table rendering logic for Output.tsx and MarkdownRenderer.tsx.
// Cell padding scales with density: compact=0, standard=1, spacious=2.
// Tables render with complete box borders, bold headers, and muted edges.

import type { OutputLine } from "./Output.js";
import { lightenHex, type ColorScheme } from "../theme.js";
import type { LayoutDensity } from "../layout.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";

/**
 * Build a table row with spans to support per-segment coloring.
 * Separators (│) use separatorColor, cell content uses cellColor.
 */
function buildRowWithSpans(
	cells: string[],
	colWidths: number[],
	cellPad: number,
	cellColor: string,
	separatorColor: string,
): { text: string; spans: TokenSpan[] } {
	const vLine = "\u2502";
	const padStr = " ".repeat(cellPad);

	let text = "";
	const spans: TokenSpan[] = [];

	// Left border
	text += vLine;
	spans.push({ text: vLine, token: "plain", color: separatorColor });

	cells.forEach((cell, i) => {
		// Cell content with padding (handle null/undefined)
		const cellContent = (cell ?? "").padEnd(colWidths[i]);
		const cellText = `${padStr}${cellContent}${padStr}`;
		text += cellText;
		spans.push({ text: cellText, token: "plain", color: cellColor });

		// Separator after cell
		text += vLine;
		spans.push({ text: vLine, token: "plain", color: separatorColor });
	});

	return { text, spans };
}

/**
 * Format a table with headers and rows into OutputLine[] with density-aware
 * cell padding. Column widths are auto-sized to fit content.
 * Renders with box borders: ┌─┬─┐ │ │ ├─┼─┤ │ │ └─┴─┘
 * Uses spans to ensure all borders (horizontal AND vertical) are muted.
 */
export function formatTable(
	headers: string[],
	rows: string[][],
	scheme: ColorScheme,
	density: LayoutDensity,
): OutputLine[] {
	// Calculate column widths (content + padding)
	const colWidths = headers.map((h, i) => {
		const maxRow = rows.reduce(
			(max, row) => Math.max(max, (row[i] ?? "").length),
			0,
		);
		return Math.max(h.length, maxRow);
	});

	// Cell padding by density: compact=0, standard=1, spacious=2
	const cellPad = density === "compact" ? 0 : density === "standard" ? 1 : 2;

	// Box drawing characters
	const hLine = "\u2500"; // ─

	// Top border: ┌───┬───┐
	const topBorder =
		"\u250C" + // ┌
		colWidths.map((w) => hLine.repeat(w + cellPad * 2)).join("\u252C") + // ┬
		"\u2510"; // ┐

	// Middle divider: ├───┼───┤
	const divider =
		"\u251C" + // ├
		colWidths.map((w) => hLine.repeat(w + cellPad * 2)).join("\u253C") + // ┼
		"\u2524"; // ┤

	// Bottom border: └───┴───┘
	const bottomBorder =
		"\u2514" + // └
		colWidths.map((w) => hLine.repeat(w + cellPad * 2)).join("\u2534") + // ┴
		"\u2518"; // ┘

	// Color assignments
	const separatorColor = scheme.foreground.muted;
	const headerColor = lightenHex(scheme.foreground.default, 0.2); // 20% lighter
	const cellColor = scheme.foreground.default;

	const lines: OutputLine[] = [
		{ text: topBorder, color: separatorColor },
	];

	// Header row with spans
	const headerRow = buildRowWithSpans(headers, colWidths, cellPad, headerColor, separatorColor);
	lines.push({
		text: headerRow.text,
		color: separatorColor,  // Base color (for separators)
		spans: headerRow.spans,
		bold: true,  // Bold applies to all spans
	});

	lines.push({ text: divider, color: separatorColor });

	// Data rows with spans
	for (const row of rows) {
		const dataRow = buildRowWithSpans(row, colWidths, cellPad, cellColor, separatorColor);
		lines.push({
			text: dataRow.text,
			color: separatorColor,  // Base color (for separators)
			spans: dataRow.spans,
		});
	}

	lines.push({ text: bottomBorder, color: separatorColor });

	return lines;
}
