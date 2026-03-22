// ── Output component tests ──────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
	Output,
	MAX_HISTORY_BLOCKS,
	flattenBlocks,
	totalLineCount,
} from "./Output.js";
import type { PrerenderedBlock } from "./prerender.js";
import { renderResult, renderEcho, renderError } from "./prerender.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";
import { STANDARD } from "../layout.js";

const w = (el: React.ReactElement) => (
	<ThemeProvider scheme={defaultScheme} layout={STANDARD}>{el}</ThemeProvider>
);

// ── Pre-render tests ────────────────────────────────────────────────

describe("renderResult", () => {
	it("renders text result", () => {
		const block = renderResult({ type: "text", content: "hello world" }, defaultScheme, 80);
		expect(block).not.toBeNull();
		expect(block!.lines.join("\n")).toContain("hello world");
	});

	it("renders error result with cross prefix", () => {
		const block = renderError("bad input", undefined, defaultScheme.foreground.muted);
		expect(block.lines.join("\n")).toContain("bad input");
		expect(block.lines.join("\n")).toContain("\u2717"); // ✗
	});

	it("renders error with detail", () => {
		const block = renderError("bad", "extra info", defaultScheme.foreground.muted);
		expect(block.lines.join("\n")).toContain("bad");
		expect(block.lines.join("\n")).toContain("extra info");
	});

	it("returns null for empty result", () => {
		const block = renderResult({ type: "empty" }, defaultScheme, 80);
		expect(block).toBeNull();
	});

	it("renders table result", () => {
		const block = renderResult({
			type: "table",
			headers: ["Name", "Type"],
			rows: [["AHDSR", "Modulator"]],
		}, defaultScheme, 80);
		expect(block).not.toBeNull();
		const text = block!.lines.join("\n");
		expect(text).toContain("Name");
		expect(text).toContain("Type");
		expect(text).toContain("AHDSR");
	});

	it("renders code result as fenced block", () => {
		const block = renderResult({ type: "code", content: "var x = 5;" }, defaultScheme, 80);
		expect(block).not.toBeNull();
		const text = block!.lines.join("\n");
		expect(text).toContain("x");
		expect(text).toContain("5");
	});
});

describe("renderEcho", () => {
	it("renders echo with border and prompt", () => {
		const block = renderEcho("test command", "#88bbcc", defaultScheme.backgrounds.darker, 80);
		expect(block.lines.length).toBe(3); // top border, content, bottom border
		const text = block.lines.join("\n");
		expect(text).toContain("> ");
		expect(text).toContain("test command");
		expect(text).toContain("\u258E"); // ▎
	});

	it("renders a dimmable prefix before the command text", () => {
		const block = renderEcho(
			"/script Engine.getSampleRate()",
			"#88bbcc",
			defaultScheme.backgrounds.darker,
			80,
			undefined,
			{ prefix: "[LLM] ", prefixColor: defaultScheme.foreground.muted },
		);
		const text = block.lines.join("\n");
		expect(text).toContain("[LLM]");
		expect(text).toContain("/script Engine.getSampleRate()");
	});
});

// ── Line buffer helper tests ────────────────────────────────────────

describe("flattenBlocks", () => {
	it("returns empty for no blocks", () => {
		expect(flattenBlocks([])).toEqual([]);
	});

	it("flattens single block", () => {
		const block: PrerenderedBlock = { lines: ["a", "b"], height: 2 };
		expect(flattenBlocks([block])).toEqual(["a", "b"]);
	});

	it("adds gap lines between blocks", () => {
		const b1: PrerenderedBlock = { lines: ["a"], height: 1 };
		const b2: PrerenderedBlock = { lines: ["b"], height: 1 };
		const result = flattenBlocks([b1, b2]);
		expect(result).toEqual(["a", "", "b"]); // 1 gap line
	});
});

describe("totalLineCount", () => {
	it("returns 0 for empty", () => {
		expect(totalLineCount([])).toBe(0);
	});

	it("counts lines with gaps", () => {
		const b1: PrerenderedBlock = { lines: ["a", "b"], height: 2 };
		const b2: PrerenderedBlock = { lines: ["c"], height: 1 };
		// 2 + 1 gap + 1 = 4
		expect(totalLineCount([b1, b2])).toBe(4);
	});
});

// ── Output component rendering tests ────────────────────────────────

describe("Output component", () => {
	it("shows landing logo when no blocks", () => {
		const instance = render(w(
			<Output blocks={[]} allLines={[]} totalLines={0} scrollOffset={0} viewportHeight={10} columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/help");
		instance.unmount();
	});

	it("renders blocks as text", () => {
		const blocks: PrerenderedBlock[] = [
			{ lines: ["first block"], height: 1 },
			{ lines: ["second block"], height: 1 },
		];
		const allLines = flattenBlocks(blocks);
		const instance = render(w(
			<Output
				blocks={blocks}
				allLines={allLines}
				totalLines={totalLineCount(blocks)}
				scrollOffset={0}
				viewportHeight={10}
				columns={80}
			/>,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("first block");
		expect(frame).toContain("second block");
		instance.unmount();
	});
});

// ── History cap test ────────────────────────────────────────────────

describe("MAX_HISTORY_BLOCKS", () => {
	it("is 500", () => {
		expect(MAX_HISTORY_BLOCKS).toBe(500);
	});
});
