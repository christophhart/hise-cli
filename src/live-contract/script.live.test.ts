import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HttpHiseConnection } from "../engine/hise.js";
import { formatReplResponse } from "../engine/modes/script.js";
import { normalizeReplResponse } from "../mock/contracts/repl.js";
import { createMockReplResponse } from "../mock/runtime.js";
import { postLiveRepl, requireLiveHiseConnection, sanitizeFormattingSnapshot } from "./helpers.js";

let connection: HttpHiseConnection;

beforeAll(async () => {
	connection = await requireLiveHiseConnection();
});

afterAll(() => {
	connection.destroy();
});

describe("live contract parity — script /api/repl", () => {
	it("matches the mock success envelope shape for Engine.getSampleRate()", async () => {
		const live = normalizeReplResponse(await postLiveRepl(connection, "Engine.getSampleRate()"));
		const mock = normalizeReplResponse(createMockReplResponse({ expression: "Engine.getSampleRate()", moduleId: "Interface" }));
		expect(live.kind).toBe(mock.kind);
		if (live.kind === "success" && mock.kind === "success") {
			expect(typeof live.result).toBe(typeof mock.result);
			expect(Array.isArray(live.logs)).toBe(true);
			expect(Array.isArray(live.errors)).toBe(true);
		}
	});

	it("preserves formatter structure for Console.print(1234)", async () => {
		const expression = "Console.print(1234)";
		const liveResponse = await postLiveRepl(connection, expression);
		const mockResponse = createMockReplResponse({ expression, moduleId: "Interface" });
		const liveResult = formatReplResponse(liveResponse, expression);
		const mockResult = formatReplResponse(mockResponse, expression);
		expect(liveResult.type).toBe("markdown");
		expect(mockResult.type).toBe("markdown");
		if (liveResult.type === "markdown" && mockResult.type === "markdown") {
			expect(sanitizeFormattingSnapshot(liveResult.content)).toBe(sanitizeFormattingSnapshot(mockResult.content));
		}
	});

	it("preserves formatter structure for missing component errors", async () => {
		const expression = 'Content.getComponent("x")';
		const liveResponse = await postLiveRepl(connection, expression);
		const mockResponse = createMockReplResponse({ expression, moduleId: "Interface" });
		const liveResult = formatReplResponse(liveResponse, expression);
		const mockResult = formatReplResponse(mockResponse, expression);
		expect(liveResult.type).toBe("error");
		expect(mockResult.type).toBe("error");
		if (liveResult.type === "error" && mockResult.type === "error") {
			expect(sanitizeFormattingSnapshot(liveResult.message)).toBe(sanitizeFormattingSnapshot(mockResult.message));
		}
	});

	it("formats evaluation-failed repl envelopes as script errors", async () => {
		const expression = "someErrorStuff()";
		const liveResponse = await postLiveRepl(connection, expression);
		const mockResponse = createMockReplResponse({ expression, moduleId: "Interface" });
		const liveResult = formatReplResponse(liveResponse, expression);
		const mockResult = formatReplResponse(mockResponse, expression);
		expect(liveResult.type).toBe("error");
		expect(mockResult.type).toBe("error");
		if (liveResult.type === "error" && mockResult.type === "error") {
			expect(sanitizeFormattingSnapshot(liveResult.message)).toBe(sanitizeFormattingSnapshot(mockResult.message));
		}
	});
});
