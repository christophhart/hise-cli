import { describe, expect, it } from "vitest";
import { ScriptMode, formatReplResponse } from "./script.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import type { HiseSuccessResponse } from "../hise.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockSession(
	mock: MockHiseConnection,
): SessionContext {
	return { connection: mock };
}

function successResponse(
	overrides: Partial<HiseSuccessResponse> = {},
): HiseSuccessResponse {
	return {
		success: true,
		result: "REPL Evaluation OK",
		logs: [],
		errors: [],
		...overrides,
	};
}

// ── ScriptMode identity ─────────────────────────────────────────────

describe("ScriptMode", () => {
	it("has correct identity", () => {
		const mode = new ScriptMode();
		expect(mode.id).toBe("script");
		expect(mode.name).toBe("Script");
		expect(mode.accent).toBe("#7aa2f7");
	});

	it("defaults to Interface processor", () => {
		const mode = new ScriptMode();
		expect(mode.processorId).toBe("Interface");
		expect(mode.prompt).toBe("[script] > ");
	});

	it("accepts custom processor ID", () => {
		const mode = new ScriptMode("MyProcessor");
		expect(mode.processorId).toBe("MyProcessor");
		expect(mode.prompt).toBe("[script:MyProcessor] > ");
	});

	it("returns error when no connection", async () => {
		const mode = new ScriptMode();
		const session: SessionContext = { connection: null };
		const result = await mode.parse("Engine.getSampleRate()", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("No HISE connection");
		}
	});
});

// ── REPL round-trip (with MockHiseConnection) ───────────────────────

describe("ScriptMode REPL round-trip", () => {
	it("sends expression to POST /api/repl", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({ value: 44100.0 }),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		await mode.parse("Engine.getSampleRate()", session);

		expect(mock.calls).toHaveLength(1);
		expect(mock.calls[0].method).toBe("POST");
		expect(mock.calls[0].endpoint).toBe("/api/repl");
		expect(mock.calls[0].body).toEqual({
			expression: "Engine.getSampleRate()",
			moduleId: "Interface",
		});
	});

	it("forwards custom processor ID in request", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({ value: 44100.0 }),
		);

		const mode = new ScriptMode("MyProcessor");
		const session = createMockSession(mock);
		await mode.parse("Engine.getSampleRate()", session);

		expect(
			(mock.calls[0].body as Record<string, unknown>).moduleId,
		).toBe("MyProcessor");
	});

	it("reads value from response.value (not response.result)", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({
				result: "REPL Evaluation OK",
				value: 44100.0,
			}),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse("Engine.getSampleRate()", session);

		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("44100");
		}
	});

	it("handles string values", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({ value: "hello world" }),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse('Console.print("hello")', session);

		if (result.type === "text") {
			expect(result.content).toContain("hello world");
		}
	});

	it("handles undefined value", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({ value: undefined }),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse("var x = 5;", session);

		if (result.type === "text") {
			expect(result.content).toBe("(no output)");
		}
	});

	it("includes console logs in output", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({
				logs: ["Log line 1", "Log line 2"],
				value: 42,
			}),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse("Console.print(42)", session);

		if (result.type === "text") {
			expect(result.content).toContain("Log line 1");
			expect(result.content).toContain("Log line 2");
			expect(result.content).toContain("42");
		}
	});

	it("handles script errors", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () =>
			successResponse({
				errors: [
					{
						errorMessage: "Syntax error: unexpected token",
						callstack: ["onInit() - Line 1, column 5"],
					},
				],
			}),
		);

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse("invalid!!!", session);

		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Syntax error");
			expect(result.message).toContain("Line 1");
		}
	});

	it("handles connection-level errors", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", () => ({
			error: true as const,
			message: "Connection refused",
		}));

		const mode = new ScriptMode();
		const session = createMockSession(mock);
		const result = await mode.parse("Engine.getSampleRate()", session);

		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Connection refused");
		}
	});
});

// ── formatReplResponse (pure function) ──────────────────────────────

describe("formatReplResponse", () => {
	it("formats numeric value", () => {
		const result = formatReplResponse(
			successResponse({ value: 44100 }),
			"test",
		);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("44100");
		}
	});

	it("formats boolean value", () => {
		const result = formatReplResponse(
			successResponse({ value: true }),
			"test",
		);
		if (result.type === "text") {
			expect(result.content).toBe("true");
		}
	});

	it("formats object value as JSON", () => {
		const result = formatReplResponse(
			successResponse({ value: { key: "val" } }),
			"test",
		);
		if (result.type === "text") {
			expect(result.content).toContain('"key"');
			expect(result.content).toContain('"val"');
		}
	});

	it("handles error response", () => {
		const result = formatReplResponse(
			{ error: true, message: "Bad request" },
			"test",
		);
		expect(result.type).toBe("error");
	});

	it("shows (no output) for undefined value with no logs", () => {
		const result = formatReplResponse(
			successResponse({ value: undefined }),
			"test",
		);
		if (result.type === "text") {
			expect(result.content).toBe("(no output)");
		}
	});
});
