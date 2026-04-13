import { describe, it, expect } from "vitest";
import { tokenizeSequence } from "./sequence.js";

function tokenTypes(source: string) {
	return tokenizeSequence(source).map(s => [s.text, s.token]);
}

describe("tokenizeSequence", () => {
	it("highlights command keywords", () => {
		const tokens = tokenTypes("create");
		expect(tokens).toEqual([["create", "keyword"]]);
	});

	it("highlights create with quoted name", () => {
		const tokens = tokenTypes('create "My Sequence"');
		expect(tokens).toEqual([
			["create", "keyword"],
			[" ", "plain"],
			['"My Sequence"', "string"],
		]);
	});

	it("highlights timestamped note event", () => {
		const tokens = tokenTypes("0ms play C3 127 for 500ms");
		expect(tokens[0]).toEqual(["0ms", "float"]);
		expect(tokens[2]).toEqual(["play", "keyword"]);
		expect(tokens[4]).toEqual(["C3", "identifier"]);
		expect(tokens[6]).toEqual(["127", "integer"]);
		expect(tokens[8]).toEqual(["for", "comment"]); // dim connector
		expect(tokens[10]).toEqual(["500ms", "float"]);
	});

	it("highlights send CC", () => {
		const tokens = tokenTypes("500ms send CC 1 127");
		expect(tokens[0]).toEqual(["500ms", "float"]);
		expect(tokens[2]).toEqual(["send", "keyword"]);
		expect(tokens[4]).toEqual(["CC", "keyword"]);
	});

	it("highlights signal with frequency", () => {
		const tokens = tokenTypes("1.2s play sine at 440Hz for 500ms");
		expect(tokens[0]).toEqual(["1.2s", "float"]);
		expect(tokens[2]).toEqual(["play", "keyword"]);
		expect(tokens[4]).toEqual(["sine", "keyword"]);
		expect(tokens[6]).toEqual(["at", "comment"]);
		expect(tokens[8]).toEqual(["440Hz", "float"]);
	});

	it("highlights sweep with kHz", () => {
		const tokens = tokenTypes("0ms play sweep from 20Hz to 20kHz for 1.5s");
		const texts = tokenizeSequence("0ms play sweep from 20Hz to 20kHz for 1.5s");
		const sweepToken = texts.find(t => t.text === "sweep");
		expect(sweepToken?.token).toBe("keyword");
		const fromToken = texts.find(t => t.text === "from");
		expect(fromToken?.token).toBe("comment");
		const khzToken = texts.find(t => t.text === "20kHz");
		expect(khzToken?.token).toBe("float");
	});

	it("highlights eval with as connector", () => {
		const tokens = tokenTypes("900ms eval Synth.getNumPressedKeys() as voice_test");
		expect(tokens[2]).toEqual(["eval", "keyword"]);
		const asToken = tokenizeSequence("900ms eval Synth.getNumPressedKeys() as voice_test")
			.find(t => t.text === "as");
		expect(asToken?.token).toBe("comment");
	});

	it("highlights set with processor path", () => {
		const tokens = tokenTypes("800ms set SimpleGain.Gain -12");
		expect(tokens[2]).toEqual(["set", "keyword"]);
		expect(tokens[4]).toEqual(["SimpleGain.Gain", "identifier"]);
	});

	it("highlights get command", () => {
		const tokens = tokenTypes("get voice_test");
		expect(tokens[0]).toEqual(["get", "keyword"]);
	});

	it("delegates slash commands to slash tokenizer", () => {
		const tokens = tokenizeSequence("/exit");
		expect(tokens.length).toBeGreaterThan(0);
	});
});
