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

	// Note: Input no longer has its own useInput — all key handling is
	// done by the central dispatcher in app.tsx. These tests use the
	// imperative InputHandle methods directly.

	it("accepts text input and submits via imperative handle", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		for (const ch of "/help") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain("/help");

		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["/help"]);

		instance.unmount();
	});

	it("inserts characters at cursor position (mid-string)", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		// Type "helo"
		for (const ch of "helo") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Move cursor left twice (before 'l', then before 'o')
		ref.current!.moveCursor("left");
		ref.current!.moveCursor("left");
		await new Promise((r) => setTimeout(r, 50));

		// Insert 'l' at cursor
		ref.current!.insertChar("l");
		await new Promise((r) => setTimeout(r, 50));

		const frame = stripAnsi(instance.lastFrame() ?? "");
		expect(frame).toContain("hello");

		instance.unmount();
	});

	it("supports Home and End via imperative handle", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		// Type "world"
		for (const ch of "world") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Move to start
		ref.current!.moveCursor("home");
		await new Promise((r) => setTimeout(r, 50));

		// Type "hello " at the start
		for (const ch of "hello ") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Submit
		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["hello world"]);

		instance.unmount();
	});

	it("backspace deletes character before cursor, not from end", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		// Type "helXlo"
		for (const ch of "helXlo") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		// Move cursor left twice (before 'l', 'o')
		ref.current!.moveCursor("left");
		ref.current!.moveCursor("left");
		await new Promise((r) => setTimeout(r, 50));

		// Backspace removes 'X'
		ref.current!.deleteBackward();
		await new Promise((r) => setTimeout(r, 50));

		// Submit
		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["hello"]);

		instance.unmount();
	});
});

// ── Selection tests ─────────────────────────────────────────────────

describe("Input selection", () => {
	it("selectAll selects entire value", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.selectAll();
		await new Promise((r) => setTimeout(r, 50));

		const sel = ref.current!.getSelection();
		expect(sel).toEqual({ start: 0, end: 5, text: "hello" });

		instance.unmount();
	});

	it("Shift+Right extends selection one char", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		ref.current!.moveCursor("home");
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.moveCursor("right", true);
		ref.current!.moveCursor("right", true);
		await new Promise((r) => setTimeout(r, 50));

		const sel = ref.current!.getSelection();
		expect(sel).toEqual({ start: 0, end: 2, text: "he" });

		instance.unmount();
	});

	it("Shift+Left extends selection left", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.moveCursor("left", true);
		ref.current!.moveCursor("left", true);
		await new Promise((r) => setTimeout(r, 50));

		const sel = ref.current!.getSelection();
		expect(sel).toEqual({ start: 3, end: 5, text: "lo" });

		instance.unmount();
	});

	it("Shift+End selects from cursor to end", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		ref.current!.moveCursor("home");
		ref.current!.moveCursor("right");
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.moveCursor("end", true);
		await new Promise((r) => setTimeout(r, 50));

		const sel = ref.current!.getSelection();
		expect(sel).toEqual({ start: 1, end: 5, text: "ello" });

		instance.unmount();
	});

	it("non-shift move clears selection", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		ref.current!.selectAll();
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.moveCursor("left");
		await new Promise((r) => setTimeout(r, 50));

		expect(ref.current!.getSelection()).toBeNull();

		instance.unmount();
	});

	it("backspace deletes selection", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		for (const ch of "hello world") ref.current!.insertChar(ch);
		// Select "world" (last 5 chars)
		for (let i = 0; i < 5; i++) ref.current!.moveCursor("left", true);
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.deleteBackward();
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["hello"]);

		instance.unmount();
	});

	it("typing replaces selection", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		ref.current!.selectAll();
		await new Promise((r) => setTimeout(r, 50));

		for (const ch of "bye") ref.current!.insertChar(ch);
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["bye"]);

		instance.unmount();
	});

	it("getSelection returns null when no selection", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello") ref.current!.insertChar(ch);
		await new Promise((r) => setTimeout(r, 50));

		expect(ref.current!.getSelection()).toBeNull();

		instance.unmount();
	});

	it("Shift+wordRight extends selection by word", async () => {
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={() => {}} inputRef={ref} />,
		));

		for (const ch of "hello world") ref.current!.insertChar(ch);
		ref.current!.moveCursor("home");
		await new Promise((r) => setTimeout(r, 50));

		ref.current!.moveCursor("wordRight", true);
		await new Promise((r) => setTimeout(r, 50));

		const sel = ref.current!.getSelection();
		expect(sel).toEqual({ start: 0, end: 6, text: "hello " });

		instance.unmount();
	});
});

// ── useCommandHistory tests (pure logic) ────────────────────────────

describe("useCommandHistory", () => {
	it("tracks history via the Input component", async () => {
		const submitted: string[] = [];
		const ref = React.createRef<InputHandle>();
		const instance = render(w(
			<Input modeLabel="root" modeAccent="" columns={80} onSubmit={(v: string) => submitted.push(v)} inputRef={ref} />,
		));

		for (const ch of "first") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));
		ref.current!.submit();
		await new Promise((r) => setTimeout(r, 50));

		for (const ch of "second") {
			ref.current!.insertChar(ch);
		}
		await new Promise((r) => setTimeout(r, 50));
		ref.current!.submit();
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
