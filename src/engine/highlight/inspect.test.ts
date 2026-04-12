import { describe, expect, it } from "vitest";
import { tokenizeInspect } from "./inspect.js";

describe("tokenizeInspect", () => {
	// ── Keywords ────────────────────────────────────────────────────

	it("classifies version as keyword", () => {
		const spans = tokenizeInspect("version");
		expect(spans).toEqual([{ text: "version", token: "keyword" }]);
	});

	it("classifies all inspect commands as keywords", () => {
		for (const cmd of ["version", "project", "help"]) {
			const spans = tokenizeInspect(cmd);
			expect(spans[0]!.token).toBe("keyword");
		}
	});

	// ── Non-keywords ───────────────────────────────────────────────

	it("classifies unknown words as identifiers", () => {
		const spans = tokenizeInspect("something");
		expect(spans).toEqual([{ text: "something", token: "identifier" }]);
	});

	// ── Slash delegation ───────────────────────────────────────────

	it("delegates slash commands to tokenizeSlash", () => {
		const spans = tokenizeInspect("/exit");
		expect(spans).toEqual([{ text: "/exit", token: "command", bold: true }]);
	});

	it("delegates mode commands with accent", () => {
		const spans = tokenizeInspect("/builder");
		expect(spans).toEqual([{ text: "/builder", token: "builder", bold: true }]);
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("handles empty string", () => {
		expect(tokenizeInspect("")).toEqual([]);
	});

	it("handles whitespace only", () => {
		const spans = tokenizeInspect("   ");
		expect(spans).toEqual([{ text: "   ", token: "plain" }]);
	});
});
