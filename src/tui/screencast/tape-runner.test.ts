// ── Tape screencast tests (Phase 2.9) ───────────────────────────────

// Basic tape test: parses .tape files, extracts commands, and validates
// that the command sequences are structurally correct. Full ink-testing-library
// execution will be added in a later phase — these tests verify the
// tape → Session → assertion pipeline at the command level.

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { parseTape, type ParseResult } from "../../engine/screencast/tape-parser.js";
import type { TapeCommand } from "../../engine/screencast/types.js";
import { Session } from "../../engine/session.js";
import { MockHiseConnection } from "../../engine/hise.js";
import { ScriptMode } from "../../engine/modes/script.js";
import { InspectMode } from "../../engine/modes/inspect.js";
import { BuilderMode } from "../../engine/modes/builder.js";
import type { ModuleList } from "../../engine/data.js";

const SCREENCASTS_DIR = path.resolve(import.meta.dirname, "../../../screencasts");

// Load module data for builder validation
let moduleList: ModuleList;

beforeAll(() => {
	const dataDir = path.resolve(import.meta.dirname, "../../../data");
	const raw = fs.readFileSync(path.join(dataDir, "moduleList.json"), "utf8");
	moduleList = JSON.parse(raw) as ModuleList;
});

function createTestSession(): Session {
	const mock = new MockHiseConnection();
	mock.onPost("/api/repl", (body) => ({
		success: true as const,
		result: "REPL Evaluation OK",
		value: 44100.0,
		logs: [],
		errors: [],
	}));

	const session = new Session(mock);
	session.registerMode("script", (ctx) => new ScriptMode(ctx));
	session.registerMode("inspect", () => new InspectMode());
	session.registerMode("builder", () => new BuilderMode(moduleList));
	return session;
}

// Extract typed text and key commands from tape commands
function extractInputs(commands: TapeCommand[]): Array<{
	type: "type" | "key";
	value: string;
}> {
	const inputs: Array<{ type: "type" | "key"; value: string }> = [];
	for (const cmd of commands) {
		if (cmd.type === "Type") {
			inputs.push({ type: "type", value: cmd.text });
		} else if (cmd.type === "Key") {
			inputs.push({ type: "key", value: cmd.key });
		}
	}
	return inputs;
}

// Extract ExpectMode assertions from tape commands
function extractModeAssertions(commands: TapeCommand[]): string[] {
	return commands
		.filter((c) => c.type === "ExpectMode")
		.map((c) => (c as { type: "ExpectMode"; mode: string }).mode);
}

// ── mode-switching.tape ─────────────────────────────────────────────

describe("screencast: mode-switching.tape", () => {
	let parsed: ParseResult;

	beforeAll(() => {
		const source = fs.readFileSync(
			path.join(SCREENCASTS_DIR, "mode-switching.tape"),
			"utf8",
		);
		parsed = parseTape(source);
	});

	it("parses without errors", () => {
		expect(parsed.errors).toHaveLength(0);
	});

	it("has commands", () => {
		expect(parsed.commands.length).toBeGreaterThan(0);
	});

	it("contains mode switch commands", () => {
		const inputs = extractInputs(parsed.commands);
		const typed = inputs.filter((i) => i.type === "type").map((i) => i.value);
		expect(typed).toContain("/script");
		expect(typed).toContain("/builder");
		expect(typed).toContain("/inspect");
		expect(typed).toContain("/exit");
	});

	it("asserts correct mode transitions", () => {
		const modes = extractModeAssertions(parsed.commands);
		expect(modes).toContain("script");
		expect(modes).toContain("builder");
		expect(modes).toContain("inspect");
		expect(modes).toContain("root");
	});

	it("simulates mode switching against session", async () => {
		const session = createTestSession();

		// Enter script mode
		await session.handleInput("/script");
		expect(session.currentMode().id).toBe("script");

		// Exit script
		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");

		// Enter builder mode
		await session.handleInput("/builder");
		expect(session.currentMode().id).toBe("builder");

		// Exit builder
		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");

		// Enter inspect mode
		await session.handleInput("/inspect");
		expect(session.currentMode().id).toBe("inspect");

		// Exit inspect
		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");
	});
});

// ── script-repl.tape ────────────────────────────────────────────────

describe("screencast: script-repl.tape", () => {
	let parsed: ParseResult;

	beforeAll(() => {
		const source = fs.readFileSync(
			path.join(SCREENCASTS_DIR, "script-repl.tape"),
			"utf8",
		);
		parsed = parseTape(source);
	});

	it("parses without errors", () => {
		expect(parsed.errors).toHaveLength(0);
	});

	it("contains script evaluation command", () => {
		const inputs = extractInputs(parsed.commands);
		const typed = inputs.filter((i) => i.type === "type").map((i) => i.value);
		expect(typed).toContain("Engine.getSampleRate()");
	});

	it("has mock response configuration", () => {
		const mockResponses = parsed.commands.filter(
			(c) => c.type === "SetMockResponse",
		);
		expect(mockResponses.length).toBeGreaterThan(0);
	});

	it("simulates script REPL against session", async () => {
		const session = createTestSession();

		// Enter script mode
		await session.handleInput("/script");
		expect(session.currentMode().id).toBe("script");

		// Evaluate expression
		const result = await session.handleInput("Engine.getSampleRate()");
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("44100");
		}

		// Exit
		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");
	});
});

// ── builder-validation.tape ─────────────────────────────────────────

describe("screencast: builder-validation.tape", () => {
	let parsed: ParseResult;

	beforeAll(() => {
		const source = fs.readFileSync(
			path.join(SCREENCASTS_DIR, "builder-validation.tape"),
			"utf8",
		);
		parsed = parseTape(source);
	});

	it("parses without errors", () => {
		expect(parsed.errors).toHaveLength(0);
	});

	it("contains builder commands", () => {
		const inputs = extractInputs(parsed.commands);
		const typed = inputs.filter((i) => i.type === "type").map((i) => i.value);
		expect(typed).toContain("add AHDSR");
		expect(typed).toContain("add AHDRS"); // typo
		expect(typed).toContain("add FakeModule");
	});

	it("simulates builder validation against session", async () => {
		const session = createTestSession();

		// Enter builder mode
		await session.handleInput("/builder");
		expect(session.currentMode().id).toBe("builder");

		// Valid module
		const valid = await session.handleInput("add AHDSR");
		expect(valid.type).toBe("text");

		// Typo — should suggest AHDSR
		const typo = await session.handleInput("add AHDRS");
		expect(typo.type).toBe("error");
		if (typo.type === "error") {
			expect(typo.message).toContain("Did you mean");
			expect(typo.message).toContain("AHDSR");
		}

		// Unknown module
		const unknown = await session.handleInput("add FakeModule");
		expect(unknown.type).toBe("error");
		if (unknown.type === "error") {
			expect(unknown.message).toContain("Unknown module type");
		}

		// Exit
		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");
	});
});
