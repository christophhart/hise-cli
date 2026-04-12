import { describe, it, expect } from "vitest";
import { buildModeMap, tokenizerForLine } from "./mode-map.js";

describe("buildModeMap", () => {
	it("maps a single mode block", () => {
		const map = buildModeMap(["/builder", "add SineSynth", "set Vol 0.5"]);
		expect(map).toHaveLength(3);
		expect(map[0]).toMatchObject({ modeId: "builder", isModeEntry: true });
		expect(map[1]).toMatchObject({ modeId: "builder", isModeEntry: false });
		expect(map[2]).toMatchObject({ modeId: "builder", isModeEntry: false });
	});

	it("tracks mode switches", () => {
		const map = buildModeMap(["/builder", "add Sine", "/script", "Engine.x()"]);
		expect(map[0]).toMatchObject({ modeId: "builder", isModeEntry: true });
		expect(map[1]).toMatchObject({ modeId: "builder", isModeEntry: false });
		expect(map[2]).toMatchObject({ modeId: "script", isModeEntry: true });
		expect(map[3]).toMatchObject({ modeId: "script", isModeEntry: false });
	});

	it("handles /exit", () => {
		const map = buildModeMap(["/builder", "add Sine", "/exit", "plain text"]);
		expect(map[0]).toMatchObject({ modeId: "builder", isModeEntry: true });
		expect(map[1]).toMatchObject({ modeId: "builder", isModeEntry: false });
		expect(map[2]).toMatchObject({ modeId: "builder", isModeExit: true });
		expect(map[3]).toMatchObject({ modeId: "root", isModeEntry: false });
	});

	it("handles one-shot commands (doesn't push stack)", () => {
		const map = buildModeMap(["/builder add Sine", "plain text"]);
		expect(map[0]).toMatchObject({ modeId: "builder", isModeEntry: true });
		expect(map[1]).toMatchObject({ modeId: "root", isModeEntry: false });
	});

	it("empty/comment lines inherit current mode", () => {
		const map = buildModeMap(["/builder", "", "# comment", "add Sine"]);
		expect(map[0]).toMatchObject({ modeId: "builder" });
		expect(map[1]).toMatchObject({ modeId: "builder" });
		expect(map[2]).toMatchObject({ modeId: "builder" });
		expect(map[3]).toMatchObject({ modeId: "builder" });
	});

	it("root mode for lines before any mode entry", () => {
		const map = buildModeMap(["# header", "/wait 500ms", "/builder"]);
		expect(map[0]).toMatchObject({ modeId: "root" });
		expect(map[1]).toMatchObject({ modeId: "root" });
		expect(map[2]).toMatchObject({ modeId: "builder", isModeEntry: true });
	});

	it("nested mode entry and exit", () => {
		const map = buildModeMap(["/builder", "/undo", "plan \"test\"", "/exit", "add Sine"]);
		expect(map[0]).toMatchObject({ modeId: "builder" });
		expect(map[1]).toMatchObject({ modeId: "undo" });
		expect(map[2]).toMatchObject({ modeId: "undo" });
		expect(map[3]).toMatchObject({ modeId: "undo", isModeExit: true });
		expect(map[4]).toMatchObject({ modeId: "builder" });
	});

	it("provides correct accent colors", () => {
		const map = buildModeMap(["/builder", "/script"]);
		expect(map[0]!.accent).toBe("#fd971f");
		expect(map[1]!.accent).toBe("#C65638");
	});

	it("/exit at root doesn't crash", () => {
		const map = buildModeMap(["/exit"]);
		expect(map[0]).toMatchObject({ modeId: "root", isModeExit: true });
	});

	it("tool commands inherit current mode", () => {
		const map = buildModeMap(["/builder", "/wait 500ms", "/expect x is 1"]);
		expect(map[0]).toMatchObject({ modeId: "builder" });
		expect(map[1]).toMatchObject({ modeId: "builder", isModeEntry: false });
		expect(map[2]).toMatchObject({ modeId: "builder", isModeEntry: false });
	});
});

describe("tokenizerForLine", () => {
	it("returns slash tokenizer for / lines", () => {
		const entry = { modeId: "builder" as const, isModeEntry: true, isOneShot: false, isModeExit: false, accent: "" };
		const tok = tokenizerForLine(entry, "/builder");
		expect(tok).toBeDefined();
		const spans = tok!("/builder");
		expect(spans.length).toBeGreaterThan(0);
	});

	it("returns builder tokenizer for builder mode lines", () => {
		const entry = { modeId: "builder" as const, isModeEntry: false, isOneShot: false, isModeExit: false, accent: "" };
		const tok = tokenizerForLine(entry, "add SineSynth");
		expect(tok).toBeDefined();
		const spans = tok!("add SineSynth");
		expect(spans.some(s => s.token === "keyword")).toBe(true);
	});

	it("returns script tokenizer for script mode lines", () => {
		const entry = { modeId: "script" as const, isModeEntry: false, isOneShot: false, isModeExit: false, accent: "" };
		const tok = tokenizerForLine(entry, "Engine.getSampleRate()");
		expect(tok).toBeDefined();
	});

	it("returns undefined for modes without tokenizers", () => {
		const entry = { modeId: "dsp" as const, isModeEntry: false, isOneShot: false, isModeExit: false, accent: "" };
		const tok = tokenizerForLine(entry, "some command");
		expect(tok).toBeUndefined();
	});

	it("returns undefined for root mode non-slash lines", () => {
		const entry = { modeId: "root" as const, isModeEntry: false, isOneShot: false, isModeExit: false, accent: "" };
		const tok = tokenizerForLine(entry, "plain text");
		expect(tok).toBeUndefined();
	});
});
