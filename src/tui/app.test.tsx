// ── TUI App integration tests ───────────────────────────────────────

import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./app.js";
import { MockHiseConnection } from "../engine/hise.js";
import { defaultScheme } from "./theme.js";

// Strip ANSI escape codes for plain text assertions
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const observerEnv = process.env.HISE_TUI_OBSERVER_PORT;

afterEach(() => {
	if (observerEnv === undefined) {
		delete process.env.HISE_TUI_OBSERVER_PORT;
	} else {
		process.env.HISE_TUI_OBSERVER_PORT = observerEnv;
	}
});

async function postObserverEvent(port: number, payload: unknown): Promise<void> {
	await fetch(`http://127.0.0.1:${port}/observer/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

describe("App", () => {
	it("renders the full shell with all regions", () => {
		const mock = new MockHiseConnection();
		const instance = render(
			React.createElement(App, {
				connection: mock,
				scheme: defaultScheme,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		const plain = stripAnsi(frame);

		// TopBar: branding
		expect(plain).toContain("HISE CLI");

		// Output: empty state
		expect(plain).toContain("/help");

		// Input: prompt
		expect(plain).toContain(">");

		// StatusBar: connection
		expect(plain).toContain("connected");

		instance.unmount();
	});

	it("shows root mode prompt initially", () => {
		const instance = render(
			React.createElement(App, {
				connection: null,
				scheme: defaultScheme,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		const plain = stripAnsi(frame);
		// Root mode: just ">" without mode label
		expect(plain).toContain(">");
		expect(plain).not.toContain("[root]");

		instance.unmount();
	});

	it("shows disconnected when connection is null", () => {
		const instance = render(
			React.createElement(App, {
				connection: null,
				scheme: defaultScheme,
			}),
		);

		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("disconnected");

		instance.unmount();
	});

	it("processes input and shows command echo", async () => {
		const mock = new MockHiseConnection();
		const instance = render(
			React.createElement(App, {
				connection: mock,
				scheme: defaultScheme,
			}),
		);

		// Type a command
		instance.stdin.write("/help");
		instance.stdin.write("\r");

		// Wait for async processing
		await new Promise((r) => setTimeout(r, 100));

		const frame = instance.lastFrame() ?? "";
		// Should show the command echo
		expect(frame).toContain("/help");

		instance.unmount();
	});

	it("shows scroll hint when content exceeds viewport", async () => {
		const mock = new MockHiseConnection();

		const instance = render(
			React.createElement(App, {
				connection: mock,
				scheme: defaultScheme,
			}),
		);

		// Submit many plain-text commands to fill the output with error lines.
		// Write characters individually with async gaps so React processes
		// each keystroke before the next arrives.
		for (let i = 0; i < 30; i++) {
			instance.stdin.write("x");
			await new Promise((r) => setTimeout(r, 5));
			instance.stdin.write("\r");
			await new Promise((r) => setTimeout(r, 30));
		}
		await new Promise((r) => setTimeout(r, 200));

		const frame = instance.lastFrame() ?? "";
		// StatusBar should show "live" when at bottom
		expect(frame).toContain("live");

		instance.unmount();
	});

	it("mirrors observer calls as prompt-style output with results", async () => {
		process.env.HISE_TUI_OBSERVER_PORT = "19115";
		const instance = render(
			React.createElement(App, {
				connection: new MockHiseConnection(),
				scheme: defaultScheme,
			}),
		);

		await new Promise((r) => setTimeout(r, 50));
		await postObserverEvent(19115, {
			id: "cmd-1",
			type: "command.start",
			source: "llm",
			command: "/script Engine.getSampleRate()",
			mode: "script",
			timestamp: Date.now(),
		});
		await postObserverEvent(19115, {
			id: "cmd-1",
			type: "command.end",
			source: "llm",
			ok: true,
			result: { type: "markdown", content: "48000", accent: "#C65638" },
			timestamp: Date.now(),
		});
		await new Promise((r) => setTimeout(r, 100));

		const plain = stripAnsi(instance.lastFrame() ?? "");
		expect(plain).toContain("[LLM]");
		expect(plain).toContain("/script Engine.getSampleRate()");
		expect(plain).toContain("48000");

		instance.unmount();
	});
});
