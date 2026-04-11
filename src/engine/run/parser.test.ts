import { describe, it, expect } from "vitest";
import { parseScript, parseExpect, parseWait, compareValues } from "./parser.js";

// ── parseScript ─────────────────────────────────────────────────────

describe("parseScript", () => {
	it("parses simple lines", () => {
		const result = parseScript("/builder\nadd SineSynth\nset Gain.Volume 0.5");
		expect(result.lines).toHaveLength(3);
		expect(result.lines[0]).toMatchObject({
			lineNumber: 1,
			content: "/builder",
			kind: "slash",
		});
		expect(result.lines[1]).toMatchObject({
			lineNumber: 2,
			content: "add SineSynth",
			kind: "command",
		});
		expect(result.lines[2]).toMatchObject({
			lineNumber: 3,
			content: "set Gain.Volume 0.5",
			kind: "command",
		});
	});

	it("skips comments", () => {
		const result = parseScript("# this is a comment\n/builder\n# another comment");
		expect(result.lines).toHaveLength(1);
		expect(result.lines[0]!.content).toBe("/builder");
	});

	it("skips empty lines", () => {
		const result = parseScript("/builder\n\n\nadd SineSynth\n\n");
		expect(result.lines).toHaveLength(2);
	});

	it("strips leading whitespace (indentation is cosmetic)", () => {
		const result = parseScript("/builder\n  add SineSynth\n    set Gain.Volume 0.5");
		expect(result.lines[1]!.content).toBe("add SineSynth");
		expect(result.lines[2]!.content).toBe("set Gain.Volume 0.5");
	});

	it("handles Windows line endings", () => {
		const result = parseScript("/builder\r\nadd SineSynth\r\n");
		expect(result.lines).toHaveLength(2);
	});

	it("preserves original raw text", () => {
		const result = parseScript("  /builder  ");
		expect(result.lines[0]!.raw).toBe("  /builder  ");
		expect(result.lines[0]!.content).toBe("/builder");
	});

	it("preserves correct line numbers across gaps", () => {
		const result = parseScript("# comment\n\n/builder\n\n# comment\nadd SineSynth");
		expect(result.lines[0]!.lineNumber).toBe(3);
		expect(result.lines[1]!.lineNumber).toBe(6);
	});

	it("returns empty for empty input", () => {
		expect(parseScript("").lines).toHaveLength(0);
		expect(parseScript("# only comments\n# here").lines).toHaveLength(0);
	});

	it("handles indented comment lines", () => {
		const result = parseScript("  # indented comment\n/builder");
		expect(result.lines).toHaveLength(1);
	});
});

// ── parseExpect ─────────────────────────────────────────────────────

describe("parseExpect", () => {
	it("parses basic expect", () => {
		const result = parseExpect("getValue() is 0.5");
		expect(result).toMatchObject({
			command: "getValue()",
			expected: "0.5",
			tolerance: 0.01,
			abortOnFail: false,
		});
	});

	it("parses expect with custom tolerance", () => {
		const result = parseExpect("getValue() is 0.5 within 0.001");
		expect(result).toMatchObject({
			command: "getValue()",
			expected: "0.5",
			tolerance: 0.001,
			abortOnFail: false,
		});
	});

	it("parses expect with or abort", () => {
		const result = parseExpect("isDefined(Knob1) is 1 or abort");
		expect(result).toMatchObject({
			command: "isDefined(Knob1)",
			expected: "1",
			abortOnFail: true,
		});
	});

	it("parses expect with both tolerance and abort", () => {
		const result = parseExpect("getValue() is 0.5 within 0.001 or abort");
		expect(result).toMatchObject({
			command: "getValue()",
			expected: "0.5",
			tolerance: 0.001,
			abortOnFail: true,
		});
	});

	it("uses last 'is' as delimiter (handles 'is' in command)", () => {
		const result = parseExpect("isEnabled() is true");
		expect(result).toMatchObject({
			command: "isEnabled()",
			expected: "true",
		});
	});

	it("parses builder get command", () => {
		const result = parseExpect("get MySine.Saturation is 0.4");
		expect(result).toMatchObject({
			command: "get MySine.Saturation",
			expected: "0.4",
		});
	});

	it("returns error for missing 'is'", () => {
		const result = parseExpect("getValue() equals 0.5");
		expect(typeof result).toBe("string");
	});

	it("returns error for missing command", () => {
		const result = parseExpect("is 0.5");
		expect(typeof result).toBe("string");
	});

	it("returns error for missing value", () => {
		const result = parseExpect("getValue() is ");
		expect(typeof result).toBe("string");
	});

	it("returns error for invalid tolerance", () => {
		const result = parseExpect("getValue() is 0.5 within abc");
		expect(typeof result).toBe("string");
	});
});

// ── parseWait ───────────────────────────────────────────────────────

describe("parseWait", () => {
	it("parses milliseconds", () => {
		const result = parseWait("500ms");
		expect(result).toMatchObject({ ms: 500 });
	});

	it("parses seconds", () => {
		const result = parseWait("0.5s");
		expect(result).toMatchObject({ ms: 500 });
	});

	it("parses whole seconds", () => {
		const result = parseWait("2s");
		expect(result).toMatchObject({ ms: 2000 });
	});

	it("is case-insensitive for unit", () => {
		const result = parseWait("500MS");
		expect(result).toMatchObject({ ms: 500 });
	});

	it("handles whitespace", () => {
		const result = parseWait("  500ms  ");
		expect(result).toMatchObject({ ms: 500 });
	});

	it("returns error for no unit", () => {
		const result = parseWait("500");
		expect(typeof result).toBe("string");
	});

	it("returns error for invalid format", () => {
		const result = parseWait("abc");
		expect(typeof result).toBe("string");
	});

	it("returns error for empty input", () => {
		const result = parseWait("");
		expect(typeof result).toBe("string");
	});
});

// ── compareValues ───────────────────────────────────────────────────

describe("compareValues", () => {
	it("compares equal numbers within tolerance", () => {
		expect(compareValues("0.501", "0.5", 0.01)).toBe(true);
	});

	it("rejects numbers outside tolerance", () => {
		expect(compareValues("0.52", "0.5", 0.01)).toBe(false);
	});

	it("compares exact integers", () => {
		expect(compareValues("42", "42", 0.01)).toBe(true);
	});

	it("compares strings exactly", () => {
		expect(compareValues("hello", "hello", 0.01)).toBe(true);
		expect(compareValues("hello", "world", 0.01)).toBe(false);
	});

	it("treats non-numeric values as strings", () => {
		expect(compareValues("true", "true", 0.01)).toBe(true);
		expect(compareValues("true", "false", 0.01)).toBe(false);
	});

	it("zero tolerance works", () => {
		expect(compareValues("0.5", "0.5", 0)).toBe(true);
		expect(compareValues("0.50001", "0.5", 0)).toBe(false);
	});

	it("handles negative numbers", () => {
		expect(compareValues("-6", "-6", 0.01)).toBe(true);
		expect(compareValues("-6.005", "-6", 0.01)).toBe(true);
	});
});
