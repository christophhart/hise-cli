import { describe, expect, it } from "vitest";
import { tokenizeSlash } from "./slash.js";

describe("tokenizeSlash", () => {
	// ── Mode commands get mode accent tokens ────────────────────────

	it("classifies /builder as builder token", () => {
		const spans = tokenizeSlash("/builder");
		expect(spans).toEqual([{ text: "/builder", token: "builder", bold: true }]);
	});

	it("classifies /script as script token", () => {
		const spans = tokenizeSlash("/script");
		expect(spans).toEqual([{ text: "/script", token: "script", bold: true }]);
	});

	it("classifies /dsp as dsp token", () => {
		const spans = tokenizeSlash("/dsp");
		expect(spans).toEqual([{ text: "/dsp", token: "dsp", bold: true }]);
	});

	it("classifies /inspect as inspect token", () => {
		const spans = tokenizeSlash("/inspect");
		expect(spans).toEqual([{ text: "/inspect", token: "inspect", bold: true }]);
	});

	it("classifies all mode IDs correctly", () => {
		const modes = ["builder", "script", "dsp", "sampler", "inspect", "project", "export", "undo", "ui"];
		for (const mode of modes) {
			const spans = tokenizeSlash(`/${mode}`);
			expect(spans[0]!.token).toBe(mode);
		}
	});

	// ── Generic commands get command token ──────────────────────────

	it("classifies /help as command token", () => {
		const spans = tokenizeSlash("/help");
		expect(spans).toEqual([{ text: "/help", token: "command", bold: true }]);
	});

	it("classifies /clear as command token", () => {
		const spans = tokenizeSlash("/clear");
		expect(spans).toEqual([{ text: "/clear", token: "command", bold: true }]);
	});

	it("classifies /exit as command token", () => {
		const spans = tokenizeSlash("/exit");
		expect(spans).toEqual([{ text: "/exit", token: "command", bold: true }]);
	});

	it("classifies /modes as command token", () => {
		const spans = tokenizeSlash("/modes");
		expect(spans).toEqual([{ text: "/modes", token: "command", bold: true }]);
	});

	// ── Arguments are tokenized ─────────────────────────────────────

	it("tokenizes arguments after mode command", () => {
		const spans = tokenizeSlash("/script Interface");
		expect(spans).toEqual([
			{ text: "/script", token: "script", bold: true },
			{ text: " ", token: "plain" },
			{ text: "Interface", token: "identifier" },
		]);
	});

	it("tokenizes string arguments", () => {
		const spans = tokenizeSlash('/help "modes"');
		expect(spans).toEqual([
			{ text: "/help", token: "command", bold: true },
			{ text: " ", token: "plain" },
			{ text: '"modes"', token: "string" },
		]);
	});

	it("tokenizes numeric arguments", () => {
		const spans = tokenizeSlash("/script 42");
		expect(spans).toEqual([
			{ text: "/script", token: "script", bold: true },
			{ text: " ", token: "plain" },
			{ text: "42", token: "integer" },
		]);
	});

	it("tokenizes float arguments", () => {
		const spans = tokenizeSlash("/script 3.14");
		expect(spans).toEqual([
			{ text: "/script", token: "script", bold: true },
			{ text: " ", token: "plain" },
			{ text: "3.14", token: "float" },
		]);
	});

	it("tokenizes dotted path arguments", () => {
		const spans = tokenizeSlash("/builder SineGenerator.pitch");
		expect(spans).toEqual([
			{ text: "/builder", token: "builder", bold: true },
			{ text: " ", token: "plain" },
			{ text: "SineGenerator.pitch", token: "identifier" },
		]);
	});

	it("highlights callback names as keywords after /callback", () => {
		const spans = tokenizeSlash("/callback onNoteOn");
		expect(spans).toEqual([
			{ text: "/callback", token: "command", bold: true },
			{ text: " ", token: "plain" },
			{ text: "onNoteOn", token: "keyword" },
		]);
	});

	it("highlights dotted callback targets with keyword callback suffix", () => {
		const spans = tokenizeSlash("/callback MidiProcessor.onNoteOff");
		expect(spans).toEqual([
			{ text: "/callback", token: "command", bold: true },
			{ text: " ", token: "plain" },
			{ text: "MidiProcessor", token: "identifier" },
			{ text: ".", token: "punctuation" },
			{ text: "onNoteOff", token: "keyword" },
		]);
	});

	// ── Edge cases ──────────────────────────────────────────────────

	it("returns plain for non-slash input", () => {
		const spans = tokenizeSlash("not a command");
		expect(spans).toEqual([{ text: "not a command", token: "plain" }]);
	});

	it("returns plain for bare slash", () => {
		const spans = tokenizeSlash("/");
		expect(spans).toEqual([{ text: "/", token: "plain" }]);
	});

	it("handles multiple spaces between args", () => {
		const spans = tokenizeSlash("/builder  Interface");
		expect(spans).toEqual([
			{ text: "/builder", token: "builder", bold: true },
			{ text: "  ", token: "plain" },
			{ text: "Interface", token: "identifier" },
		]);
	});
});
