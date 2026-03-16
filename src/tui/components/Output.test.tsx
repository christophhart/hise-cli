// ── Output component tests ──────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
	Output,
	resultToLines,
	commandEchoLine,
	MAX_HISTORY_LINES,
	type OutputLine,
} from "./Output.js";
import { defaultScheme } from "../theme.js";

const accent = "#fd971f"; // builder orange

// ── resultToLines tests ─────────────────────────────────────────────

describe("resultToLines", () => {
	it("converts text result to lines", () => {
		const lines = resultToLines(
			{ type: "text", content: "hello world" },
			accent,
			defaultScheme,
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].text).toBe("hello world");
		expect(lines[0].color).toBe(defaultScheme.foreground.bright);
	});

	it("converts multi-line text", () => {
		const lines = resultToLines(
			{ type: "text", content: "line 1\nline 2\nline 3" },
			accent,
			defaultScheme,
		);
		expect(lines).toHaveLength(3);
		expect(lines[0].text).toBe("line 1");
		expect(lines[2].text).toBe("line 3");
	});

	it("converts error result with prefix", () => {
		const lines = resultToLines(
			{ type: "error", message: "bad input" },
			accent,
			defaultScheme,
		);
		expect(lines).toHaveLength(1);
		expect(lines[0].text).toBe("bad input");
		expect(lines[0].prefix).toBe("\u2717 "); // ✗
	});

	it("converts error with detail", () => {
		const lines = resultToLines(
			{ type: "error", message: "bad", detail: "extra info" },
			accent,
			defaultScheme,
		);
		expect(lines).toHaveLength(2);
		expect(lines[1].text).toBe("extra info");
	});

	it("converts table result", () => {
		const lines = resultToLines(
			{
				type: "table",
				headers: ["Name", "Type"],
				rows: [["AHDSR", "Modulator"], ["LFO", "Modulator"]],
			},
			accent,
			defaultScheme,
		);
		// header + divider + 2 data rows
		expect(lines).toHaveLength(4);
		expect(lines[0].text).toContain("Name");
		expect(lines[0].text).toContain("Type");
	});

	it("converts tree result", () => {
		const lines = resultToLines(
			{
				type: "tree",
				root: {
					label: "Root",
					children: [
						{ label: "Child1" },
						{ label: "Child2", children: [{ label: "Grandchild" }] },
					],
				},
			},
			accent,
			defaultScheme,
		);
		expect(lines.length).toBeGreaterThanOrEqual(4);
		expect(lines[0].text).toContain("Root");
		expect(lines[1].text).toContain("Child1");
	});

	it("returns empty array for empty result", () => {
		const lines = resultToLines({ type: "empty" }, accent, defaultScheme);
		expect(lines).toHaveLength(0);
	});
});

// ── commandEchoLine tests ───────────────────────────────────────────

describe("commandEchoLine", () => {
	it("creates a command echo with prefix", () => {
		const line = commandEchoLine("/help", accent, defaultScheme);
		expect(line.text).toBe("/help");
		expect(line.prefix).toBe("> ");
		expect(line.borderColor).toBe(accent);
		expect(line.bgColor).toBe(defaultScheme.backgrounds.darker);
	});
});

// ── Output component rendering tests ────────────────────────────────

describe("Output component", () => {
	it("shows empty state when no lines", () => {
		const instance = render(
			React.createElement(Output, {
				lines: [],
				scrollOffset: 0,
				viewportHeight: 10,
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/help");
		instance.unmount();
	});

	it("renders visible lines", () => {
		const lines: OutputLine[] = [
			{ text: "first line", color: defaultScheme.foreground.bright },
			{ text: "second line", color: defaultScheme.foreground.bright },
		];
		const instance = render(
			React.createElement(Output, {
				lines,
				scrollOffset: 0,
				viewportHeight: 10,
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("first line");
		expect(frame).toContain("second line");
		instance.unmount();
	});

	it("virtual scrolling shows correct slice", () => {
		const lines: OutputLine[] = Array.from({ length: 50 }, (_, i) => ({
			text: `line-${i}`,
			color: defaultScheme.foreground.bright,
		}));

		const instance = render(
			React.createElement(Output, {
				lines,
				scrollOffset: 20,
				viewportHeight: 10,
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("line-20");
		expect(frame).toContain("line-29");
		expect(frame).not.toContain("line-19");
		expect(frame).not.toContain("line-30");
		instance.unmount();
	});

	it("shows scrollbar when content exceeds viewport", () => {
		const lines: OutputLine[] = Array.from({ length: 50 }, (_, i) => ({
			text: `line-${i}`,
			color: defaultScheme.foreground.bright,
		}));

		const instance = render(
			React.createElement(Output, {
				lines,
				scrollOffset: 0,
				viewportHeight: 10,
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		// Should contain scrollbar characters
		expect(frame).toMatch(/[\u2588\u2502]/); // █ or │
		instance.unmount();
	});
});

// ── History cap test ────────────────────────────────────────────────

describe("MAX_HISTORY_LINES", () => {
	it("is 10000", () => {
		expect(MAX_HISTORY_LINES).toBe(10000);
	});
});
