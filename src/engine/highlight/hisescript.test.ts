import { describe, expect, it } from "vitest";
import { tokenize } from "./hisescript.js";

describe("tokenize (HiseScript)", () => {
	// ── Keywords ────────────────────────────────────────────────────

	it("classifies var as keyword", () => {
		const spans = tokenize("var");
		expect(spans).toEqual([{ text: "var", token: "keyword" }]);
	});

	it("classifies all HiseScript keywords", () => {
		const keywords = [
			"var", "reg", "const", "local", "function", "inline",
			"if", "else", "for", "while", "do", "switch", "case", "default",
			"return", "break", "continue", "namespace", "true", "false",
			"new", "delete", "typeof", "instanceof", "this",
		];
		for (const kw of keywords) {
			const spans = tokenize(kw);
			expect(spans[0]!.token, `${kw} should be keyword`).toBe("keyword");
		}
	});

	// ── Scoped statements (API namespaces) ──────────────────────────

	it("classifies Engine as scopedStatement", () => {
		const spans = tokenize("Engine");
		expect(spans).toEqual([{ text: "Engine", token: "scopedStatement" }]);
	});

	it("classifies Synth as scopedStatement", () => {
		const spans = tokenize("Synth");
		expect(spans).toEqual([{ text: "Synth", token: "scopedStatement" }]);
	});

	it("classifies Console as scopedStatement", () => {
		const spans = tokenize("Console");
		expect(spans).toEqual([{ text: "Console", token: "scopedStatement" }]);
	});

	// ── Numbers ────────────────────────────────────────────────────

	it("tokenizes integers", () => {
		const spans = tokenize("42");
		expect(spans).toEqual([{ text: "42", token: "integer" }]);
	});

	it("tokenizes hex integers", () => {
		const spans = tokenize("0xFF");
		expect(spans).toEqual([{ text: "0xFF", token: "integer" }]);
	});

	it("tokenizes floats", () => {
		const spans = tokenize("3.14");
		expect(spans).toEqual([{ text: "3.14", token: "float" }]);
	});

	it("tokenizes scientific notation", () => {
		const spans = tokenize("1.5e10");
		expect(spans).toEqual([{ text: "1.5e10", token: "float" }]);
	});

	// ── Strings ────────────────────────────────────────────────────

	it("tokenizes double-quoted strings", () => {
		const spans = tokenize('"hello"');
		expect(spans).toEqual([{ text: '"hello"', token: "string" }]);
	});

	it("tokenizes single-quoted strings", () => {
		const spans = tokenize("'world'");
		expect(spans).toEqual([{ text: "'world'", token: "string" }]);
	});

	it("tokenizes strings with escapes", () => {
		const spans = tokenize('"say \\"hi\\""');
		expect(spans[0]!.token).toBe("string");
	});

	// ── Comments ───────────────────────────────────────────────────

	it("tokenizes line comments", () => {
		const spans = tokenize("// this is a comment");
		expect(spans).toEqual([{ text: "// this is a comment", token: "comment" }]);
	});

	it("tokenizes block comments", () => {
		const spans = tokenize("/* block */");
		expect(spans).toEqual([{ text: "/* block */", token: "comment" }]);
	});

	// ── Operators ──────────────────────────────────────────────────

	it("tokenizes operators", () => {
		const spans = tokenize("x === y");
		const ops = spans.filter((s) => s.token === "operator");
		expect(ops[0]!.text).toContain("===");
	});

	// ── Brackets ───────────────────────────────────────────────────

	it("tokenizes brackets", () => {
		const spans = tokenize("()[]{}");
		expect(spans.every((s) => s.token === "bracket")).toBe(true);
	});

	// ── Punctuation ────────────────────────────────────────────────

	it("tokenizes punctuation", () => {
		const spans = tokenize(",;");
		// Adjacent punctuation merges into one span
		expect(spans).toEqual([{ text: ",;", token: "punctuation" }]);
	});

	// ── Full expressions ───────────────────────────────────────────

	it("tokenizes a variable declaration", () => {
		const spans = tokenize("var x = 5;");
		const tokens = spans.map((s) => `${s.text}=${s.token}`);
		expect(tokens).toEqual([
			"var=keyword",
			" =plain",
			"x=identifier",
			" =plain",
			"==operator",
			" =plain",
			"5=integer",
			";=punctuation",
		]);
	});

	it("tokenizes an API call", () => {
		const spans = tokenize("Synth.addNoteOn(1, 60, 127, 0)");
		expect(spans[0]).toEqual({ text: "Synth", token: "scopedStatement" });
		expect(spans[1]).toEqual({ text: ".", token: "punctuation" });
		expect(spans[2]).toEqual({ text: "addNoteOn", token: "identifier" });
	});

	it("tokenizes a function declaration", () => {
		const spans = tokenize("function foo(x) { return x + 1; }");
		expect(spans[0]).toEqual({ text: "function", token: "keyword" });
		const returnSpan = spans.find((s) => s.text === "return");
		expect(returnSpan!.token).toBe("keyword");
	});

	// ── Merge behavior ─────────────────────────────────────────────

	it("merges adjacent spans of same type", () => {
		// "  " should be one plain span, not two
		const spans = tokenize("x  y");
		const plainSpans = spans.filter((s) => s.token === "plain");
		expect(plainSpans.length).toBe(1);
		expect(plainSpans[0]!.text).toBe("  ");
	});

	// ── Edge cases ─────────────────────────────────────────────────

	it("handles empty string", () => {
		expect(tokenize("")).toEqual([]);
	});

	it("handles whitespace only", () => {
		const spans = tokenize("   ");
		expect(spans).toEqual([{ text: "   ", token: "plain" }]);
	});

	it("handles unknown characters gracefully", () => {
		// Should not throw, treats as plain
		const spans = tokenize("@#");
		expect(spans.length).toBeGreaterThan(0);
	});
});
