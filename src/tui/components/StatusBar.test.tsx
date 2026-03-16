// ── StatusBar component tests ───────────────────────────────────────

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";
import { defaultScheme } from "../theme.js";

describe("StatusBar", () => {
	it("shows connected status", () => {
		const instance = render(
			React.createElement(StatusBar, {
				connectionStatus: "connected",
				modeHint: "/help for commands",
				scrollInfo: "live",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("connected");
		expect(frame).toContain("\u25CF"); // ●
		instance.unmount();
	});

	it("shows disconnected status", () => {
		const instance = render(
			React.createElement(StatusBar, {
				connectionStatus: "error",
				modeHint: "",
				scrollInfo: "",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("disconnected");
		instance.unmount();
	});

	it("shows mode hints", () => {
		const instance = render(
			React.createElement(StatusBar, {
				connectionStatus: "connected",
				modeHint: "/exit to leave Builder",
				scrollInfo: "",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("/exit to leave Builder");
		instance.unmount();
	});

	it("shows scroll info", () => {
		const instance = render(
			React.createElement(StatusBar, {
				connectionStatus: "connected",
				modeHint: "",
				scrollInfo: "\u2191 5 lines",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("5 lines");
		instance.unmount();
	});

	it("shows warning status", () => {
		const instance = render(
			React.createElement(StatusBar, {
				connectionStatus: "warning",
				modeHint: "",
				scrollInfo: "",
				scheme: defaultScheme,
				columns: 80,
			}),
		);
		const frame = instance.lastFrame() ?? "";
		expect(frame).toContain("degraded");
		instance.unmount();
	});
});
