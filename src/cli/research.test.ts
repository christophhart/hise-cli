import { describe, expect, it } from "vitest";
import { extractResearchStats } from "./research.js";

describe("one-shot research output", () => {
	it("extracts structured model, reasoning, usage, and validation stats", () => {
		const markdown = [
			"# Answer",
			"---",
			"Research model: openrouter/example/model (medium)",
			"Research usage: 3.8k input · 420 output · 4.2k total tokens",
			"Script validation: passed (1 block, 0 repair passes)",
		].join("\n");
		expect(extractResearchStats(markdown)).toEqual({
			model: "openrouter/example/model",
			reasoningLevel: "medium",
			inputTokens: 3800,
			outputTokens: 420,
			totalTokens: 4200,
			validation: "passed (1 block, 0 repair passes)",
		});
	});
});
