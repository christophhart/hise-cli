import { describe, it, expect } from "vitest";
import { stripQuotes, findLastUnquotedComma, splitByComma, unescapeQuotes } from "./string-utils.js";

describe("stripQuotes", () => {
	it("removes surrounding double quotes", () => {
		expect(stripQuotes('"hello"')).toBe("hello");
	});

	it("unescapes internal escaped quotes", () => {
		expect(stripQuotes('"say \\"hi\\""')).toBe('say "hi"');
	});

	it("returns unquoted strings unchanged", () => {
		expect(stripQuotes("hello")).toBe("hello");
	});

	it("returns empty quoted string as empty", () => {
		expect(stripQuotes('""')).toBe("");
	});

	it("does not strip mismatched quotes", () => {
		expect(stripQuotes('"hello')).toBe('"hello');
		expect(stripQuotes('hello"')).toBe('hello"');
	});
});

describe("findLastUnquotedComma", () => {
	it("finds the last comma outside quotes", () => {
		expect(findLastUnquotedComma('a, b, c')).toBe(4);
	});

	it("ignores commas inside quotes", () => {
		expect(findLastUnquotedComma('"a,b", c')).toBe(5);
	});

	it("returns -1 when no unquoted comma exists", () => {
		expect(findLastUnquotedComma('"a,b,c"')).toBe(-1);
	});

	it("returns -1 for empty string", () => {
		expect(findLastUnquotedComma("")).toBe(-1);
	});

	it("handles trailing comma", () => {
		expect(findLastUnquotedComma("a,b,")).toBe(3);
	});
});

describe("splitByComma", () => {
	it("splits simple comma-separated values", () => {
		expect(splitByComma("a, b, c")).toEqual(["a", " b", " c"]);
	});

	it("respects quoted strings containing commas", () => {
		expect(splitByComma('"a,b", c')).toEqual(['"a,b"', " c"]);
	});

	it("returns single element for no-comma input", () => {
		expect(splitByComma("hello")).toEqual(["hello"]);
	});

	it("handles empty string", () => {
		expect(splitByComma("")).toEqual([""]);
	});

	it("handles multiple quoted segments", () => {
		expect(splitByComma('"x,y","z"')).toEqual(['"x,y"', '"z"']);
	});
});

describe("unescapeQuotes", () => {
	it("replaces escaped quotes with literal quotes", () => {
		expect(unescapeQuotes('say \\"hi\\"')).toBe('say "hi"');
	});

	it("returns string without escaped quotes unchanged", () => {
		expect(unescapeQuotes("hello")).toBe("hello");
	});

	it("handles empty string", () => {
		expect(unescapeQuotes("")).toBe("");
	});
});
