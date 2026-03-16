// ── Help content — mode-specific help text ──────────────────────────

// Generates structured help content for the /help overlay.
// Content varies based on the current mode.

import type { ModeId } from "../modes/mode.js";
import type { CommandEntry } from "./registry.js";

// ── Help content generation ─────────────────────────────────────────

export interface HelpContent {
	title: string;
	lines: string[];
	footer: string;
}

/** Generate help content for the current mode and available commands. */
export function generateHelp(
	modeId: ModeId,
	commands: CommandEntry[],
): HelpContent {
	const sections: string[] = [];

	// Mode-specific header
	const modeHelp = MODE_HELP[modeId];
	if (modeHelp) {
		sections.push(...modeHelp);
		sections.push("");
	}

	// Slash commands section
	sections.push("COMMANDS");
	sections.push("");
	for (const cmd of commands) {
		const name = `/${cmd.name}`;
		const pad = " ".repeat(Math.max(1, 14 - name.length));
		sections.push(`  ${name}${pad}${cmd.description}`);
	}
	sections.push("");

	// Navigation hints
	sections.push("NAVIGATION");
	sections.push("");
	sections.push("  Tab           Complete command or argument");
	sections.push("  Up/Down       Command history");
	sections.push("  PgUp/PgDn     Scroll output");
	sections.push("  Shift+Up/Dn   Scroll one line");

	return {
		title: `Help — ${modeId === "root" ? "HISE CLI" : modeId}`,
		lines: sections,
		footer: "\u2191\u2193 scroll  Esc close",
	};
}

// ── Per-mode help text ──────────────────────────────────────────────

const MODE_HELP: Partial<Record<ModeId, string[]>> = {
	root: [
		"HISE CLI",
		"",
		"  Interactive shell for HISE audio plugin framework.",
		"  Enter a mode to start working:",
		"",
		"  /script       HiseScript REPL",
		"  /builder      Module tree editor",
		"  /inspect      Runtime monitor",
		"  /dsp          Scriptnode DSP graph",
		"  /sampler      Sample map editor",
	],
	script: [
		"SCRIPT MODE",
		"",
		"  HiseScript REPL — evaluate expressions live.",
		"  Type any HiseScript expression to evaluate it.",
		"",
		"  Examples:",
		"    Engine.getSampleRate()",
		"    Synth.addNoteOn(1, 64, 127, 0)",
		"    Console.print(\"hello\")",
		"",
		"  Use Tab to complete API namespaces and methods.",
		"  Type Namespace. to see available methods.",
	],
	builder: [
		"BUILDER MODE",
		"",
		"  Module tree editor — add, configure, inspect modules.",
		"",
		"  Commands:",
		"    add <type> [as \"name\"] [to parent.chain]",
		"    set <target> <param> [to] <value>",
		"    show tree | show types",
		"",
		"  Use Tab to complete module types and parameters.",
	],
	inspect: [
		"INSPECT MODE",
		"",
		"  Runtime monitor — view CPU, voices, memory, modules.",
		"",
		"  Commands:",
		"    cpu          CPU usage and buffer info",
		"    voices       Active voice count",
		"    modules      Module tree",
		"    memory       Memory usage",
	],
	dsp: [
		"DSP MODE",
		"",
		"  Scriptnode DSP graph editor.",
		"  (Implementation pending — Phase 4)",
	],
	sampler: [
		"SAMPLER MODE",
		"",
		"  Sample map editor.",
		"  (Implementation pending — Phase 4)",
	],
	project: [
		"PROJECT MODE",
		"",
		"  Project settings and configuration.",
		"  (Implementation pending — Phase 4)",
	],
	compile: [
		"COMPILE MODE",
		"",
		"  Build targets and export settings.",
		"  (Implementation pending — Phase 4)",
	],
	import: [
		"IMPORT MODE",
		"",
		"  Asset import workflows.",
		"  (Implementation pending — Phase 4)",
	],
};
