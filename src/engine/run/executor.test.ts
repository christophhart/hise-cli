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
		};
		const report = formatRunReport(result);
		expect(report).toContain("\u2713 line 3");
		expect(report).toContain("\u2713 line 5");
		expect(report).toContain("PASSED: 2/2");
	});

	it("formats failing test report", () => {
		const result: RunResult = {
			ok: false,
			linesExecuted: 5,
			expects: [
				{ line: 3, command: "getValue()", expected: "0.5", actual: "0.5", passed: true, tolerance: 0.01 },
				{ line: 5, command: "getCount()", expected: "2", actual: "3", passed: false, tolerance: 0.01 },
			],
		};
		const report = formatRunReport(result);
		expect(report).toContain("\u2713 line 3");
		expect(report).toContain("\u2717 line 5");
		expect(report).toContain("got 3");
		expect(report).toContain("FAILED: 1/2");
	});

	it("formats report with abort error", () => {
		const result: RunResult = {
			ok: false,
			linesExecuted: 3,
			expects: [],
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
		};
		const report = formatRunReport(result);
		expect(report).toContain("OK: 5 commands executed");
	});
});
