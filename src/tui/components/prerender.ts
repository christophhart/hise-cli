// ── Pre-renderer — convert blocks to ANSI line arrays ───────────────
//
// Pure functions that convert CommandResult and echo data into
// pre-rendered ANSI string lines. These lines are stored in the
// Output component's line buffer and sliced for viewport display,
// avoiding React reconciliation and Yoga layout on scroll.

import type { ColorScheme } from "../theme.js";
import { brand } from "../theme.js";
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

function hexToRgb(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

function fgHex(hex: string): string {
	if (!hex || hex.length < 7) return "";
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function bgHex(hex: string): string {
	if (!hex || hex.length < 7) return "";
	const [r, g, b] = hexToRgb(hex);
	return `\x1b[48;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";

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

	// Build the content line with optional syntax spans
	let contentLine: string;
	if (spans && spans.length > 0) {
		const spanText = spans.map(span => {
			const c = span.color || TOKEN_COLORS[span.token];
			return fgHex(c) + span.text;
		}).join("");
		contentLine = bg + fg + border + "> " + prefixColor + prefix + spanText + RESET;
	} else {
		contentLine = bg + fg + border + "> " + prefixColor + prefix + input + RESET;
	}

	// Pad each line to fill contentWidth with darker bg
	const borderLine = bg + fg + border + RESET;
	// Pad the border-only lines to full width
	const padBorder = bg + fg + border + RESET + bg + " ".repeat(Math.max(0, contentWidth - 2)) + RESET;
	// Pad the content line to full width
	const visibleContent = 2 + 2 + prefix.length + input.length; // border(2) + "> "(2) + text
	const padContent = " ".repeat(Math.max(0, contentWidth - visibleContent));
	const paddedContent = bg + fg + border + "> " +
		(prefix ? prefixColor + prefix : "") +
		(spans && spans.length > 0
			? spans.map(span => {
				const c = span.color || TOKEN_COLORS[span.token];
				return fgHex(c) + span.text;
			}).join("")
			: input
		) + padContent + RESET;

	const lines = [padBorder, paddedContent, padBorder];
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

		case "overlay":
			return null;

		default:
			return null;
	}

	const rendered = renderMarkdown(source, {
		scheme,
		accent: result.accent,
		width,
		context: "output",
	});
	const lines = rendered.split("\n");
	return { lines, height: lines.length };
}
