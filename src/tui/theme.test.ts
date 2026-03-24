// ── Theme tests ─────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
	brand,
	schemes,
	defaultScheme,
	statusColor,
	statusDot,
	darkenHex,
	lightenHex,
	type ColorScheme,
} from "./theme.js";

describe("theme — brand colors", () => {
	it("has all 4 brand colors", () => {
		expect(brand.signal).toBe("#90FFB1");
		expect(brand.ok).toBe("#4E8E35");
		expect(brand.warning).toBe("#FFBA00");
		expect(brand.error).toBe("#BB3434");
	});
});

describe("theme — color schemes", () => {
	it("has 8 schemes", () => {
		expect(Object.keys(schemes)).toHaveLength(8);
	});

	it("default scheme is monokai", () => {
		expect(defaultScheme.name).toBe("Monokai");
	});

	it("each scheme has the correct structure", () => {
		for (const [key, scheme] of Object.entries(schemes)) {
			expect(scheme.name).toBeDefined();
			expect(scheme.backgrounds.darker).toBeDefined();
			expect(scheme.backgrounds.standard).toBeDefined();
			expect(scheme.backgrounds.sidebar).toBeDefined();
			expect(scheme.backgrounds.raised).toBeDefined();
			expect(scheme.backgrounds.overlay).toBeDefined();
			expect(scheme.foreground.default).toBeDefined();
			expect(scheme.foreground.bright).toBeDefined();
			expect(scheme.foreground.muted).toBeDefined();
		}
	});

	it("has 2 light and 6 dark schemes", () => {
		const light = Object.values(schemes).filter((s) => s.light);
		const dark = Object.values(schemes).filter((s) => !s.light);
		expect(light).toHaveLength(2);
		expect(dark).toHaveLength(6);
	});
});

describe("theme — status helpers", () => {
	it("statusColor returns correct colors", () => {
		expect(statusColor("connected")).toBe(brand.ok);
		expect(statusColor("warning")).toBe(brand.warning);
		expect(statusColor("error")).toBe(brand.error);
	});

	it("statusDot returns the dot character", () => {
		expect(statusDot("connected")).toBe("\u25CF");
		expect(statusDot("error")).toBe("\u25CF");
	});
});

// ── Darken utilities ────────────────────────────────────────────────

describe("darkenHex", () => {
	it("darkens white to half brightness", () => {
		expect(darkenHex("#ffffff", 0.5)).toBe("#808080");
	});

	it("black stays black at any factor", () => {
		expect(darkenHex("#000000", 0.5)).toBe("#000000");
		expect(darkenHex("#000000", 0.0)).toBe("#000000");
	});

	it("factor 1.0 preserves the color", () => {
		expect(darkenHex("#ff8040", 1.0)).toBe("#ff8040");
	});

	it("factor 0.0 produces black", () => {
		expect(darkenHex("#ff8040", 0.0)).toBe("#000000");
	});

	it("handles 3-char hex", () => {
		expect(darkenHex("#fff", 0.5)).toBe("#808080");
	});

	it("handles without # prefix", () => {
		expect(darkenHex("ffffff", 0.5)).toBe("#808080");
	});

	it("darkens a real theme color", () => {
		// Monokai standard: #272822 at 0.35
		const result = darkenHex("#272822", 0.35);
		// R: 0x27 * 0.35 = 39 * 0.35 ≈ 14 → 0x0e
		// G: 0x28 * 0.35 = 40 * 0.35 = 14 → 0x0e
		// B: 0x22 * 0.35 = 34 * 0.35 ≈ 12 → 0x0c
		expect(result).toBe("#0e0e0c");
	});
});

describe("lightenHex", () => {
	it("lightens black to 30% white", () => {
		// Each channel: 0 + (255 - 0) * 0.3 = 76.5 → 77 = 0x4d
		expect(lightenHex("#000000", 0.3)).toBe("#4d4d4d");
	});

	it("white stays white at any amount", () => {
		expect(lightenHex("#ffffff", 0.3)).toBe("#ffffff");
		expect(lightenHex("#ffffff", 1.0)).toBe("#ffffff");
	});

	it("amount 0.0 preserves the color", () => {
		expect(lightenHex("#ff8040", 0.0)).toBe("#ff8040");
	});

	it("amount 1.0 produces white", () => {
		expect(lightenHex("#ff8040", 1.0)).toBe("#ffffff");
	});

	it("lightens a dark raised bg", () => {
		// Monokai raised: #32342d
		// R: 0x32=50, 50 + (255-50)*0.3 = 50 + 61.5 = 112 → 0x70
		// G: 0x34=52, 52 + (255-52)*0.3 = 52 + 60.9 = 113 → 0x71
		// B: 0x2d=45, 45 + (255-45)*0.3 = 45 + 63.0 = 108 → 0x6c
		expect(lightenHex("#32342d", 0.3)).toBe("#70716c");
	});
});


