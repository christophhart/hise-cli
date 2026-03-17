import { describe, expect, it } from "vitest";
import { ScriptMode, extractLastToken, formatReplResponse } from "./script.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import type { HiseSuccessResponse } from "../hise.js";
import { CompletionEngine, buildDatasets } from "../completion/engine.js";
import type { ScriptingApi } from "../data.js";
import { parseMarkdown } from "../markdown/parser.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockSession(
	mock: MockHiseConnection,
): SessionContext {
	return {
		connection: mock,
		popMode: () => ({ type: "text", content: "Exited Script mode." }),
	};
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
		expect(mode.accent).toBe("#C65638");
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
		const session: SessionContext = {
			connection: null,
			popMode: () => ({ type: "text", content: "Exited Script mode." }),
		};
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

		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
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

		if (result.type === "markdown") {
			// Logs should be blockquoted
			expect(result.content).toContain("> Log line 1");
			expect(result.content).toContain("> Log line 2");
			// Return value should NOT be blockquoted
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
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toBe("44100");
		}
	});

	it("formats boolean value", () => {
		const result = formatReplResponse(
			successResponse({ value: true }),
			"test",
		);
		if (result.type === "markdown") {
			expect(result.content).toBe("true");
		}
	});

	it("formats object value as JSON", () => {
		const result = formatReplResponse(
			successResponse({ value: { key: "val" } }),
			"test",
		);
		if (result.type === "markdown") {
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

	it("separates blockquoted logs from plain return value with blank line", () => {
		// HISE returns the string "undefined" as value when expression returns undefined
		const result = formatReplResponse(
			successResponse({ value: "undefined", logs: ["1234"] }),
			"Console.print(1234)",
		);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			// Should use blank line separator to prevent blockquote continuation
			expect(result.content).toBe("> 1234\n\nundefined");
			
			// Verify AST structure: blockquote node + paragraph node (NOT nested)
			const ast = parseMarkdown(result.content);
			expect(ast.nodes).toHaveLength(2);
			expect(ast.nodes[0].type).toBe("blockquote");
			expect(ast.nodes[1].type).toBe("paragraph");
		}
	});

	it("handles multiple log lines with return value", () => {
		const result = formatReplResponse(
			successResponse({ value: 42, logs: ["line1", "line2"] }),
			"test",
		);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			// All logs blockquoted, then blank line, then return value
			expect(result.content).toBe("> line1\n> line2\n\n42");
		}
	});
});

// ── extractLastToken ────────────────────────────────────────────────

describe("extractLastToken", () => {
	it("extracts identifier at end", () => {
		const result = extractLastToken("Synth");
		expect(result.text).toBe("Synth");
		expect(result.from).toBe(0);
	});

	it("extracts dotted identifier", () => {
		const result = extractLastToken("Synth.addNoteOn");
		expect(result.text).toBe("Synth.addNoteOn");
		expect(result.from).toBe(0);
	});

	it("extracts last token after space", () => {
		const result = extractLastToken("var x = Synth.add");
		expect(result.text).toBe("Synth.add");
		expect(result.from).toBe(8);
	});

	it("extracts last token after operator", () => {
		const result = extractLastToken("x + Math");
		expect(result.text).toBe("Math");
		expect(result.from).toBe(4);
	});

	it("returns empty for trailing space", () => {
		const result = extractLastToken("var x = ");
		expect(result.text).toBe("");
		expect(result.from).toBe(8);
	});

	it("handles empty input", () => {
		const result = extractLastToken("");
		expect(result.text).toBe("");
		expect(result.from).toBe(0);
	});
});

// ── ScriptMode completion ───────────────────────────────────────────

describe("ScriptMode completion", () => {
	function createScriptEngine(): CompletionEngine {
		const api: ScriptingApi = {
			version: "1.0",
			generated: "2024",
			enrichedClasses: [],
			classes: {
				Synth: {
					description: "Synth",
					category: "namespace",
					methods: [
						{
							name: "addNoteOn",
							returnType: "int",
							description: "Add note",
							parameters: [
								{ name: "channel", type: "int" },
								{ name: "note", type: "int" },
								{ name: "vel", type: "int" },
								{ name: "ts", type: "int" },
							],
							examples: [],
						},
						{
							name: "getNoteCounter",
							returnType: "int",
							description: "Get count",
							parameters: [],
							examples: [],
						},
					],
				},
				Engine: {
					description: "Engine",
					category: "namespace",
					methods: [
						{
							name: "getSampleRate",
							returnType: "double",
							description: "Sample rate",
							parameters: [],
							examples: [],
						},
					],
				},
			},
		};

		const engine = new CompletionEngine();
		engine.setDatasets(buildDatasets(null, api, null));
		return engine;
	}

	it("returns empty without engine", () => {
		const mode = new ScriptMode();
		const result = mode.complete!("Synth", 5);
		expect(result.items).toHaveLength(0);
	});

	it("completes namespace names", () => {
		const engine = createScriptEngine();
		const mode = new ScriptMode("Interface", engine);
		const result = mode.complete!("Sy", 2);
		expect(result.items.some((i) => i.label === "Synth")).toBe(true);
		expect(result.from).toBe(0);
	});

	it("completes methods after dot", () => {
		const engine = createScriptEngine();
		const mode = new ScriptMode("Interface", engine);
		const result = mode.complete!("Synth.add", 9);
		expect(result.items.some((i) => i.label === "addNoteOn")).toBe(true);
	});

	it("completes last token in expression", () => {
		const engine = createScriptEngine();
		const mode = new ScriptMode("Interface", engine);
		const result = mode.complete!("var x = Engine.get", 18);
		expect(result.items.some((i) => i.label === "getSampleRate")).toBe(true);
		// "var x = Engine.get" — lastToken = "Engine.get", from = 8
		// completeScript("Engine.get") → dotIndex=6, from=7 (within token)
		// Adjusted: 8 + 7 = 15
		expect(result.from).toBe(15);
	});
});
