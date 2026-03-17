// ── Layout scale system — responsive spacing for different terminal sizes ──
//
// Three density tiers: compact (MacBook), standard (medium), spacious (5K).
// Auto-detected from terminal dimensions with manual override via /density.
//
// Compact exactly matches the original hardcoded values — zero visual change
// on small terminals. Standard and spacious add breathing room progressively.

// ── Types ───────────────────────────────────────────────────────────

export type LayoutDensity = "compact" | "standard" | "spacious";

export interface LayoutScale {
	/** Active density tier */
	density: LayoutDensity;

	/** Horizontal padding chars on each side of full-width panels (TopBar, Output, Input, StatusBar) */
	horizontalPad: number;

	/** Vertical padding rows below TopBar and above StatusBar (0 or 1) */
	barVerticalPad: number;

	/** Sidebar minimum width in columns */
	sidebarMinWidth: number;

	/** Sidebar maximum width in columns */
	sidebarMaxWidth: number;

	/** Sidebar fraction of terminal width (used in sidebar width calculation) */
	sidebarWidthFraction: number;

	/** Left padding chars inside the tree sidebar (before content) */
	sidebarLeftPad: number;

	/** Blank rows above the root node in the tree sidebar */
	sidebarTopPad: number;

	/** Whether to render blank rows before nodes with topMargin: true */
	sidebarTopMargin: boolean;

	/** Blank rows after the last node in the tree sidebar */
	sidebarBottomPad: number;

	/** Maximum visible items in the completion popup */
	completionMaxVisible: number;

	/** Maximum inner width of the completion popup */
	completionMaxWidth: number;

	/** Minimum output viewport height (safety floor) */
	minOutputRows: number;
}

// ── Breakpoint thresholds ───────────────────────────────────────────
// Both conditions (columns AND rows) must be met to enter a tier.
// If one qualifies for spacious but the other only for standard,
// the result is standard (minimum of the two).

const STANDARD_MIN_COLS = 100;
const STANDARD_MIN_ROWS = 30;
const SPACIOUS_MIN_COLS = 180;
const SPACIOUS_MIN_ROWS = 50;

// ── Presets ─────────────────────────────────────────────────────────

export const COMPACT: LayoutScale = {
	density: "compact",
	horizontalPad: 2,
	barVerticalPad: 0,
	sidebarMinWidth: 20,
	sidebarMaxWidth: 40,
	sidebarWidthFraction: 0.25,
	sidebarLeftPad: 0,
	sidebarTopPad: 0,
	sidebarTopMargin: false,
	sidebarBottomPad: 0,
	completionMaxVisible: 8,
	completionMaxWidth: 50,
	minOutputRows: 4,
};

export const STANDARD: LayoutScale = {
	density: "standard",
	horizontalPad: 3,
	barVerticalPad: 1,
	sidebarMinWidth: 25,
	sidebarMaxWidth: 50,
	sidebarWidthFraction: 0.25,
	sidebarLeftPad: 1,
	sidebarTopPad: 0,
	sidebarTopMargin: false,
	sidebarBottomPad: 0,
	completionMaxVisible: 10,
	completionMaxWidth: 60,
	minOutputRows: 4,
};

export const SPACIOUS: LayoutScale = {
	density: "spacious",
	horizontalPad: 4,
	barVerticalPad: 1,
	sidebarMinWidth: 30,
	sidebarMaxWidth: 60,
	sidebarWidthFraction: 0.25,
	sidebarLeftPad: 2,
	sidebarTopPad: 0,
	sidebarTopMargin: true,
	sidebarBottomPad: 1,
	completionMaxVisible: 14,
	completionMaxWidth: 70,
	minOutputRows: 4,
};

// ── Detection ───────────────────────────────────────────────────────

/**
 * Detect the appropriate density tier from terminal dimensions.
 * Both columns AND rows must meet the threshold for a tier.
 */
export function detectDensity(columns: number, rows: number): LayoutDensity {
	const colTier =
		columns >= SPACIOUS_MIN_COLS ? "spacious" :
		columns >= STANDARD_MIN_COLS ? "standard" :
		"compact";

	const rowTier =
		rows >= SPACIOUS_MIN_ROWS ? "spacious" :
		rows >= STANDARD_MIN_ROWS ? "standard" :
		"compact";

	// Take the minimum of the two tiers
	const tierRank: Record<LayoutDensity, number> = { compact: 0, standard: 1, spacious: 2 };
	const minRank = Math.min(tierRank[colTier], tierRank[rowTier]);
	const rankToTier: LayoutDensity[] = ["compact", "standard", "spacious"];
	return rankToTier[minRank]!;
}

/**
 * Compute the full layout scale for the given terminal dimensions.
 * If override is provided, it forces the density regardless of terminal size.
 */
export function computeLayout(
	columns: number,
	rows: number,
	override?: LayoutDensity,
): LayoutScale {
	const density = override ?? detectDensity(columns, rows);
	switch (density) {
		case "compact": return COMPACT;
		case "standard": return STANDARD;
		case "spacious": return SPACIOUS;
	}
}

// ── Derived layout helpers ──────────────────────────────────────────
// These compute values that app.tsx needs from the layout scale,
// centralizing the formulas that were previously scattered.

/** Total rows consumed by the TopBar (content + vertical padding) */
export function topBarHeight(layout: LayoutScale): number {
	return 1 + layout.barVerticalPad;
}

/** Total rows consumed by the StatusBar (vertical padding + content) */
export function bottomBarHeight(layout: LayoutScale): number {
	return layout.barVerticalPad + 1;
}

/** Gap rows: 1 above output + 1 below output (constant across densities) */
export const GAP_ROWS = 2;

/** Input section height: top border + input + bottom border (constant) */
export const INPUT_SECTION_ROWS = 3;

/** Calculate sidebar width for given terminal columns */
export function sidebarWidth(layout: LayoutScale, columns: number): number {
	return Math.max(
		layout.sidebarMinWidth,
		Math.min(layout.sidebarMaxWidth, Math.floor(columns * layout.sidebarWidthFraction)),
	);
}
