// ── Help content tests ──────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { generateAiHelp, generateHelp } from "./help.js";
import type { CommandEntry } from "./registry.js";

const mockCommands: CommandEntry[] = [
	{ name: "help", description: "Show help", handler: async () => ({ type: "empty" }) },
	{ name: "exit", description: "Exit", handler: async () => ({ type: "empty" }) },
	{ name: "builder", description: "Enter builder", handler: async () => ({ type: "empty" }) },
];

describe("generateHelp", () => {
	it("generates embedded AI help", () => {
		const help = generateAiHelp();
		expect(help.title).toContain("Embedded HISE Agent");
		expect(help.content).toContain("hise-cli's structured tool calls");
		expect(help.content).toContain("/model");
		expect(help.content).toContain("/sessions");
		expect(help.content).toContain("/undo");
	});
	it("generates root mode help", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.title).toContain("HISE CLI");
		expect(help.content).toContain("## Commands");
		expect(help.content).toContain("**/help**");
		expect(help.content).toContain("## Navigation");
	});

	it("generates script mode help", () => {
		const help = generateHelp("script", mockCommands);
		expect(help.title).toContain("script");
		expect(help.content).toContain("HiseScript REPL and callback editing");
		expect(help.content).toContain("HiseScript");
	});

	it("generates builder mode help", () => {
		const help = generateHelp("builder", mockCommands);
		expect(help.title).toContain("builder");
		expect(help.content).toContain("Builder module tree editor");
		expect(help.content).toContain("add");
	});

	it("generates catalogue help for inspect", () => {
		const help = generateHelp("inspect", mockCommands);
		expect(help.title).toContain("inspect");
		expect(help.content).toContain("Interactive inspect operations.");
	});

	it("includes navigation hints", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.content).toContain("## Navigation");
		expect(help.content).toContain("**Tab**");
	});

	it("includes all passed commands", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.content).toContain("**/help**");
		expect(help.content).toContain("**/exit**");
		expect(help.content).toContain("**/builder**");
	});

	it("generates catalogue help for a placeholder mode", () => {
		const help = generateHelp("sampler", mockCommands);
		expect(help.content).toContain("Interactive sampler operations.");
	});

	it("generates dsp mode help", () => {
		const help = generateHelp("dsp", mockCommands);
		expect(help.content).toContain("DSP network editor");
		expect(help.content).toContain("connect");
	});

	it("generates catalogue help for undo", () => {
		const help = generateHelp("undo", mockCommands);
		expect(help.content).toContain("Interactive undo operations.");
	});

	it("uses markdown table for commands", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.content).toContain("| Command | Description |");
		expect(help.content).toContain("|---------|-------------|");
	});

	it("uses markdown lists for navigation", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.content).toContain("- **Tab**:");
		expect(help.content).toContain("- **Up/Down**:");
	});
});
