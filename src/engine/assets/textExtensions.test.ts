import { describe, expect, it } from "vitest";
import {
	getExtension,
	isTextExtension,
	LEGACY_TEXT_EXTENSIONS,
	TEXT_EXTENSIONS,
} from "./textExtensions.js";

describe("getExtension", () => {
	it("returns lowercased extension", () => {
		expect(getExtension("Main.JS")).toBe(".js");
		expect(getExtension("a.CPP")).toBe(".cpp");
	});
	it("returns empty for no dot", () => {
		expect(getExtension("README")).toBe("");
	});
	it("uses last dot only", () => {
		expect(getExtension("a.tar.gz")).toBe(".gz");
	});
});

describe("isTextExtension", () => {
	it("matches whitelist", () => {
		expect(isTextExtension("main.js")).toBe(true);
		expect(isTextExtension("style.css")).toBe(true);
		expect(isTextExtension("doc.md")).toBe(true);
	});
	it("rejects binary types", () => {
		expect(isTextExtension("logo.png")).toBe(false);
		expect(isTextExtension("sample.wav")).toBe(false);
		expect(isTextExtension("README")).toBe(false);
	});
});

describe("legacy compat sets", () => {
	it("legacy set is strict subset of current", () => {
		for (const ext of LEGACY_TEXT_EXTENSIONS) {
			expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
		}
	});
	it("widened extensions are present in current but not legacy", () => {
		for (const ext of [".css", ".glsl", ".md", ".json", ".txt"]) {
			expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
			expect(LEGACY_TEXT_EXTENSIONS.has(ext)).toBe(false);
		}
	});
});
