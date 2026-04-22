import { describe, it, expect } from "vitest";
import { extractResultValue, formatRunReport } from "./executor.js";
import type { CommandResult } from "../result.js";
import type { RunResult } from "./types.js";

describe("extractResultValue", () => {
	it("extracts text content", () => {
		const result: CommandResult = { type: "text", content: "0.5" };
		expect(extractResultValue(result)).toBe("0.5");
	});

	it("trims text content", () => {
		const result: CommandResult = { type: "text", content: "  hello  " };
		expect(extractResultValue(result)).toBe("hello");
	});

	it("extracts last non-blockquoted section from markdown", () => {
		const result: CommandResult = {
			type: "markdown",
			content: "> log line 1\n> log line 2\n\n42",
		};
		expect(extractResultValue(result)).toBe("42");
	});

	it("handles markdown with only blockquotes", () => {
		const result: CommandResult = {
			type: "markdown",
			content: "> log line 1\n> log line 2",
		};
		expect(extractResultValue(result)).toBe("> log line 1\n> log line 2");
	});

	it("handles error results", () => {
		const result: CommandResult = { type: "error", message: "something broke" };
		expect(extractResultValue(result)).toBe("ERROR: something broke");
	});

	it("handles empty results", () => {
		const result: CommandResult = { type: "empty" };
		expect(extractResultValue(result)).toBe("");
	});

	it("handles code results", () => {
		const result: CommandResult = { type: "code", content: "return 42;" };
		expect(extractResultValue(result)).toBe("return 42;");
	});
});

describe("formatRunReport", () => {
	it("formats passing test report", () => {
		const result: RunResult = {
			ok: true,
			linesExecuted: 5,
			expects: [
				{ line: 3, command: "getValue()", expected: "0.5", actual: "0.5", passed: true, tolerance: 0.01 },
				{ line: 5, command: "getCount()", expected: "2", actual: "2", passed: true, tolerance: 0.01 },
			],
			results: [],
		};
		const report = formatRunReport(result);
		expect(report).toContain("\u2713 line 3");
		expect(report).toContain("\u2713 line 5");
		expect(report).toContain("PASSED 2/2");
	});

	it("formats failing test report", () => {
		const result: RunResult = {
			ok: false,
			linesExecuted: 5,
			expects: [
				{ line: 3, command: "getValue()", expected: "0.5", actual: "0.5", passed: true, tolerance: 0.01 },
				{ line: 5, command: "getCount()", expected: "2", actual: "3", passed: false, tolerance: 0.01 },
			],
			results: [],
		};
		const report = formatRunReport(result);
		expect(report).toContain("\u2713 line 3");
		expect(report).toContain("\u2717 line 5");
		expect(report).toContain("got 3");
		expect(report).toContain("FAILED 1/2");
	});

	it("formats report with abort error", () => {
		const result: RunResult = {
			ok: false,
			linesExecuted: 3,
			expects: [],
			results: [],
			error: { line: 3, message: "Module not found" },
		};
		const report = formatRunReport(result);
		expect(report).toContain("ABORTED at line 3");
		expect(report).toContain("Module not found");
	});

	it("formats report with no expects", () => {
		const result: RunResult = {
			ok: true,
			linesExecuted: 5,
			expects: [],
			results: [],
		};
		const report = formatRunReport(result);
		expect(report).toContain("5 commands executed");
	});

	// ── Verbosity levels ──────────────────────────────────────────

	const sampleResult: RunResult = {
		ok: true,
		linesExecuted: 4,
		expects: [
			{ line: 3, command: "getValue()", expected: "0.5", actual: "0.5", passed: true, tolerance: 0.01 },
		],
		results: [
			{ line: 1, content: "add Synth", result: { type: "text", content: "Add Synth" } },
			{ line: 2, content: "set foo 1", result: { type: "text", content: "Set foo to 1" } },
		],
	};

	it("verbose shows per-command output, expects and footer", () => {
		const report = formatRunReport(sampleResult, "verbose");
		expect(report).toContain("Add Synth");
		expect(report).toContain("Set foo to 1");
		expect(report).toContain("line 3");
		expect(report).toContain("PASSED 1/1");
	});

	it("summary hides per-command output, keeps expects and footer", () => {
		const report = formatRunReport(sampleResult, "summary");
		expect(report).not.toContain("Add Synth");
		expect(report).not.toContain("Set foo to 1");
		expect(report).toContain("line 3");
		expect(report).toContain("PASSED 1/1");
	});

	it("quiet shows only footer", () => {
		const report = formatRunReport(sampleResult, "quiet");
		expect(report).not.toContain("Add Synth");
		expect(report).not.toContain("line 3");
		expect(report).toContain("4 commands executed");
		expect(report).toContain("PASSED 1/1");
	});

	it("quiet still surfaces ABORTED line on error", () => {
		const result: RunResult = {
			ok: false,
			linesExecuted: 2,
			expects: [],
			results: [{ line: 1, content: "foo", result: { type: "text", content: "did foo" } }],
			error: { line: 2, message: "something broke" },
		};
		const report = formatRunReport(result, "quiet");
		expect(report).toContain("ABORTED at line 2");
		expect(report).toContain("something broke");
		expect(report).not.toContain("did foo");
	});
});
