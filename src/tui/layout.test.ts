import { describe, it, expect } from "vitest";
import {
	detectDensity,
	computeLayout,
	COMPACT,
	STANDARD,
	SPACIOUS,
	topBarHeight,
	bottomBarHeight,
	sidebarWidth,
	GAP_ROWS,
	INPUT_SECTION_ROWS,
} from "./layout.js";

// ── detectDensity ───────────────────────────────────────────────────

describe("detectDensity", () => {
	it("returns compact for small terminals", () => {
		expect(detectDensity(80, 24)).toBe("compact");
	});

	it("returns compact when columns qualify but rows do not", () => {
		expect(detectDensity(120, 24)).toBe("compact");
	});

	it("returns compact when rows qualify but columns do not", () => {
		expect(detectDensity(80, 40)).toBe("compact");
	});

	it("returns standard when both columns and rows meet threshold", () => {
		expect(detectDensity(100, 30)).toBe("standard");
	});

	it("returns standard when columns are spacious but rows are standard", () => {
		expect(detectDensity(200, 35)).toBe("standard");
	});

	it("returns standard when rows are spacious but columns are standard", () => {
		expect(detectDensity(120, 60)).toBe("standard");
	});

	it("returns spacious when both meet spacious thresholds", () => {
		expect(detectDensity(180, 50)).toBe("spacious");
	});

	it("returns spacious for very large terminals", () => {
		expect(detectDensity(300, 80)).toBe("spacious");
	});

	// Boundary tests
	it("returns compact at 99x29", () => {
		expect(detectDensity(99, 29)).toBe("compact");
	});

	it("returns standard at 100x30", () => {
		expect(detectDensity(100, 30)).toBe("standard");
	});

	it("returns standard at 179x49", () => {
		expect(detectDensity(179, 49)).toBe("standard");
	});

	it("returns spacious at 180x50", () => {
		expect(detectDensity(180, 50)).toBe("spacious");
	});
});

// ── computeLayout ───────────────────────────────────────────────────

describe("computeLayout", () => {
	it("returns compact preset for small terminal", () => {
		const layout = computeLayout(80, 24);
		expect(layout).toBe(COMPACT);
	});

	it("returns standard preset for medium terminal", () => {
		const layout = computeLayout(120, 35);
		expect(layout).toBe(STANDARD);
	});

	it("returns spacious preset for large terminal", () => {
		const layout = computeLayout(200, 60);
		expect(layout).toBe(SPACIOUS);
	});

	it("respects override regardless of terminal size", () => {
		expect(computeLayout(80, 24, "spacious")).toBe(SPACIOUS);
		expect(computeLayout(300, 80, "compact")).toBe(COMPACT);
		expect(computeLayout(200, 60, "standard")).toBe(STANDARD);
	});
});

// ── Compact matches original hardcoded values ───────────────────────

describe("compact preset matches original values", () => {
	it("horizontalPad = 2 (was PAD = '  ')", () => {
		expect(COMPACT.horizontalPad).toBe(2);
	});

	it("barVerticalPad = 0", () => {
		expect(COMPACT.barVerticalPad).toBe(0);
	});

	it("sidebarMinWidth = 20, sidebarMaxWidth = 40", () => {
		expect(COMPACT.sidebarMinWidth).toBe(20);
		expect(COMPACT.sidebarMaxWidth).toBe(40);
	});

	it("completionMaxVisible = 8 (was DEFAULT_MAX_VISIBLE)", () => {
		expect(COMPACT.completionMaxVisible).toBe(8);
	});

	it("completionMaxWidth = 50", () => {
		expect(COMPACT.completionMaxWidth).toBe(50);
	});

	it("minOutputRows = 4 (was MIN_OUTPUT_ROWS)", () => {
		expect(COMPACT.minOutputRows).toBe(4);
	});

	it("sidebarTopMargin = false", () => {
		expect(COMPACT.sidebarTopMargin).toBe(false);
	});

	it("no sidebar padding", () => {
		expect(COMPACT.sidebarLeftPad).toBe(0);
		expect(COMPACT.sidebarTopPad).toBe(0);
		expect(COMPACT.sidebarBottomPad).toBe(0);
	});
});

// ── Standard and spacious tiers ─────────────────────────────────────

describe("standard preset", () => {
	it("has more horizontal padding", () => {
		expect(STANDARD.horizontalPad).toBe(3);
	});

	it("has bar vertical padding", () => {
		expect(STANDARD.barVerticalPad).toBe(1);
	});

	it("has sidebar left padding of 1", () => {
		expect(STANDARD.sidebarLeftPad).toBe(1);
	});

	it("has wider sidebar range", () => {
		expect(STANDARD.sidebarMinWidth).toBe(25);
		expect(STANDARD.sidebarMaxWidth).toBe(50);
	});

	it("does not enable sidebarTopMargin", () => {
		expect(STANDARD.sidebarTopMargin).toBe(false);
	});
});

describe("spacious preset", () => {
	it("has most horizontal padding", () => {
		expect(SPACIOUS.horizontalPad).toBe(4);
	});

	it("has sidebar left padding of 2", () => {
		expect(SPACIOUS.sidebarLeftPad).toBe(2);
	});

	it("enables sidebarTopMargin", () => {
		expect(SPACIOUS.sidebarTopMargin).toBe(true);
	});

	it("has sidebar bottom padding", () => {
		expect(SPACIOUS.sidebarBottomPad).toBe(1);
	});

	it("has largest completion popup", () => {
		expect(SPACIOUS.completionMaxVisible).toBe(14);
		expect(SPACIOUS.completionMaxWidth).toBe(70);
	});
});

// ── Derived helpers ─────────────────────────────────────────────────

describe("derived helpers", () => {
	it("topBarHeight is 1 for compact, 2 for standard/spacious", () => {
		expect(topBarHeight(COMPACT)).toBe(1);
		expect(topBarHeight(STANDARD)).toBe(2);
		expect(topBarHeight(SPACIOUS)).toBe(2);
	});

	it("bottomBarHeight is 1 for compact, 2 for standard/spacious", () => {
		expect(bottomBarHeight(COMPACT)).toBe(1);
		expect(bottomBarHeight(STANDARD)).toBe(2);
		expect(bottomBarHeight(SPACIOUS)).toBe(2);
	});

	it("GAP_ROWS is always 2", () => {
		expect(GAP_ROWS).toBe(2);
	});

	it("INPUT_SECTION_ROWS is always 3", () => {
		expect(INPUT_SECTION_ROWS).toBe(3);
	});

	it("sidebarWidth respects min/max/fraction", () => {
		// Compact: max(20, min(40, floor(80 * 0.25))) = max(20, min(40, 20)) = 20
		expect(sidebarWidth(COMPACT, 80)).toBe(20);
		// Compact: max(20, min(40, floor(200 * 0.25))) = max(20, min(40, 50)) = 40
		expect(sidebarWidth(COMPACT, 200)).toBe(40);
		// Spacious: max(30, min(60, floor(200 * 0.25))) = max(30, min(60, 50)) = 50
		expect(sidebarWidth(SPACIOUS, 200)).toBe(50);
		// Spacious: max(30, min(60, floor(300 * 0.25))) = max(30, min(60, 75)) = 60
		expect(sidebarWidth(SPACIOUS, 300)).toBe(60);
	});
});
