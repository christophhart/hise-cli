// ── Help content — mode-specific help text ──────────────────────────

// Generates structured help content for the /help command.
// Content varies based on the current mode.

import type { ModeId } from "../modes/mode.js";
import type { CommandEntry } from "./registry.js";

// ── Help content generation ─────────────────────────────────────────

export interface HelpContent {
	title: string;
	content: string;  // markdown formatted
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
		sections.push(modeHelp);
		sections.push("");
	}

	if(modeId == "root")
	{
		// Slash commands section
		sections.push("## Commands");
		sections.push("");
		sections.push("| Command | Description |");
		sections.push("|---------|-------------|");
		for (const cmd of commands) {
			const name = `**/${cmd.name}**`;
			sections.push(`| ${name} | ${cmd.description} |`);
		}
		sections.push("");

		// Navigation hints
		sections.push("## Navigation");
		sections.push("");
		sections.push("- **Tab**: ....... Complete command or argument");
		sections.push("- **Ctrl+B**: .... Show / hide tree sidebar");
		sections.push("- **Escape**: .... Open / close the autocomplete list");
		sections.push("- **Up/Down**: ... Command history");
		sections.push("- **PgUp/PgDn**: . Scroll output");
		sections.push("- **Shift+Up/Dn**: Scroll one line");
	}

	return {
		title: `Help — ${modeId === "root" ? "HISE CLI" : modeId}`,
		content: sections.join("\n"),
	};
}

// ── Per-mode help text (markdown format) ───────────────────────────

const MODE_HELP: Partial<Record<ModeId, string>> = {
	root: `# HISE CLI

Interactive shell for the HISE audio plugin framework.
Enter a mode to start working, or use /wizard for guided workflows.

- **/builder** — Module tree editor (add, remove, configure modules)
- **/script** — HiseScript REPL (evaluate expressions live)
- **/inspect** — Runtime monitor (version, project info)
- **/undo** — Undo history and plan groups
- **/wizard** — Guided workflows (setup, export, project creation)
- **/setup** — Install and build HISE from source (wizard alias)

One-shot syntax: \`/builder add SimpleGain\` executes without entering the mode.
Dot-context: \`/builder.Master add LFO\` sets the context path first.`,

	script: `# Script Mode

HiseScript REPL — evaluate expressions live against the running HISE instance.

## Usage

Type any HiseScript expression to evaluate it. Results show the return value,
type, and any console output.

\`\`\`hisescript
Engine.getSampleRate()
Synth.addNoteOn(1, 64, 127, 0)
Console.print("hello")
Content.getComponent("Knob1").getValue()
\`\`\`

## Completion

**Tab** completes API namespaces and methods. Type \`Namespace.\` to browse:

- \`Engine.\` — global engine functions (sample rate, latency, etc.)
- \`Synth.\` — sound generator control (note on/off, modulators)
- \`Console.\` — debug output
- \`Content.\` — UI component access
- \`Math.\`, \`Array.\`, \`String.\` — utility classes`,

	builder: `# Builder Mode

Module tree editor — add, configure, and inspect the HISE module tree.

## Commands

| Command | Description |
|---------|-------------|
| \`add <type> [as "<name>"] [to <parent>[.<chain>]]\` | Add a module |
| \`remove <target>\` | Remove a module |
| \`clone <target> [x<count>]\` | Duplicate a module |
| \`rename <target> to "<name>"\` | Rename a module |
| \`set <target>.<param> [to] <value>\` | Set a parameter value |
| \`bypass <target>\` / \`enable <target>\` | Toggle bypass state |
| \`load "<source>" into <target>\` | Load data into a module |
| \`show tree\` | Display the full module tree |
| \`show types [<filter>]\` | List available module types |
| \`show <target>\` | Show a module's parameters |
| \`reset\` | Wipe module tree and clear undo history |
| \`cd <path>\` / \`ls\` / \`pwd\` | Navigate the module tree |

## Features

- **Comma chaining**: \`add LFO to Master, set LFO.Frequency to 2.0\`
- **Chain auto-resolution**: SoundGenerators→children, Effects→fx, Midi→midi
- **Tab completion**: module types, instance IDs, parameter names
- **Tree sidebar**: Ctrl+B to toggle visual module tree`,

	inspect: `# Inspect Mode

Runtime monitor — query the live HISE status payload.

## Commands

| Command | Description |
|---------|-------------|
| \`version\` | HISE server version and compile timeout |
| \`project\` | Current project paths and script processors |
| \`help\` | Show available commands |`,

	undo: `# Undo Mode

Undo history and plan groups — batch and revert module tree changes.

## Commands

| Command | Description |
|---------|-------------|
| \`back\` | Undo the last action |
| \`forward\` | Redo the last undone action |
| \`clear\` | Clear the undo history |
| \`plan "<name>"\` | Start a named plan group (batches operations) |
| \`apply\` | Apply the current plan group |
| \`discard\` | Discard the current plan group |
| \`diff\` | Show diff of the current plan group |
| \`history\` | Show the full undo history |

## Plan Groups

Plan groups batch multiple builder operations into a single undoable unit.
Start a plan with \`plan "My Changes"\`, execute builder commands, then
\`apply\` to commit or \`discard\` to revert all at once.`,

	dsp: `# DSP Mode

Scriptnode DSP graph editor.

*(Not yet implemented — Phase 6)*`,

	sampler: `# Sampler Mode

Sample map editor.

*(Not yet implemented — Phase 6)*`,

	project: `# Project Mode

Project settings and configuration.

*(Not yet implemented — Phase 6)*`,

	compile: `# Compile Mode

Build targets and export settings.

*(Not yet implemented — Phase 6)*`,
};
