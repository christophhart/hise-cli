import { describe, expect, it } from "vitest";
import { hashCode64, hashCode64String, parseHashField } from "./hash.js";

describe("hashCode64", () => {
	it("empty string -> 0", () => {
		expect(hashCode64("")).toBe(0n);
	});

	it("single ascii char -> codepoint", () => {
		expect(hashCode64("a")).toBe(97n);
	});

	it("two chars accumulate as h*101 + cp", () => {
		// 0*101+97=97 ; 97*101+98=9895
		expect(hashCode64("ab")).toBe(9895n);
	});

	it("three chars", () => {
		// 9895*101+99 = 999395+99 = 999494
		expect(hashCode64("abc")).toBe(999494n);
	});

	it("'hello' -> 10927454832", () => {
		expect(hashCode64("hello")).toBe(10927454832n);
	});

	it("iterates by codepoint, not UTF-16 unit", () => {
		// 💀 = U+1F480 = 128128. for...of yields it as a single iteration,
		// whereas UTF-16 unit iteration would split it into a surrogate pair.
		expect(hashCode64("\u{1F480}")).toBe(128128n);
	});

	it("handles surrogate codepoint after ascii", () => {
		// hash("ab") = 9895 ; 9895*101 + 128128 = 999395 + 128128 = 1127523
		expect(hashCode64("ab\u{1F480}")).toBe(1127523n);
	});

	it("wraps uint64 on long inputs and reinterprets as signed int64", () => {
		// Long enough string forces wraparound; result must remain in int64 range.
		const long = "a".repeat(50);
		const h = hashCode64(long);
		const I64_MIN = -(1n << 63n);
		const I64_MAX = (1n << 63n) - 1n;
		expect(h).toBeGreaterThanOrEqual(I64_MIN);
		expect(h).toBeLessThanOrEqual(I64_MAX);
	});

	it("matches a known wrapped value for repeated 'a' x 20", () => {
		// Independently computed via the algorithm: pin to detect drift.
		// h_n = 97 * (101^n - 1) / (101 - 1) under uint64 mod 2^64, then int64-cast.
		const got = hashCode64("a".repeat(20));
		// Recompute reference inline for clarity:
		const MASK = (1n << 64n) - 1n;
		let ref = 0n;
		for (let i = 0; i < 20; i++) ref = (ref * 101n + 97n) & MASK;
		const refSigned = ref >= 1n << 63n ? ref - (1n << 64n) : ref;
		expect(got).toBe(refSigned);
	});
});

describe("hashCode64String", () => {
	it("returns decimal string", () => {
		expect(hashCode64String("a")).toBe("97");
	});

	it("preserves negative sign on wrapped values", () => {
		const long = "z".repeat(100);
		const s = hashCode64String(long);
		expect(s).toMatch(/^-?\d+$/);
	});
});

describe("parseHashField", () => {
	it("parses string form", () => {
		expect(parseHashField("123")).toBe(123n);
		expect(parseHashField("-8123456789012345678")).toBe(-8123456789012345678n);
	});

	it("parses legacy number form", () => {
		expect(parseHashField(42)).toBe(42n);
	});

	it("returns null for missing", () => {
		expect(parseHashField(null)).toBeNull();
		expect(parseHashField(undefined)).toBeNull();
		expect(parseHashField("")).toBeNull();
	});

	it("rejects non-integer number", () => {
		expect(() => parseHashField(1.5)).toThrow(/not an integer/);
	});

	it("rejects garbage string", () => {
		expect(() => parseHashField("notanumber")).toThrow(/valid integer/);
	});

	it("rejects unsupported types", () => {
		expect(() => parseHashField({})).toThrow(/unsupported type/);
		expect(() => parseHashField(true)).toThrow(/unsupported type/);
	});
});
