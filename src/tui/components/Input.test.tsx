// ── Input component tests ───────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Input, useCommandHistory } from "./Input.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";

const w = (el: React.ReactElement) => <ThemeProvider scheme={defaultScheme}>{el}</ThemeProvider>;

describe("Input component", () => {
	it("shows prompt with > character", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("> ");
		instance.unmount();
	});

	it("shows mode label in prompt when not root", () => {
		const instance = render(w(
			<Input modeLabel="builder" modeAccent="#fd971f" columns={80} onSubmit={() => {}} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("[builder]");
		expect(frame).toContain("> ");
		instance.unmount();
	});

	it("shows waiting message when disabled", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} disabled={true} onSubmit={() => {}} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("waiting for response...");
		instance.unmount();
	});

	it("shows cursor block when enabled", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("\u2588"); // █
		instance.unmount();
	});

	it("renders 3-row raised panel (top border + input + bottom border)", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));
		const frame = instance.lastFrame() ?? "";
		const lines = frame.split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(3);
		instance.unmount();
	});

	it("accepts text input and submits on enter", async () => {
		const submitted: string[] = [];
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} />,
		));

		for (const ch of "/help") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		let frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/help");

		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["/help"]);

		instance.unmount();
	});
});

// ── useCommandHistory tests (pure logic) ────────────────────────────

describe("useCommandHistory", () => {
	it("tracks history via the Input component", async () => {
		const submitted: string[] = [];
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} />,
		));

		for (const ch of "first") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));
		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));

		for (const ch of "second") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));
		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));

		expect(submitted).toEqual(["first", "second"]);
		instance.unmount();
	});
});
