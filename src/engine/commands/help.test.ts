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
		expect(help.lines.some((l) => l.includes("COMMANDS"))).toBe(true);
		expect(help.lines.some((l) => l.includes("/help"))).toBe(true);
		expect(help.footer).toContain("Esc");
	});

	it("generates script mode help", () => {
		const help = generateHelp("script", mockCommands);
		expect(help.title).toContain("script");
		expect(help.lines.some((l) => l.includes("SCRIPT MODE"))).toBe(true);
		expect(help.lines.some((l) => l.includes("HiseScript"))).toBe(true);
	});

	it("generates builder mode help", () => {
		const help = generateHelp("builder", mockCommands);
		expect(help.title).toContain("builder");
		expect(help.lines.some((l) => l.includes("BUILDER MODE"))).toBe(true);
		expect(help.lines.some((l) => l.includes("add"))).toBe(true);
	});

	it("generates inspect mode help", () => {
		const help = generateHelp("inspect", mockCommands);
		expect(help.title).toContain("inspect");
		expect(help.lines.some((l) => l.includes("INSPECT MODE"))).toBe(true);
		expect(help.lines.some((l) => l.includes("cpu"))).toBe(true);
	});

	it("includes navigation hints", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.lines.some((l) => l.includes("NAVIGATION"))).toBe(true);
		expect(help.lines.some((l) => l.includes("Tab"))).toBe(true);
	});

	it("includes all passed commands", () => {
		const help = generateHelp("root", mockCommands);
		expect(help.lines.some((l) => l.includes("/help"))).toBe(true);
		expect(help.lines.some((l) => l.includes("/exit"))).toBe(true);
		expect(help.lines.some((l) => l.includes("/builder"))).toBe(true);
	});

	it("generates help for stub modes", () => {
		// DSP, sampler, etc. should show stub help
		const help = generateHelp("dsp", mockCommands);
		expect(help.lines.some((l) => l.includes("DSP MODE"))).toBe(true);
		expect(help.lines.some((l) => l.includes("pending"))).toBe(true);
	});
});
