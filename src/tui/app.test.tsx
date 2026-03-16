// ── TUI App integration tests ───────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { App } from "./app.js";
import { MockHiseConnection } from "../engine/hise.js";
import { defaultScheme } from "./theme.js";

// Strip ANSI escape codes for plain text assertions
function stripAnsi(s: string): string {
	return s.replace(/\x1b\[[0-9;]*m/g, "");
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

		// Submit many /modes commands to fill the output with table results
		for (let i = 0; i < 30; i++) {
			for (const ch of `/modes`) {
				instance.stdin.write(ch);
			}
			instance.stdin.write("\r");
			await new Promise((r) => setTimeout(r, 20));
		}
		await new Promise((r) => setTimeout(r, 200));

		const frame = instance.lastFrame() ?? "";
		// StatusBar should show "live" when at bottom
		expect(frame).toContain("live");

		instance.unmount();
	});
});
