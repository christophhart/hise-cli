import { describe, expect, it } from "vitest";
import { tokenizeBuilder } from "./builder.js";

describe("tokenizeBuilder", () => {
	// ── Keywords ────────────────────────────────────────────────────

	it("classifies add as keyword", () => {
		const spans = tokenizeBuilder("add");
		expect(spans).toEqual([{ text: "add", token: "keyword" }]);
	});

	it("classifies show as keyword", () => {
		const spans = tokenizeBuilder("show");
		expect(spans).toEqual([{ text: "show", token: "keyword" }]);
	});

	it("classifies set as keyword", () => {
		const spans = tokenizeBuilder("set");
		expect(spans).toEqual([{ text: "set", token: "keyword" }]);
	});

	it("classifies navigation commands as keywords", () => {
		for (const cmd of ["cd", "ls", "dir", "pwd"]) {
			const spans = tokenizeBuilder(cmd);
			expect(spans[0]!.token).toBe("keyword");
		}
	});

	it("classifies to and as as keywords", () => {
		const spans = tokenizeBuilder("add SineGenerator as \"osc\" to Master");
		const keywords = spans.filter((s) => s.token === "keyword");
		expect(keywords.map((s) => s.text)).toEqual(["add", "as", "to"]);
	});

	it("classifies tree and types as keywords", () => {
		const spans = tokenizeBuilder("show tree");
		expect(spans[0]!.token).toBe("keyword");
		expect(spans[2]!.token).toBe("keyword");
		expect(spans[2]!.text).toBe("tree");
	});

	// ── Identifiers ────────────────────────────────────────────────

	it("classifies module type names as identifiers", () => {
		const spans = tokenizeBuilder("add SineGenerator");
		expect(spans[2]).toEqual({ text: "SineGenerator", token: "identifier" });
	});

	// ── Strings ────────────────────────────────────────────────────

	it("tokenizes quoted strings", () => {
		const spans = tokenizeBuilder('add SineGenerator as "my osc"');
		const strings = spans.filter((s) => s.token === "string");
		expect(strings).toEqual([{ text: '"my osc"', token: "string" }]);
	});

	// ── Numbers ────────────────────────────────────────────────────

	it("tokenizes integers", () => {
		const spans = tokenizeBuilder("set Gain Gain 42");
		const ints = spans.filter((s) => s.token === "integer");
		expect(ints).toEqual([{ text: "42", token: "integer" }]);
	});

	it("tokenizes floats", () => {
		const spans = tokenizeBuilder("set Gain Gain 0.5");
		const floats = spans.filter((s) => s.token === "float");
		expect(floats).toEqual([{ text: "0.5", token: "float" }]);
	});

	// ── Dotted paths ───────────────────────────────────────────────

	it("tokenizes dotted paths with punctuation", () => {
		const spans = tokenizeBuilder("cd Master.pitch");
		expect(spans[2]).toEqual({ text: "Master", token: "identifier" });
		expect(spans[3]).toEqual({ text: ".", token: "punctuation" });
		expect(spans[4]).toEqual({ text: "pitch", token: "identifier" });
	});

	// ── Full command ───────────────────────────────────────────────

	it("tokenizes a complete add command", () => {
		const spans = tokenizeBuilder('add SineGenerator as "osc" to Master.pitch');
		const tokens = spans.map((s) => `${s.text}=${s.token}`);
		expect(tokens).toEqual([
			"add=keyword",
			" =plain",
			"SineGenerator=identifier",
			" =plain",
			"as=keyword",
			" =plain",
			"\"osc\"=string",
			" =plain",
			"to=keyword",
			" =plain",
			"Master=identifier",
			".=punctuation",
			"pitch=identifier",
		]);
	});

	// ── Slash delegation ───────────────────────────────────────────

	it("delegates slash commands to tokenizeSlash", () => {
		const spans = tokenizeBuilder("/help");
		expect(spans).toEqual([{ text: "/help", token: "command" }]);
	});

	it("delegates mode commands to tokenizeSlash with mode accent", () => {
		const spans = tokenizeBuilder("/script Interface");
		expect(spans[0]).toEqual({ text: "/script", token: "script" });
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("handles empty string", () => {
		expect(tokenizeBuilder("")).toEqual([]);
	});

	it("handles whitespace only", () => {
		const spans = tokenizeBuilder("   ");
		expect(spans).toEqual([{ text: "   ", token: "plain" }]);
	});
});
