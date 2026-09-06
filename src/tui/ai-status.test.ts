import { describe, expect, it } from "vitest";
import { formatAiActivity, formatAiStatus, formatElapsed } from "./InlineApp.js";

describe("AI status display", () => {
	it("formats model, context, tokens, and tools", () => {
		expect(formatAiStatus("local/qwen", true, {
			input: 1200,
			output: 386,
			cacheRead: 0,
			total: 1586,
			cost: 0,
			toolCalls: 4,
			contextTokens: 18000,
			contextWindow: 32768,
			contextPercent: 55,
		})).toBe("ai · local/qwen · working · ctx 18k/33k · ↑1.2k ↓386 · 4 tools");
	});

	it("omits unavailable runtime statistics", () => {
		expect(formatAiStatus("local/qwen", false)).toBe("ai · local/qwen");
	});

	it("formats live thinking and tool activity", () => {
		expect(formatAiActivity({ kind: "thinking" })).toBe("Thinking…");
		expect(formatAiActivity({
			kind: "tool",
			toolName: "hise_command",
			args: { argv: ["builder", "show", "tree"] },
		})).toBe("Running hise_command: builder show tree");
		expect(formatElapsed(4250)).toBe("4.3s");
	});
});
