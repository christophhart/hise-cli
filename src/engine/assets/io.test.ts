import { describe, expect, it } from "vitest";
import { basename, dirname, joinPath } from "./io.js";

describe("joinPath", () => {
	it("joins forward-slash parts", () => {
		expect(joinPath("a", "b", "c")).toBe("a/b/c");
	});
	it("collapses extra slashes", () => {
		expect(joinPath("a/", "/b/", "/c")).toBe("a/b/c");
	});
	it("preserves leading slash on first segment", () => {
		expect(joinPath("/abs", "rel")).toBe("/abs/rel");
	});
	it("preserves Windows drive root", () => {
		expect(joinPath("C:/Users/foo", "Project", "x.js")).toBe("C:/Users/foo/Project/x.js");
	});
	it("ignores empty segments", () => {
		expect(joinPath("a", "", "b")).toBe("a/b");
	});
});

describe("dirname", () => {
	it("returns parent dir", () => {
		expect(dirname("a/b/c.js")).toBe("a/b");
	});
	it("returns empty for bare basename", () => {
		expect(dirname("file.js")).toBe("");
	});
	it("returns / for root child", () => {
		expect(dirname("/a")).toBe("/");
	});
});

describe("basename", () => {
	it("extracts final segment", () => {
		expect(basename("a/b/c.js")).toBe("c.js");
	});
	it("returns input when no slash", () => {
		expect(basename("file.js")).toBe("file.js");
	});
});
