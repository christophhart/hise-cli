import { describe, expect, it } from "vitest";
import { extractToolResultText, formatToolFailure } from "./InlineApp.js";

describe("extractToolResultText", () => {
	it("extracts the exact text returned by a tool", () => {
		expect(extractToolResultText({
			content: [
				{ type: "text", text: "Sourced answer" },
				{ type: "image", data: "ignored" },
				{ type: "text", text: "Research usage: 100 tokens" },
			],
		})).toBe("Sourced answer\nResearch usage: 100 tokens");
	});

	it("ignores malformed and non-text results", () => {
		expect(extractToolResultText(undefined)).toBeNull();
		expect(extractToolResultText({ content: [{ type: "image" }] })).toBeNull();
	});

	it("includes returned error details for every failed tool", () => {
		expect(formatToolFailure("hise_command", {
			content: [{ type: "text", text: "Found ')' when expecting ';'" }],
		})).toBe("✗ hise_command failed: Found ')' when expecting ';'");
	});
});
