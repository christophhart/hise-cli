// ── Input component tests ───────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Input, useCommandHistory } from "./Input.js";
import { defaultScheme } from "../theme.js";

describe("Input component", () => {
	it("shows prompt with > character", () => {
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: () => {},
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("> ");
		instance.unmount();
	});

	it("shows mode label in prompt when not root", () => {
		const instance = render(
			React.createElement(Input, {
				modeLabel: "builder",
				modeAccent: "#fd971f",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: () => {},
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("[builder]");
		expect(frame).toContain("> ");
		instance.unmount();
	});

	it("shows waiting message when disabled", () => {
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				disabled: true,
				onSubmit: () => {},
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("waiting for response...");
		instance.unmount();
	});

	it("shows cursor block when enabled", () => {
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: () => {},
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("\u2588"); // █
		instance.unmount();
	});

	it("shows separator line", () => {
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: () => {},
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("\u2500"); // ─
		instance.unmount();
	});

	it("accepts text input and submits on enter", async () => {
		const submitted: string[] = [];
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: (v: string) => submitted.push(v),
			}),
		);

		// Type characters one at a time (useInput receives individual chars)
		for (const ch of "/help") {
			instance.stdin.write(ch);
		}
		await new Promise((r) => setTimeout(r, 50));

		let frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/help");

		// Submit with enter
		instance.stdin.write("\r");
		await new Promise((r) => setTimeout(r, 50));
		expect(submitted).toEqual(["/help"]);

		instance.unmount();
	});
});

// ── useCommandHistory tests (pure logic) ────────────────────────────

describe("useCommandHistory", () => {
	// Testing the hook requires a React component wrapper
	it("tracks history via the Input component", async () => {
		const submitted: string[] = [];
		const instance = render(
			React.createElement(Input, {
				modeLabel: "root",
				modeAccent: "",
				scheme: defaultScheme,
				columns: 80,
				onSubmit: (v: string) => submitted.push(v),
			}),
		);

		// Submit two commands — type one char at a time
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
