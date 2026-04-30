import { describe, it, expect } from "vitest";
import { parsePayloadList, ALLOWED_PAYLOAD } from "./publish-parse.js";

describe("parsePayloadList", () => {
	it("rejects empty input", () => {
		const r = parsePayloadList("");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Empty/);
	});

	it("rejects whitespace-only input", () => {
		const r = parsePayloadList("   ,   ");
		expect(r.ok).toBe(false);
	});

	it("accepts a single valid target", () => {
		const r = parsePayloadList("VST3");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.targets).toEqual(["VST3"]);
	});

	it("accepts all four targets", () => {
		const r = parsePayloadList("VST3,AU,AAX,Standalone");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.targets).toEqual([...ALLOWED_PAYLOAD]);
	});

	it("matches case-insensitively but normalizes to canonical case", () => {
		const r = parsePayloadList("vst3, au, AaX");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.targets).toEqual(["VST3", "AU", "AAX"]);
	});

	it("rejects unknown tokens", () => {
		const r = parsePayloadList("VST3,LV2");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Unknown payload "LV2"/);
	});

	it("rejects duplicates", () => {
		const r = parsePayloadList("VST3,vst3");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/Duplicate/);
	});

	it("ignores empty entries between commas", () => {
		const r = parsePayloadList("VST3,,AU,");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.targets).toEqual(["VST3", "AU"]);
	});
});
