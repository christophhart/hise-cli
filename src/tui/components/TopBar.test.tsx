// ── TopBar component tests ──────────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { TopBar } from "./TopBar.js";
import { defaultScheme, brand } from "../theme.js";

describe("TopBar", () => {
	it("shows HISE CLI branding", () => {
		const instance = render(
			React.createElement(TopBar, {
				modeLabel: "root",
				modeAccent: "",
				connectionStatus: "connected",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("HISE CLI");
		instance.unmount();
	});

	it("shows mode label when not root", () => {
		const instance = render(
			React.createElement(TopBar, {
				modeLabel: "builder",
				modeAccent: "#fd971f",
				connectionStatus: "connected",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("[builder]");
		instance.unmount();
	});

	it("hides mode label for root", () => {
		const instance = render(
			React.createElement(TopBar, {
				modeLabel: "root",
				modeAccent: "",
				connectionStatus: "connected",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).not.toContain("[root]");
		instance.unmount();
	});

	it("shows status dot", () => {
		const instance = render(
			React.createElement(TopBar, {
				modeLabel: "root",
				modeAccent: "",
				connectionStatus: "error",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("\u25CF"); // ●
		instance.unmount();
	});
});
