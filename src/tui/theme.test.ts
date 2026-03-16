// ── Theme tests ─────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
	brand,
	schemes,
	defaultScheme,
	statusColor,
	statusDot,
	wizardAccent,
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

describe("theme — wizard accent", () => {
	it("is copper", () => {
		expect(wizardAccent).toBe("#e8a060");
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
