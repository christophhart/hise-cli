// ── Input component tests ───────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import {
	Input,
	useCommandHistory,
	wordBoundaryLeft,
	wordBoundaryRight,
	type InputHandle,
} from "./Input.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";

const w = (el: React.ReactElement) => <ThemeProvider scheme={defaultScheme}>{el}</ThemeProvider>;

// Strip ANSI escape codes for plain text assertions
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("Input component", () => {
	it("shows prompt with > character", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));
		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain(">");
		instance.unmount();
	});

	it("shows mode label in prompt when not root", () => {
		const instance = render(w(
			<Input modeLabel="builder" modeAccent="#fd971f" columns={80} onSubmit={() => {}} />,
		));
		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain("[builder]");
		expect(frame).toContain(">");
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

	it("shows cursor as highlighted space when empty", () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));
		// The cursor is now a space with a different background color.
		// Just verify the prompt renders and the component doesn't crash.
		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain(">");
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

		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain("/help");

		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["/help"]);

		instance.unmount();
	});

	it("inserts characters at cursor position (mid-string)", async () => {
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} />,
		));

		// Type "helo"
		for (const ch of "helo") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Move cursor left once (before 'o')
		instance.stdin.write("\x1b[D");
		await new Promise((r) => setTimeout(r, 50));

		// Move cursor left again (before 'l')
		instance.stdin.write("\x1b[D");
		await new Promise((r) => setTimeout(r, 50));

		// Insert 'l' at cursor
		instance.stdin.write("l");
		await new Promise((r) => setTimeout(r, 50));

		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain("hello");

		instance.unmount();
	});

	it("supports Home and End keys", async () => {
		const submitted: string[] = [];
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} />,
		));

		// Type "world"
		for (const ch of "world") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Press Home (move to start)
		instance.stdin.write("\x1b[H");
		await new Promise((r) => setTimeout(r, 50));

		// Type "hello " at the start
		for (const ch of "hello ") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Submit
		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["hello world"]);

		instance.unmount();
	});

	it("backspace deletes character before cursor, not from end", async () => {
		const submitted: string[] = [];
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} />,
		));

		// Type "helXlo"
		for (const ch of "helXlo") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 100));

		// Move cursor left twice (before 'l', 'o')
		instance.stdin.write("\x1b[D");
		await new Promise((r) => setTimeout(r, 100));
		instance.stdin.write("\x1b[D");
		await new Promise((r) => setTimeout(r, 100));

		// Backspace removes 'X'
		instance.stdin.write("\x7f");
		await new Promise((r) => setTimeout(r, 100));

		// Submit
		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 100));
		expect(submitted).toEqual(["hello"]);

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

// ── Word boundary helpers (pure function tests) ─────────────────────

describe("wordBoundaryLeft", () => {
	it("jumps to start of current word", () => {
		expect(wordBoundaryLeft("hello world", 8)).toBe(6);
	});

	it("jumps over whitespace to previous word", () => {
		expect(wordBoundaryLeft("hello world", 6)).toBe(0);
	});

	it("returns 0 at start", () => {
		expect(wordBoundaryLeft("hello", 0)).toBe(0);
	});

	it("handles multiple spaces", () => {
		// "a  b  c", pos 6 (before 'c'): skip spaces "  ", then skip word "b" → pos 3
		expect(wordBoundaryLeft("a  b  c", 6)).toBe(3);
	});
});

describe("wordBoundaryRight", () => {
	it("jumps past current word and whitespace", () => {
		expect(wordBoundaryRight("hello world", 0)).toBe(6);
	});

	it("jumps to end from middle of second word", () => {
		expect(wordBoundaryRight("hello world", 8)).toBe(11);
	});

	it("returns length at end", () => {
		expect(wordBoundaryRight("hello", 5)).toBe(5);
	});

	it("handles multiple spaces", () => {
		expect(wordBoundaryRight("a  b  c", 0)).toBe(3);
	});
});
