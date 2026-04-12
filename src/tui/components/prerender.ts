// ── Pre-renderer — convert blocks to ANSI line arrays ───────────────
//
// Pure functions that convert CommandResult and echo data into
// pre-rendered ANSI string lines. These lines are stored in the
// Output component's line buffer and sliced for viewport display,
// avoiding React reconciliation and Yoga layout on scroll.

import type { ColorScheme } from "../theme.js";
import { brand, hasTrueColor } from "../theme.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";
import type { CommandResult } from "../../engine/result.js";
import { renderMarkdown } from "./Markdown.js";

// ── Types ───────────────────────────────────────────────────────────

/** A block of pre-rendered ANSI lines ready for viewport slicing. */
export interface PrerenderedBlock {
	/** ANSI-styled lines (one string per terminal row) */
	lines: string[];
	/** Number of lines (same as lines.length, cached for convenience) */
	height: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Convert a table (headers + rows) to a markdown table string. */
function tableToMarkdown(headers: string[], rows: string[][]): string {
	const headerRow = "| " + headers.join(" | ") + " |";
	const divider = "| " + headers.map(h => "-".repeat(Math.max(h.length, 3))).join(" | ") + " |";
	const dataRows = rows.map(row => "| " + row.join(" | ") + " |");
	return [headerRow, divider, ...dataRows].join("\n");
}

/** Wrap code content in a fenced code block. */
function codeToMarkdown(content: string, language?: string): string {
	const lang = language || "hisescript";
	return "```" + lang + "\n" + content + "\n```";
}

// ── ANSI color helpers ──────────────────────────────────────────────
// Raw escape sequences - no chalk dependency (chalk optimizes away
// empty strings, which breaks our "open color, append text" pattern).
// Detects true-color support once; falls back to 256-color for
// terminals like macOS Terminal.app that don't support 24-bit RGB.

function hexToRgb(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

/** Squared distance between two RGB colors. */
function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/** RGB for a 256-color cube index (16-231). */
function cubeToRgb(idx: number): [number, number, number] {
	idx -= 16;
	const bi = idx % 6;
	idx = Math.floor(idx / 6);
	const gi = idx % 6;
	const ri = Math.floor(idx / 6);
	return [ri ? 55 + ri * 40 : 0, gi ? 55 + gi * 40 : 0, bi ? 55 + bi * 40 : 0];
}

/** Convert RGB to the nearest xterm 256-color index.
 *  Checks the best 6x6x6 cube match and the grayscale ramp, picks closest.
 *  For saturated colors, skips the grayscale ramp to preserve hue. */
function rgbTo256(r: number, g: number, b: number): number {
	// Best cube match — check the nearest index AND adjacent cells
	let bestCubeIdx = 16;
	let bestCubeDist = Infinity;
	const ri = Math.round(r / 255 * 5);
	const gi = Math.round(g / 255 * 5);
	const bi = Math.round(b / 255 * 5);
	for (let dr = -1; dr <= 1; dr++) {
		for (let dg = -1; dg <= 1; dg++) {
			for (let db = -1; db <= 1; db++) {
				const cr = ri + dr;
				const cg = gi + dg;
				const cb = bi + db;
				if (cr < 0 || cr > 5 || cg < 0 || cg > 5 || cb < 0 || cb > 5) continue;
				const idx = 16 + 36 * cr + 6 * cg + cb;
				const [mr, mg, mb] = cubeToRgb(idx);
				const dist = colorDistSq(r, g, b, mr, mg, mb);
				if (dist < bestCubeDist) {
					bestCubeDist = dist;
					bestCubeIdx = idx;
				}
			}
		}
	}

	// Skip grayscale for saturated colors (preserves hue)
	const maxC = Math.max(r, g, b);
	const minC = Math.min(r, g, b);
	if (maxC > 0 && (maxC - minC) / maxC > 0.25) return bestCubeIdx;

	// Grayscale ramp candidate — only for near-grey colors
	const avg = (r + g + b) / 3;
	const grayIdx = avg < 4 ? 16 : avg > 244 ? 231 : Math.round((avg - 8) / 10) + 232;
	const gv = grayIdx < 232 ? 0 : 8 + (grayIdx - 232) * 10;
	const grayDist = colorDistSq(r, g, b, gv, gv, gv);

	return grayDist <= bestCubeDist ? grayIdx : bestCubeIdx;
}

export function fgHex(hex: string): string {
	if (!hex || hex.length < 7) return "";
	const [r, g, b] = hexToRgb(hex);
	if (hasTrueColor) return `\x1b[38;2;${r};${g};${b}m`;
	return `\x1b[38;5;${rgbTo256(r, g, b)}m`;
}

export function bgHex(hex: string): string {
	if (!hex || hex.length < 7) return "";
	const [r, g, b] = hexToRgb(hex);
	if (hasTrueColor) return `\x1b[48;2;${r};${g};${b}m`;
	return `\x1b[48;5;${rgbTo256(r, g, b)}m`;
}

export const RESET = "\x1b[0m";

/** Truncate an ANSI-styled line to a maximum visible width.
 *  Escape sequences are preserved but don't count towards the width. */
export function truncateAnsi(line: string, maxVisibleWidth: number): string {
	let visible = 0;
	let i = 0;
	while (i < line.length && visible < maxVisibleWidth) {
		if (line[i] === "\x1b") {
			const end = line.indexOf("m", i);
			i = end !== -1 ? end + 1 : i + 1;
		} else {
			visible++;
			i++;
		}
	}
	// Preserve any trailing escape sequences (e.g. RESET) right after the cut point
	while (i < line.length && line[i] === "\x1b") {
		const end = line.indexOf("m", i);
		i = end !== -1 ? end + 1 : i + 1;
	}
	return line.slice(0, i) + RESET;
}

/** Wrap an ANSI-styled line into multiple lines at a given visible width.
 *  Preserves active color state across line breaks. */
export function wrapAnsi(line: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return [line];
	const lines: string[] = [];
	let visible = 0;
	let current = "";
	let activeEsc = ""; // accumulated ANSI escapes for carry-over

	let i = 0;
	while (i < line.length) {
		if (line[i] === "\x1b") {
			const end = line.indexOf("m", i);
			if (end === -1) { current += line[i]; i++; continue; }
			const seq = line.slice(i, end + 1);
			current += seq;
			if (seq === RESET) {
				activeEsc = "";
			} else {
				activeEsc += seq;
			}
			i = end + 1;
		} else {
			current += line[i];
			visible++;
			i++;
			if (visible >= maxWidth && i < line.length) {
				lines.push(current + RESET);
				current = activeEsc;
				visible = 0;
			}
		}
	}
	if (current) lines.push(current);
	if (lines.length === 0) lines.push("");
	return lines;
}

// ── Echo renderer ───────────────────────────────────────────────────

/** Render a command echo block to ANSI lines. */
export function renderEcho(
	input: string,
	accent: string,
	darkerBg: string,
	contentWidth: number,
	spans?: TokenSpan[],
	options?: { prefix?: string; prefixColor?: string },
): PrerenderedBlock {
	const border = "\u258E "; // ▎ + space
	const bg = bgHex(darkerBg);
	const fg = fgHex(accent);
	const prefix = options?.prefix ?? "";
	const prefixColor = options?.prefixColor ? fgHex(options.prefixColor) : "";

	// Top/bottom border lines
	const padBorder = bg + fg + border + RESET + bg + " ".repeat(Math.max(0, contentWidth - 2)) + RESET;

	// Check for multiline input
	const inputLines = input.split("\n");

	if (inputLines.length === 1) {
		// Single-line: original rendering with "> " prefix and optional spans
		const paddedContent = bg + fg + border + "> " +
			(prefix ? prefixColor + prefix : "") +
			(spans && spans.length > 0
				? spans.map(span => {
					const c = span.color || TOKEN_COLORS[span.token];
					return fgHex(c) + span.text;
				}).join("")
				: input
			) + " ".repeat(Math.max(0, contentWidth - 2 - 2 - prefix.length - input.length)) + RESET;

		return { lines: [padBorder, paddedContent, padBorder], height: 3 };
	}

	// Multiline: render each line with border + padding, no "> " prefix
	const contentLines = inputLines.map((line) => {
		const pad = " ".repeat(Math.max(0, contentWidth - 2 - line.length));
		return bg + fg + border + RESET + bg + fgHex(accent) + line + pad + RESET;
	});

	const lines = [padBorder, ...contentLines, padBorder];
	return { lines, height: lines.length };
}

// ── Plain-text wrap helper ──────────────────────────────────────────

/** Wrap plain text (no ANSI) at a fixed character width. */
function wrapPlain(text: string, width: number): string[] {
	if (width <= 0 || text.length <= width) return [text];
	const result: string[] = [];
	for (let i = 0; i < text.length; i += width) {
		result.push(text.slice(i, i + width));
	}
	return result;
}

// ── Error renderer ──────────────────────────────────────────────────

/** Render an error block to ANSI lines. */
export function renderError(
	message: string,
	detail: string | undefined,
	mutedColor: string,
	width?: number,
): PrerenderedBlock {
	const errorFg = fgHex(brand.error);
	const mutedFg = fgHex(mutedColor);
	const lines: string[] = [];
	const w = width ?? Infinity;
	// Split message by embedded newlines, then wrap each line
	const msgLines = message.split("\n");
	for (let i = 0; i < msgLines.length; i++) {
		const pre = i === 0 ? "\u2717 " : "  ";
		for (const part of wrapPlain(pre + msgLines[i]!, w)) {
			lines.push(errorFg + part + RESET);
		}
	}
	if (detail) {
		for (const raw of detail.split("\n")) {
			for (const part of wrapPlain(raw, w)) {
				lines.push(mutedFg + part + RESET);
			}
		}
	}
	return { lines, height: lines.length };
}

// ── Result renderer ─────────────────────────────────────────────────

/** Render a CommandResult to pre-rendered ANSI lines. */
export function renderResult(
	result: CommandResult,
	scheme: ColorScheme,
	width: number,
): PrerenderedBlock | null {
	let source: string;

	switch (result.type) {
		case "empty":
			return null;

		case "text":
			source = result.content;
			break;

		case "error":
			return renderError(result.message, result.detail, scheme.foreground.muted, width);

		case "code":
			source = codeToMarkdown(result.content, result.language);
			break;

		case "table":
			source = tableToMarkdown(result.headers, result.rows);
			break;

		case "markdown":
			source = result.content;
			break;

		default:
			return null;
	}

	const rendered = renderMarkdown(source, {
		scheme,
		accent: result.accent,
		width,
	});
	const lines = rendered.split("\n");
	return { lines, height: lines.length };
}
