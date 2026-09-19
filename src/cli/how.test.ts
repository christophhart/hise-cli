import { describe, expect, it } from "vitest";
import { howPrompt, runHow } from "./how.js";

describe("runHow", () => {
	it("uses one shared surface-aware worker contract", async () => {
		const result = await runHow({
			query: "add a builder module",
			surface: "tui",
			projectDir: "/project",
			worker: async ({ surface, prompt }) => {
				expect(surface).toBe("tui");
				expect(prompt).toContain("Never emit hise-cli invocations");
				return "Use /builder, then add SimpleGain as Drive.";
			},
		});
		expect(result).toEqual({
			query: "add a builder module",
			surface: "tui",
			guidance: "Use /builder, then add SimpleGain as Drive.",
		});
	});

	it("pins the requested mode instead of asking the worker to infer it", () => {
		const prompt = howPrompt("cli", "builder");
		expect(prompt).toContain("The active mode is builder");
		expect(prompt).toContain("Do not select a different mode");
		expect(prompt).toContain("Never emit slash commands");
	});
});
