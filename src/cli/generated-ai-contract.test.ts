import { describe, expect, it } from "vitest";
import { COMPACT_CLI_CONTRACT } from "./generated-ai-contract.js";

describe("compact embedded CLI contract", () => {
	it("contains every generated mode without leaking invocation wrappers", () => {
		for (const mode of ["builder", "dsp", "mcp", "script", "ui"]) {
			expect(COMPACT_CLI_CONTRACT).toContain(`[${mode}]`);
		}
		expect(COMPACT_CLI_CONTRACT).toContain("builder add --type <type> --id <id> [--parent <module-or-chain-path>]");
		expect(COMPACT_CLI_CONTRACT).toContain("Master Chain.FX Chain");
		expect(COMPACT_CLI_CONTRACT).not.toContain("hise-cli builder");
		expect(COMPACT_CLI_CONTRACT).not.toMatch(/\n(?:builder|dsp|mcp|script|ui) .*--agent/);
	});

	it("stays within the system-prompt token budget", () => {
		// About 1.3k tokens for current coding-model tokenizers.
		expect(COMPACT_CLI_CONTRACT.length).toBeLessThan(6_000);
	});
});
