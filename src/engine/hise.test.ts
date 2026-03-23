import { describe, expect, it } from "vitest";
import {
	HttpHiseConnection,
	MockHiseConnection,
	isEnvelopeResponse,
	isErrorResponse,
	isSuccessResponse,
	type HiseErrorResponse,
	type HiseEnvelopeResponse,
	type HiseSuccessResponse,
} from "./hise.js";

// ── Response type guards ────────────────────────────────────────────

describe("response type guards", () => {
	it("identifies success responses", () => {
		const response: HiseSuccessResponse = {
			success: true,
			result: "OK",
			logs: [],
			errors: [],
		};
		expect(isEnvelopeResponse(response)).toBe(true);
		expect(isSuccessResponse(response)).toBe(true);
		expect(isErrorResponse(response)).toBe(false);
	});

	it("recognizes execution envelopes that failed evaluation", () => {
		const response: HiseEnvelopeResponse = {
			success: false,
			result: "Error at REPL Evaluation",
			value: "undefined",
			logs: [],
			errors: [{ errorMessage: "This expression is not a function!", callstack: [] }],
		};
		expect(isEnvelopeResponse(response)).toBe(true);
		expect(isSuccessResponse(response)).toBe(false);
		expect(isErrorResponse(response)).toBe(false);
	});

	it("identifies error responses", () => {
		const response: HiseErrorResponse = {
			error: true,
			message: "Not found",
		};
		expect(isErrorResponse(response)).toBe(true);
		expect(isSuccessResponse(response)).toBe(false);
	});
});

// ── MockHiseConnection ──────────────────────────────────────────────

describe("MockHiseConnection", () => {
	it("returns configured GET responses", async () => {
		const mock = new MockHiseConnection();
		mock.onGet("/api/status", () => ({
			success: true as const,
			result: "status",
			logs: [],
			errors: [],
		}));

		const response = await mock.get("/api/status");
		expect(isSuccessResponse(response)).toBe(true);
		if (isSuccessResponse(response)) {
			expect(response.result).toBe("status");
		}
	});

	it("returns configured POST responses", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", (body) => ({
			success: true as const,
			result: "REPL Evaluation OK",
			value: 44100.0,
			moduleId: (body as Record<string, unknown>)?.moduleId as string,
			logs: [],
			errors: [],
		}));

		const response = await mock.post("/api/repl", {
			moduleId: "Interface",
			expression: "Engine.getSampleRate()",
		});

		expect(isSuccessResponse(response)).toBe(true);
		if (isSuccessResponse(response)) {
			expect(response.value).toBe(44100.0);
			expect(response.moduleId).toBe("Interface");
		}
	});

	it("returns error for unhandled endpoints", async () => {
		const mock = new MockHiseConnection();
		const response = await mock.get("/api/unknown");
		expect(isErrorResponse(response)).toBe(true);
		if (isErrorResponse(response)) {
			expect(response.message).toContain("No mock handler");
		}
	});

	it("records all calls", async () => {
		const mock = new MockHiseConnection();
		mock.onGet("/api/status", () => ({
			success: true as const,
			result: "ok",
			logs: [],
			errors: [],
		}));
		mock.onPost("/api/repl", () => ({
			success: true as const,
			result: "ok",
			logs: [],
			errors: [],
		}));

		await mock.get("/api/status");
		await mock.post("/api/repl", { expression: "1+1" });

		expect(mock.calls).toHaveLength(2);
		expect(mock.calls[0]).toEqual({
			method: "GET",
			endpoint: "/api/status",
		});
		expect(mock.calls[1]).toEqual({
			method: "POST",
			endpoint: "/api/repl",
			body: { expression: "1+1" },
		});
	});

	it("supports configurable probe result", async () => {
		const mock = new MockHiseConnection();
		expect(await mock.probe()).toBe(true);

		mock.setProbeResult(false);
		expect(await mock.probe()).toBe(false);
	});

	it("handles POST responses that inspect the body", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/repl", (body) => {
			const b = body as Record<string, unknown>;
			if (b.expression === "invalid") {
				return {
					success: true as const,
					result: "REPL Evaluation OK",
					logs: [],
					errors: [
						{
							errorMessage: "Syntax error",
							callstack: ["line 1"],
						},
					],
				};
			}
			return {
				success: true as const,
				result: "REPL Evaluation OK",
				value: 42,
				logs: [],
				errors: [],
			};
		});

		const good = await mock.post("/api/repl", { expression: "21*2" });
		expect(isSuccessResponse(good) && good.value).toBe(42);

		const bad = await mock.post("/api/repl", { expression: "invalid" });
		expect(isSuccessResponse(bad) && bad.errors.length).toBe(1);
	});

	it("destroy is a no-op", () => {
		const mock = new MockHiseConnection();
		expect(() => mock.destroy()).not.toThrow();
	});
});

// ── HttpHiseConnection ──────────────────────────────────────────────

describe("HttpHiseConnection", () => {
	it("constructs with default host and port", () => {
		const conn = new HttpHiseConnection();
		// Just verify it can be constructed without throwing
		expect(conn).toBeDefined();
		conn.destroy();
	});

	it("constructs with custom host and port", () => {
		const conn = new HttpHiseConnection("localhost", 3000);
		expect(conn).toBeDefined();
		conn.destroy();
	});

	it("probe returns false when HISE is not running", async () => {
		// Use a port that's almost certainly not listening
		const conn = new HttpHiseConnection("127.0.0.1", 19999);
		const result = await conn.probe();
		expect(result).toBe(false);
		conn.destroy();
	});

	it("get returns error when HISE is not running", async () => {
		const conn = new HttpHiseConnection("127.0.0.1", 19999);
		const response = await conn.get("/api/status");
		expect(isErrorResponse(response)).toBe(true);
		conn.destroy();
	});

	it("post returns error when HISE is not running", async () => {
		const conn = new HttpHiseConnection("127.0.0.1", 19999);
		const response = await conn.post("/api/repl", {
			expression: "1+1",
		});
		expect(isErrorResponse(response)).toBe(true);
		conn.destroy();
	});
});
