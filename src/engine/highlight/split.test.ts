import { describe, expect, it } from "vitest";
import { sliceSpans, splitSpansAtCursor } from "./split.js";
import type { TokenSpan } from "./tokens.js";

// ── sliceSpans ──────────────────────────────────────────────────────

describe("sliceSpans", () => {
	const spans: TokenSpan[] = [
		{ text: "var", token: "keyword" },
		{ text: " ", token: "plain" },
		{ text: "x", token: "identifier" },
		{ text: " = ", token: "operator" },
		{ text: "42", token: "integer" },
	];

	it("returns all spans when window covers everything", () => {
		const result = sliceSpans(spans, 0, 100);
		expect(result.map((s) => s.text).join("")).toBe("var x = 42");
	});

	it("clips from the start", () => {
		// Skip first 4 chars ("var "), start at "x"
		const result = sliceSpans(spans, 4, 6);
		expect(result.map((s) => s.text).join("")).toBe("x = 42");
	});

	it("clips from the end", () => {
		// Take first 5 chars ("var x")
		const result = sliceSpans(spans, 0, 5);
		expect(result.map((s) => s.text).join("")).toBe("var x");
	});

	it("clips both start and end", () => {
		// Skip 2, take 5 → "r x ="
		const result = sliceSpans(spans, 2, 5);
		expect(result.map((s) => s.text).join("")).toBe("r x =");
	});

	it("splits a span at the window start boundary", () => {
		// Start mid-way through "var" → "ar"
		const result = sliceSpans(spans, 1, 3);
		expect(result[0]).toEqual({ text: "ar", token: "keyword" });
	});

	it("splits a span at the window end boundary", () => {
		// Window ends mid-way through " = "
		const result = sliceSpans(spans, 4, 3);
		expect(result.map((s) => s.text).join("")).toBe("x =");
	});

	it("preserves token types through clipping", () => {
		const result = sliceSpans(spans, 2, 5);
		expect(result[0]!.token).toBe("keyword"); // "r"
		expect(result[1]!.token).toBe("plain"); // " "
		expect(result[2]!.token).toBe("identifier"); // "x"
		expect(result[3]!.token).toBe("operator"); // " ="
	});

	it("returns empty for zero width", () => {
		expect(sliceSpans(spans, 0, 0)).toEqual([]);
	});

	it("returns empty for negative width", () => {
		expect(sliceSpans(spans, 0, -1)).toEqual([]);
	});

	it("returns empty for start beyond text", () => {
		expect(sliceSpans(spans, 100, 10)).toEqual([]);
	});

	it("handles empty span array", () => {
		expect(sliceSpans([], 0, 10)).toEqual([]);
	});

	it("handles single-char spans", () => {
		const single: TokenSpan[] = [
			{ text: "a", token: "identifier" },
			{ text: "b", token: "keyword" },
			{ text: "c", token: "string" },
		];
		const result = sliceSpans(single, 1, 1);
		expect(result).toEqual([{ text: "b", token: "keyword" }]);
	});
});

// ── splitSpansAtCursor ──────────────────────────────────────────────

describe("splitSpansAtCursor", () => {
	const spans: TokenSpan[] = [
		{ text: "var", token: "keyword" },
		{ text: " ", token: "plain" },
		{ text: "x", token: "identifier" },
	];

	it("splits at the start (cursor at position 0)", () => {
		const result = splitSpansAtCursor(spans, 0);
		expect(result.before).toEqual([]);
		expect(result.cursorChar).toBe("v");
		expect(result.cursorToken).toBe("keyword");
		expect(result.after.map((s) => s.text).join("")).toBe("ar x");
	});

	it("splits mid-span", () => {
		const result = splitSpansAtCursor(spans, 1);
		expect(result.before).toEqual([{ text: "v", token: "keyword" }]);
		expect(result.cursorChar).toBe("a");
		expect(result.cursorToken).toBe("keyword");
		expect(result.after[0]).toEqual({ text: "r", token: "keyword" });
	});

	it("splits at span boundary", () => {
		// Position 3 is the space between "var" and "x"
		const result = splitSpansAtCursor(spans, 3);
		expect(result.before).toEqual([{ text: "var", token: "keyword" }]);
		expect(result.cursorChar).toBe(" ");
		expect(result.cursorToken).toBe("plain");
		expect(result.after).toEqual([{ text: "x", token: "identifier" }]);
	});

	it("splits at the last character", () => {
		const result = splitSpansAtCursor(spans, 4);
		expect(result.cursorChar).toBe("x");
		expect(result.cursorToken).toBe("identifier");
		expect(result.after).toEqual([]);
	});

	it("returns space cursor when past end", () => {
		const result = splitSpansAtCursor(spans, 5);
		expect(result.before.map((s) => s.text).join("")).toBe("var x");
		expect(result.cursorChar).toBe(" ");
		expect(result.cursorToken).toBe("plain");
		expect(result.after).toEqual([]);
	});

	it("handles empty spans", () => {
		const result = splitSpansAtCursor([], 0);
		expect(result.before).toEqual([]);
		expect(result.cursorChar).toBe(" ");
		expect(result.cursorToken).toBe("plain");
		expect(result.after).toEqual([]);
	});

	it("handles single character span with cursor on it", () => {
		const single: TokenSpan[] = [{ text: "x", token: "identifier" }];
		const result = splitSpansAtCursor(single, 0);
		expect(result.before).toEqual([]);
		expect(result.cursorChar).toBe("x");
		expect(result.cursorToken).toBe("identifier");
		expect(result.after).toEqual([]);
	});

	it("preserves all span data through split", () => {
		const multi: TokenSpan[] = [
			{ text: "abc", token: "keyword" },
			{ text: "def", token: "string" },
			{ text: "ghi", token: "integer" },
		];
		// Cursor on "d" (position 3)
		const result = splitSpansAtCursor(multi, 3);
		expect(result.before).toEqual([{ text: "abc", token: "keyword" }]);
		expect(result.cursorChar).toBe("d");
		expect(result.cursorToken).toBe("string");
		expect(result.after).toEqual([
			{ text: "ef", token: "string" },
			{ text: "ghi", token: "integer" },
		]);
	});
});
