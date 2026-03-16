// ── Span splitting utilities for highlighted rendering ───────────────

// Pure functions that transform TokenSpan[] for rendering in the Input
// component: clipping to a scroll window and splitting around a cursor.

import type { TokenSpan, TokenType } from "./tokens.js";

// ── Slice spans to a visible window ─────────────────────────────────

/**
 * Clip a span array to a character window [start, start + width).
 * Spans that cross window boundaries are split; spans entirely outside
 * are dropped. Returns a new array (never mutates the input).
 */
export function sliceSpans(
	spans: TokenSpan[],
	start: number,
	width: number,
): TokenSpan[] {
	if (width <= 0) return [];

	const end = start + width;
	const result: TokenSpan[] = [];
	let pos = 0;

	for (const span of spans) {
		const spanEnd = pos + span.text.length;

		// Entirely before window — skip
		if (spanEnd <= start) {
			pos = spanEnd;
			continue;
		}

		// Entirely after window — done
		if (pos >= end) break;

		// Clip to window
		const clipStart = Math.max(0, start - pos);
		const clipEnd = Math.min(span.text.length, end - pos);
		const clipped = span.text.slice(clipStart, clipEnd);

		if (clipped.length > 0) {
			result.push({ text: clipped, token: span.token });
		}

		pos = spanEnd;
	}

	return result;
}

// ── Split spans around a cursor position ────────────────────────────

export interface CursorSplit {
	/** Spans before the cursor */
	before: TokenSpan[];
	/** The character under the cursor (or " " if at end) */
	cursorChar: string;
	/** Token type of the character under the cursor */
	cursorToken: TokenType;
	/** Spans after the cursor */
	after: TokenSpan[];
}

/**
 * Split an array of spans at a cursor position (0-indexed character
 * offset within the span text). The cursor character is extracted and
 * returned separately so the renderer can apply a highlight background.
 *
 * If cursorPos is at or beyond the total text length, cursorChar is " "
 * and cursorToken is "plain" (the cursor is past the end of input).
 */
export function splitSpansAtCursor(
	spans: TokenSpan[],
	cursorPos: number,
): CursorSplit {
	const totalLen = spans.reduce((sum, s) => sum + s.text.length, 0);

	// Cursor past end of text
	if (cursorPos >= totalLen) {
		return {
			before: spans.length > 0 ? [...spans] : [],
			cursorChar: " ",
			cursorToken: "plain",
			after: [],
		};
	}

	const before: TokenSpan[] = [];
	const after: TokenSpan[] = [];
	let cursorChar = " ";
	let cursorToken: TokenType = "plain";
	let pos = 0;
	let found = false;

	for (const span of spans) {
		const spanEnd = pos + span.text.length;

		if (!found) {
			if (cursorPos < spanEnd) {
				// Cursor is inside this span
				const localPos = cursorPos - pos;
				cursorChar = span.text[localPos]!;
				cursorToken = span.token;
				found = true;

				// Part before cursor in this span
				if (localPos > 0) {
					before.push({ text: span.text.slice(0, localPos), token: span.token });
				}
				// Part after cursor in this span
				if (localPos + 1 < span.text.length) {
					after.push({ text: span.text.slice(localPos + 1), token: span.token });
				}
			} else {
				// Entire span is before cursor
				before.push(span);
			}
		} else {
			// Already past cursor — everything goes to after
			after.push(span);
		}

		pos = spanEnd;
	}

	return { before, cursorChar, cursorToken, after };
}
