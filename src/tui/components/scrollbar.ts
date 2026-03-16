// ── Scrollbar — shared scrollbar calculation for scrollable panels ───

import type { ColorScheme } from "../theme.js";

export interface ScrollbarChar {
	char: string;
	color: string;
}

/**
 * Returns the scrollbar character and color for a given row in a scrollable
 * viewport. Returns `null` when the content fits without scrolling.
 *
 * Reusable across Output, CompletionPopup, sidebar, and any future
 * scrollable panel.
 */
export function scrollbarChar(
	row: number,
	viewportHeight: number,
	totalItems: number,
	scrollOffset: number,
	scheme: ColorScheme,
): ScrollbarChar | null {
	if (totalItems <= viewportHeight) return null;

	const thumbHeight = Math.max(1, Math.round((viewportHeight * viewportHeight) / totalItems));
	const maxOffset = totalItems - viewportHeight;
	const thumbPosition = Math.round((scrollOffset / maxOffset) * (viewportHeight - thumbHeight));

	if (row >= thumbPosition && row < thumbPosition + thumbHeight) {
		return { char: "\u2588", color: scheme.foreground.muted }; // █ thumb
	}
	return { char: "\u2502", color: scheme.foreground.muted }; // │ track
}
