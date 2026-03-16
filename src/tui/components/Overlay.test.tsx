// ── Overlay tests ───────────────────────────────────────────────────

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { MouseProvider } from "@ink-tools/ink-mouse";
import { Overlay } from "./Overlay.js";
import { defaultScheme } from "../theme.js";

const scheme = defaultScheme;

function wrap(el: React.ReactElement): React.ReactElement {
	return React.createElement(MouseProvider, { autoEnable: false }, el);
}

describe("Overlay", () => {
	it("renders with title", () => {
		const { lastFrame } = render(wrap(
			<Overlay
				title="Help"
				accent="#e8a060"
				lines={["Line 1", "Line 2"]}
				onClose={() => {}}
				columns={80}
				scheme={scheme}
			/>,
		));
		const frame = lastFrame()!;
		expect(frame).toContain("Help");
		expect(frame).toContain("[Esc] Close");
	});

	it("renders body content", () => {
		const { lastFrame } = render(wrap(
			<Overlay
				title="Test"
				accent="#ffffff"
				lines={["Hello world", "Second line"]}
				onClose={() => {}}
				columns={80}
				scheme={scheme}
			/>,
		));
		const frame = lastFrame()!;
		expect(frame).toContain("Hello world");
		expect(frame).toContain("Second line");
	});

	it("renders footer when provided", () => {
		const { lastFrame } = render(wrap(
			<Overlay
				title="Test"
				accent="#ffffff"
				lines={["Content"]}
				footer="\u2191\u2193 scroll  Esc close"
				onClose={() => {}}
				columns={80}
				scheme={scheme}
			/>,
		));
		const frame = lastFrame()!;
		expect(frame).toContain("scroll");
	});

	it("calls onClose on Escape", async () => {
		const onClose = vi.fn();
		const { stdin } = render(wrap(
			<Overlay
				title="Test"
				accent="#ffffff"
				lines={["Content"]}
				onClose={onClose}
				columns={80}
				scheme={scheme}
			/>,
		));
		stdin.write("\x1b");
		await new Promise((r) => setTimeout(r, 150));
		expect(onClose).toHaveBeenCalled();
	});

	it("shows down arrow when content exceeds body height", () => {
		const longContent = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
		const { lastFrame } = render(wrap(
			<Overlay
				title="Scrollable"
				accent="#ffffff"
				lines={longContent}
				onClose={() => {}}
				columns={80}
				scheme={scheme}
			/>,
		));
		const frame = lastFrame()!;
		expect(frame).toContain("\u25bc");
	});

	it("truncates long title", () => {
		const longTitle = "A".repeat(100);
		const { lastFrame } = render(wrap(
			<Overlay
				title={longTitle}
				accent="#ffffff"
				lines={["Content"]}
				onClose={() => {}}
				columns={80}
				scheme={scheme}
			/>,
		));
		const frame = lastFrame()!;
		expect(frame).toContain("\u2026");
	});
});
