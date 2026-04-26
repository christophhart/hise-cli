import { describe, it, expect, beforeEach } from "vitest";
import { CommandRegistry } from "../commands/registry.js";
import { registerBuiltinCommands } from "../commands/slash.js";
import { parseScript } from "./parser.js";
import { analyzeScriptForEmbed } from "./embed-check.js";

describe("analyzeScriptForEmbed", () => {
	let registry: CommandRegistry;

	beforeEach(() => {
		registry = new CommandRegistry();
		registerBuiltinCommands(registry);
	});

	it("passes a snippet with only HTTP-backed commands", () => {
		const script = parseScript("/builder\nadd SineSynth\n/exit");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(true);
		expect(result.blocked).toBeUndefined();
	});

	it("blocks /run (filesystem)", () => {
		const script = parseScript("/run snippet.hsc");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(false);
		expect(result.blocked).toMatchObject({
			line: 1,
			content: "/run snippet.hsc",
		});
		expect(result.blocked!.reason).toMatch(/filesystem/i);
	});

	it("blocks /parse (filesystem)", () => {
		const script = parseScript("/parse snippet.hsc");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(false);
		expect(result.blocked!.line).toBe(1);
	});

	it("blocks /analyse mode entry (filesystem)", () => {
		const script = parseScript("/analyse");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(false);
		expect(result.blocked!.reason).toMatch(/filesystem/i);
	});

	it("blocks /hise launch (binary spawn) but not /hise status", () => {
		const ok = analyzeScriptForEmbed(parseScript("/hise status"), registry);
		expect(ok.runnable).toBe(true);

		const oneShot = analyzeScriptForEmbed(parseScript("/hise launch"), registry);
		expect(oneShot.runnable).toBe(false);
		expect(oneShot.blocked!.reason).toMatch(/local CLI/i);

		const inMode = analyzeScriptForEmbed(
			parseScript("/hise\nlaunch"),
			registry,
		);
		expect(inMode.runnable).toBe(false);
		expect(inMode.blocked!.line).toBe(2);
	});

	it("fails fast on the first blocker", () => {
		const script = parseScript("/builder\n/exit\n/run a.hsc\n/parse b.hsc");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(false);
		expect(result.blocked!.line).toBe(3);
		expect(result.blocked!.content).toBe("/run a.hsc");
	});

	it("tracks /exit so mode-context blockers fire in the right scope", () => {
		const script = parseScript("/hise\n/exit\nlaunch");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(true);
	});

	it("ignores unknown commands (semantics belong to the validator)", () => {
		const script = parseScript("/totally-not-a-command");
		const result = analyzeScriptForEmbed(script, registry);
		expect(result.runnable).toBe(true);
	});

	it("blocks wizard aliases", () => {
		registry.register({
			name: "setup",
			description: "Setup wizard",
			handler: async () => ({ kind: "text", text: "" }) as never,
			kind: "command",
			embedBlockedReason: "Wizards run shell commands and need the local CLI.",
		});
		const result = analyzeScriptForEmbed(parseScript("/setup"), registry);
		expect(result.runnable).toBe(false);
		expect(result.blocked!.reason).toMatch(/shell|CLI/i);
	});
});
