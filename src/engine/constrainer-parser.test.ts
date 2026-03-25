import { describe, expect, it } from "vitest";
import { ConstrainerParser } from "./constrainer-parser.js";

describe("ConstrainerParser", () => {
	it("matchAll accepts everything", () => {
		const cp = new ConstrainerParser("*");
		expect(cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" })).toEqual({ ok: true });
		expect(cp.check({ id: "LFO", subtype: "TimeVariantModulator" })).toEqual({ ok: true });
	});

	it("positive match by subtype", () => {
		const cp = new ConstrainerParser("EnvelopeModulator");
		expect(cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" }).ok).toBe(true);
		expect(cp.check({ id: "LFO", subtype: "TimeVariantModulator" }).ok).toBe(false);
	});

	it("multiple positive patterns", () => {
		const cp = new ConstrainerParser("MasterEffect|MonophonicEffect");
		expect(cp.check({ id: "SimpleReverb", subtype: "MasterEffect" }).ok).toBe(true);
		expect(cp.check({ id: "SimpleGain", subtype: "MasterEffect" }).ok).toBe(true);
		expect(cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" }).ok).toBe(false);
	});

	it("negative match by id", () => {
		const cp = new ConstrainerParser("!RouteEffect|!SlotFX");
		expect(cp.check({ id: "RouteEffect", subtype: "MasterEffect" }).ok).toBe(false);
		expect(cp.check({ id: "SlotFX", subtype: "MasterEffect" }).ok).toBe(false);
		expect(cp.check({ id: "SimpleReverb", subtype: "MasterEffect" }).ok).toBe(true);
	});

	it("mixed positive and negative", () => {
		const cp = new ConstrainerParser("MasterEffect|MonophonicEffect|!RouteEffect|!SlotFX");
		// Positive subtype match, not excluded
		expect(cp.check({ id: "SimpleReverb", subtype: "MasterEffect" }).ok).toBe(true);
		// Positive subtype match but excluded by id
		expect(cp.check({ id: "SlotFX", subtype: "MasterEffect" }).ok).toBe(false);
		// Wrong subtype
		expect(cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" }).ok).toBe(false);
	});

	it("negative-only pattern accepts non-excluded", () => {
		const cp = new ConstrainerParser("!RouteEffect");
		expect(cp.check({ id: "RouteEffect", subtype: "MasterEffect" }).ok).toBe(false);
		expect(cp.check({ id: "SimpleGain", subtype: "MasterEffect" }).ok).toBe(true);
		expect(cp.check({ id: "LFO", subtype: "TimeVariantModulator" }).ok).toBe(true);
	});

	it("PolyFilterEffect special rule matches by id", () => {
		const cp = new ConstrainerParser("PolyphonicFilter");
		// PolyFilterEffect doesn't have subtype "PolyphonicFilter" but matches by id rule
		expect(cp.check({ id: "PolyFilterEffect", subtype: "VoiceEffect" }).ok).toBe(false);
		// The special rule checks if id === pattern, so "PolyFilterEffect" must be the pattern
		const cp2 = new ConstrainerParser("PolyFilterEffect");
		expect(cp2.check({ id: "PolyFilterEffect", subtype: "VoiceEffect" }).ok).toBe(true);
	});

	it("VoiceStartModulator constrainer", () => {
		const cp = new ConstrainerParser("VoiceStartModulator");
		expect(cp.check({ id: "Velocity", subtype: "VoiceStartModulator" }).ok).toBe(true);
		expect(cp.check({ id: "ArrayModulator", subtype: "VoiceStartModulator" }).ok).toBe(true);
		expect(cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" }).ok).toBe(false);
		expect(cp.check({ id: "LFO", subtype: "TimeVariantModulator" }).ok).toBe(false);
	});

	it("error messages are descriptive", () => {
		const cp = new ConstrainerParser("MasterEffect|!SlotFX");
		const neg = cp.check({ id: "SlotFX", subtype: "MasterEffect" });
		expect(neg.ok).toBe(false);
		expect(neg.error).toContain("SlotFX");

		const noMatch = cp.check({ id: "AHDSR", subtype: "EnvelopeModulator" });
		expect(noMatch.ok).toBe(false);
		expect(noMatch.error).toContain("EnvelopeModulator");
		expect(noMatch.error).toContain("MasterEffect");
	});

	it("parses patterns correctly", () => {
		const cp = new ConstrainerParser("MasterEffect|!RouteEffect|MonophonicEffect");
		expect(cp.matchAll).toBe(false);
		expect(cp.positivePatterns).toEqual(["MasterEffect", "MonophonicEffect"]);
		expect(cp.negativePatterns).toEqual(["RouteEffect"]);
	});
});
