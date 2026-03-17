// ── Table formatter — density-aware column rendering ───────────────

// Shared table rendering logic for Output.tsx and MarkdownRenderer.tsx.
// Cell padding scales with density: compact=0, standard=1, spacious=2.
// Tables render with complete box borders, bold headers, and muted edges.

import type { OutputLine } from "./Output.js";
import type { ColorScheme } from "../theme.js";
import type { LayoutDensity } from "../layout.js";

/**
 * Format a table with headers and rows into OutputLine[] with density-aware
 * cell padding. Column widths are auto-sized to fit content.
 * Renders with box borders: ┌─┬─┐ │ │ ├─┼─┤ │ │ └─┴─┘
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
	const padStr = " ".repeat(cellPad);

	// Box drawing characters
	const hLine = "\u2500"; // ─
	const vLine = "\u2502"; // │

	// Top border: ┌───┬───┐
	const topBorder =
		"\u250C" + // ┌
		colWidths.map((w) => hLine.repeat(w + cellPad * 2)).join("\u252C") + // ┬
		"\u2510"; // ┐

	// Header line with side borders: │ Header1 │ Header2 │
	// Use bold for header text only, not separators
	const headerLine =
		vLine +
		headers
			.map((h, i) => `${padStr}${h.padEnd(colWidths[i])}${padStr}`)
			.join(vLine) +
		vLine;

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

	const lines: OutputLine[] = [
		{ text: topBorder, color: scheme.foreground.muted },
		{ text: headerLine, color: scheme.foreground.default, bold: true },
		{ text: divider, color: scheme.foreground.muted },
	];

	for (const row of rows) {
		const rowLine =
			vLine +
			row
				.map((cell, i) =>
					`${padStr}${(cell ?? "").padEnd(colWidths[i] ?? 0)}${padStr}`,
				)
				.join(vLine) +
			vLine;
		lines.push({ text: rowLine, color: scheme.foreground.default });
	}

	lines.push({ text: bottomBorder, color: scheme.foreground.muted });

	return lines;
}
