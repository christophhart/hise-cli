// ── TopBar component tests ──────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { TopBar } from "./TopBar.js";
import { defaultScheme } from "../theme.js";
import { ThemeProvider } from "../theme-context.js";

const w = (el: React.ReactElement) => <ThemeProvider scheme={defaultScheme}>{el}</ThemeProvider>;

describe("TopBar", () => {
	it("shows HISE CLI branding", () => {
		const instance = render(w(
			<TopBar modeLabel="root" modeAccent="" connectionStatus="connected" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("HISE CLI");
		instance.unmount();
	});

	it("shows mode label when not root", () => {
		const instance = render(w(
			<TopBar modeLabel="builder" modeAccent="#fd971f" connectionStatus="connected" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("[builder]");
		instance.unmount();
	});

	it("hides mode label for root", () => {
		const instance = render(w(
			<TopBar modeLabel="root" modeAccent="" connectionStatus="connected" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).not.toContain("[root]");
		instance.unmount();
	});

	it("shows status dot", () => {
		const instance = render(w(
			<TopBar modeLabel="root" modeAccent="" connectionStatus="error" columns={80} />,
		));
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("\u25CF"); // ●
		instance.unmount();
	});
});
