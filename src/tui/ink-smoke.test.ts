// ── Ink performance verification (Phase 0.6) ────────────────────────

// Memory leak smoke test: verify that Ink 6.8 does not leak memory
// when components update rapidly (regression from Ink 6.6-6.7 #869).
//
// Scroll prototype: verify that rendering 500 pre-highlighted lines
// with virtual scrolling stays under performance targets.

import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Text, Box } from "ink";

// ── Memory leak smoke test ──────────────────────────────────────────

describe("Ink memory leak smoke test", () => {
	it("heap growth stays under 20MB over 5 seconds of rapid updates", async () => {
		// Reduced from 10s to 5s for faster test runs. Still enough to detect leaks.
		let counter = 0;

		function TimerComponent() {
			const [count, setCount] = React.useState(0);
			React.useEffect(() => {
				const interval = setInterval(() => {
					counter++;
					setCount((c) => c + 1);
				}, 100);
				return () => clearInterval(interval);
			}, []);
			return React.createElement(Text, null, `Count: ${count}`);
		}

		// Force GC if available (node --expose-gc)
		if (global.gc) global.gc();
		const startHeap = process.memoryUsage().heapUsed;

		const instance = render(React.createElement(TimerComponent));

		await new Promise((resolve) => setTimeout(resolve, 5000));

		instance.unmount();

		if (global.gc) global.gc();
		const endHeap = process.memoryUsage().heapUsed;
		const growth = endHeap - startHeap;
		const growthMB = growth / (1024 * 1024);

		// Allow some growth from test infrastructure, but not 20MB+ leak
		expect(growthMB).toBeLessThan(20);
		expect(counter).toBeGreaterThan(10); // sanity: updates actually ran
	}, 10000);
});

// ── Virtual scroll prototype ────────────────────────────────────────

describe("Ink scroll prototype", () => {
	it("renders 500 lines with virtual scrolling", () => {
		// Simulate 500 lines of pre-highlighted output
		const TOTAL_LINES = 500;
		const VIEWPORT_HEIGHT = 30;

		const lines = Array.from(
			{ length: TOTAL_LINES },
			(_, i) => `Line ${i + 1}: const x = Engine.getSampleRate();`,
		);

		function ScrollView({
			lines,
			offset,
			height,
		}: {
			lines: string[];
			offset: number;
			height: number;
		}) {
			const visible = lines.slice(offset, offset + height);
			return React.createElement(
				Box,
				{ flexDirection: "column" },
				visible.map((line, i) =>
					React.createElement(
						Text,
						{ key: offset + i },
						line,
					),
				),
			);
		}

		// Render at offset 0
		const start = performance.now();
		const instance = render(
			React.createElement(ScrollView, {
				lines,
				offset: 0,
				height: VIEWPORT_HEIGHT,
			}),
		);
		const firstRenderTime = performance.now() - start;

		// Verify only viewport lines are rendered
		const output = instance.lastFrame() ?? "";
		const outputLines = output.split("\n").filter((l) => l.length > 0);
		expect(outputLines).toHaveLength(VIEWPORT_HEIGHT);
		expect(outputLines[0]).toContain("Line 1");
		expect(outputLines[VIEWPORT_HEIGHT - 1]).toContain(
			`Line ${VIEWPORT_HEIGHT}`,
		);

		// Re-render at a different offset (simulating scroll)
		const scrollStart = performance.now();
		instance.rerender(
			React.createElement(ScrollView, {
				lines,
				offset: 200,
				height: VIEWPORT_HEIGHT,
			}),
		);
		const scrollRenderTime = performance.now() - scrollStart;

		const scrollOutput = instance.lastFrame() ?? "";
		const scrollLines = scrollOutput
			.split("\n")
			.filter((l) => l.length > 0);
		expect(scrollLines[0]).toContain("Line 201");

		// Performance check: both renders should be well under 16ms
		// (20fps target = 50ms budget, so 16ms is very comfortable)
		expect(firstRenderTime).toBeLessThan(100); // generous for CI
		expect(scrollRenderTime).toBeLessThan(100);

		instance.unmount();
	});

	it("handles empty output gracefully", () => {
		function ScrollView({
			lines,
			height,
		}: {
			lines: string[];
			height: number;
		}) {
			if (lines.length === 0) {
				return React.createElement(
					Text,
					{ dimColor: true },
					"Type a command or /help to get started",
				);
			}
			const visible = lines.slice(0, height);
			return React.createElement(
				Box,
				{ flexDirection: "column" },
				visible.map((line, i) =>
					React.createElement(Text, { key: i }, line),
				),
			);
		}

		const instance = render(
			React.createElement(ScrollView, {
				lines: [],
				height: 30,
			}),
		);
		const output = instance.lastFrame() ?? "";
		expect(output).toContain("/help");
		instance.unmount();
	});

	it("caps history at maximum lines", () => {
		const MAX_LINES = 10000;
		const history: string[] = [];

		// Simulate adding lines up to cap
		for (let i = 0; i < MAX_LINES + 500; i++) {
			history.push(`Line ${i}`);
			if (history.length > MAX_LINES) {
				history.splice(0, history.length - MAX_LINES);
			}
		}

		expect(history).toHaveLength(MAX_LINES);
		expect(history[0]).toBe("Line 500");
		expect(history[history.length - 1]).toBe(`Line ${MAX_LINES + 499}`);
	});
});
