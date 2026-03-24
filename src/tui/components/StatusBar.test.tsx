// ── StatusBar component tests ───────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";

const w = (el: React.ReactElement) => <ThemeProvider scheme={defaultScheme}>{el}</ThemeProvider>;

describe("StatusBar", () => {
	it("shows connected status", () => {
		const instance = render(w(
			<StatusBar connectionStatus="connected" modeHint="/help for commands  [escape] for context menu" scrollInfo="live" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("connected");
		expect(frame).toContain("\u25CF"); // ●
		instance.unmount();
	});

	it("shows disconnected status", () => {
		const instance = render(w(
			<StatusBar connectionStatus="error" modeHint="" scrollInfo="" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("disconnected");
		instance.unmount();
	});

	it("shows mode hints", () => {
		const instance = render(w(
			<StatusBar connectionStatus="connected" modeHint="/exit to leave Builder" scrollInfo="" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/exit to leave Builder");
		instance.unmount();
	});

	it("shows scroll info", () => {
		const instance = render(w(
			<StatusBar connectionStatus="connected" modeHint="" scrollInfo={"\u2191 5 lines"} columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("5 lines");
		instance.unmount();
	});

	it("shows warning status", () => {
		const instance = render(w(
			<StatusBar connectionStatus="warning" modeHint="" scrollInfo="" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("degraded");
		instance.unmount();
	});
});
