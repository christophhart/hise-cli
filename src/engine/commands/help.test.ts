// ── Help content tests ──────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { generateHelp } from "./help.js";
import type { CommandEntry } from "./registry.js";

const mockCommands: CommandEntry[] = [
	{ name: "help", description: "Show help", handler: async () => ({ type: "empty" }) },
	{ name: "exit", description: "Exit", handler: async () => ({ type: "empty" }) },
	{ name: "builder", description: "Enter builder", handler: async () => ({ type: "empty" }) },
];

describe("generateHelp", () => {
	it("generates root mode help", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.title).toContain("HISE CLI");
		expect(help.content).toContain("## Commands");
		expect(help.content).toContain("**/help**");
		expect(help.footer).toContain("Esc");
	});

	it("generates script mode help", () => {
		const help = generateHelp("script", mockCommands);
		expect(help.title).toContain("script");
		expect(help.content).toContain("# SCRIPT MODE");
		expect(help.content).toContain("HiseScript");
	});

	it("generates builder mode help", () => {
		const help = generateHelp("builder", mockCommands);
		expect(help.title).toContain("builder");
		expect(help.content).toContain("# BUILDER MODE");
		expect(help.content).toContain("add");
	});

	it("generates inspect mode help", () => {
		const help = generateHelp("inspect", mockCommands);
		expect(help.title).toContain("inspect");
		expect(help.content).toContain("# INSPECT MODE");
		expect(help.content).toContain("cpu");
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

	it("generates help for stub modes", () => {
		// DSP, sampler, etc. should show stub help
		const help = generateHelp("dsp", mockCommands);
		expect(help.content).toContain("# DSP MODE");
		expect(help.content).toContain("pending");
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
