import { describe, expect, it } from "vitest";
import { compareVersions, parseSemver, pickLatest } from "./semver.js";

describe("parseSemver", () => {
	it("parses X.Y.Z", () => {
		expect(parseSemver("1.2.3")).toEqual({
			major: 1, minor: 2, patch: 3, preRelease: null, raw: "1.2.3",
		});
	});

	it("parses pre-release suffix", () => {
		expect(parseSemver("1.0.0-rc1")).toMatchObject({
			major: 1, minor: 0, patch: 0, preRelease: "rc1",
		});
	});

	it("rejects non-semver", () => {
		expect(parseSemver("v1.2")).toBeNull();
		expect(parseSemver("main")).toBeNull();
		expect(parseSemver("")).toBeNull();
	});
});

describe("compareVersions", () => {
	it("orders by major", () => {
		expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
	});

	it("orders by minor when major equal", () => {
		expect(compareVersions("1.2.0", "1.1.99")).toBeGreaterThan(0);
	});

	it("orders by patch", () => {
		expect(compareVersions("1.0.5", "1.0.10")).toBeLessThan(0);
	});

	it("equal versions compare 0", () => {
		expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
	});

	it("release outranks pre-release", () => {
		expect(compareVersions("1.0.0", "1.0.0-rc1")).toBeGreaterThan(0);
		expect(compareVersions("1.0.0-rc1", "1.0.0")).toBeLessThan(0);
	});

	it("pre-release numeric identifier ordered numerically", () => {
		// Single numeric identifier compares as integer.
		expect(compareVersions("1.0.0-2", "1.0.0-10")).toBeLessThan(0);
		// Dotted: ["rc","2"] vs ["rc","10"] — first equal, second numeric.
		expect(compareVersions("1.0.0-rc.2", "1.0.0-rc.10")).toBeLessThan(0);
	});

	it("pre-release alphanumeric identifier ordered lexically", () => {
		// "rc2" / "rc10" are single alphanumeric identifiers — lex compare.
		expect(compareVersions("1.0.0-rc2", "1.0.0-rc10")).toBeGreaterThan(0);
	});

	it("semver always outranks non-semver", () => {
		expect(compareVersions("1.0.0", "main")).toBeGreaterThan(0);
		expect(compareVersions("dev", "0.0.1")).toBeLessThan(0);
	});

	it("non-semver pair falls back to lexical", () => {
		expect(compareVersions("alpha", "beta")).toBeLessThan(0);
		expect(compareVersions("alpha", "alpha")).toBe(0);
	});
});

describe("pickLatest", () => {
	it("returns largest semver", () => {
		expect(pickLatest(["1.0.0", "1.2.0", "0.9.5"])).toBe("1.2.0");
	});

	it("prefers release over pre-release", () => {
		expect(pickLatest(["1.0.0", "1.0.0-rc1"])).toBe("1.0.0");
	});

	it("returns null on empty", () => {
		expect(pickLatest([])).toBeNull();
	});

	it("handles single", () => {
		expect(pickLatest(["0.1.0"])).toBe("0.1.0");
	});
});
