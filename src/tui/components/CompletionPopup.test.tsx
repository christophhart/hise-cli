// ── CompletionPopup tests ───────────────────────────────────────────

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { CompletionPopup } from "./CompletionPopup.js";
import { defaultScheme } from "../theme.js";
import type { CompletionItem } from "../../engine/modes/mode.js";

const scheme = defaultScheme;

const items: CompletionItem[] = [
	{ label: "AHDSR", detail: "EnvelopeModulator" },
	{ label: "TableEnvelope", detail: "EnvelopeModulator" },
	{ label: "MPEModulator", detail: "EnvelopeModulator" },
	{ label: "LFO", detail: "TimeVariantModulator" },
	{ label: "SimpleGain", detail: "MasterEffect" },
];

describe("CompletionPopup", () => {
	it("renders items", () => {
		const { lastFrame } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={() => {}}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		const frame = lastFrame()!;
		expect(frame).toContain("AHDSR");
		expect(frame).toContain("TableEnvelope");
		expect(frame).toContain("LFO");
	});

	it("shows detail annotations", () => {
		const { lastFrame } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={() => {}}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		const frame = lastFrame()!;
		expect(frame).toContain("EnvelopeModulator");
		expect(frame).toContain("TimeVariantModulator");
	});

	it("calls onDismiss on Escape", async () => {
		const onDismiss = vi.fn();
		const { stdin } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={() => {}}
				onAccept={() => {}}
				onDismiss={onDismiss}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		stdin.write("\x1b");
		await new Promise((r) => setTimeout(r, 150));
		expect(onDismiss).toHaveBeenCalled();
	});

	it("calls onSelect on arrow down", () => {
		const onSelect = vi.fn();
		const { stdin } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={onSelect}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		stdin.write("\x1b[B");
		expect(onSelect).toHaveBeenCalledWith(1);
	});

	it("calls onSelect on arrow up (wraps to end)", () => {
		const onSelect = vi.fn();
		const { stdin } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={onSelect}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		stdin.write("\x1b[A");
		expect(onSelect).toHaveBeenCalledWith(4);
	});

	it("calls onAccept on Enter", () => {
		const onAccept = vi.fn();
		const { stdin } = render(
			<CompletionPopup
				items={items}
				selectedIndex={2}
				onSelect={() => {}}
				onAccept={onAccept}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
			/>,
		);
		stdin.write("\r");
		expect(onAccept).toHaveBeenCalledWith(items[2]);
	});

	it("respects maxVisible", () => {
		const { lastFrame } = render(
			<CompletionPopup
				items={items}
				selectedIndex={0}
				onSelect={() => {}}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={0}
				scheme={scheme}
				maxVisible={3}
			/>,
		);
		const frame = lastFrame()!;
		expect(frame).toContain("AHDSR");
		expect(frame).toContain("TableEnvelope");
		expect(frame).toContain("MPEModulator");
		// LFO should NOT be visible (only 3 items shown)
		expect(frame).not.toContain("LFO");
	});

	it("adds left padding for offset", () => {
		const { lastFrame } = render(
			<CompletionPopup
				items={[{ label: "test" }]}
				selectedIndex={0}
				onSelect={() => {}}
				onAccept={() => {}}
				onDismiss={() => {}}
				leftOffset={5}
				scheme={scheme}
			/>,
		);
		const frame = lastFrame()!;
		const firstLine = frame.split("\n")[0];
		expect(firstLine.startsWith("     ")).toBe(true);
	});
});
