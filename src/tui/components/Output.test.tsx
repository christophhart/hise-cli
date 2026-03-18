// ── Output component tests ──────────────────────────────────────────

import React from "react";
import { Text } from "ink";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
	Output,
	ResultBlock,
	MAX_HISTORY_BLOCKS,
} from "./Output.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";
import { STANDARD } from "../layout.js";

const w = (el: React.ReactElement) => (
	<ThemeProvider scheme={defaultScheme} layout={STANDARD}>{el}</ThemeProvider>
);

// ── ResultBlock tests ───────────────────────────────────────────────

describe("ResultBlock", () => {
	it("renders text result", () => {
		const instance = render(w(
			<ResultBlock result={{ type: "text", content: "hello world" }} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("hello world");
		instance.unmount();
	});

	it("renders error result with cross prefix", () => {
		const instance = render(w(
			<ResultBlock result={{ type: "error", message: "bad input" }} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("bad input");
		expect(frame).toContain("\u2717"); // ✗
		instance.unmount();
	});

	it("renders error with detail", () => {
		const instance = render(w(
			<ResultBlock result={{ type: "error", message: "bad", detail: "extra info" }} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("bad");
		expect(frame).toContain("extra info");
		instance.unmount();
	});

	it("returns null for empty result", () => {
		const instance = render(w(
			<ResultBlock result={{ type: "empty" }} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame.trim()).toBe("");
		instance.unmount();
	});

	it("renders table result", () => {
		const instance = render(w(
			<ResultBlock result={{
				type: "table",
				headers: ["Name", "Type"],
				rows: [["AHDSR", "Modulator"]],
			}} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("Name");
		expect(frame).toContain("Type");
		expect(frame).toContain("AHDSR");
		instance.unmount();
	});

	it("renders code result as fenced block", () => {
		const instance = render(w(
			<ResultBlock result={{ type: "code", content: "var x = 5;" }} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("x");
		expect(frame).toContain("5");
		instance.unmount();
	});
});

// ── Output component rendering tests ────────────────────────────────

describe("Output component", () => {
	it("shows landing logo when no blocks", () => {
		const instance = render(w(
			<Output blocks={[]} scrollOffset={0} viewportHeight={10} columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/help");
		instance.unmount();
	});

	it("renders blocks", () => {
		const blocks = [
			<Text key="a">first block</Text>,
			<Text key="b">second block</Text>,
		];
		const instance = render(w(
			<Output blocks={blocks} scrollOffset={0} viewportHeight={10} columns={80} />,
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
