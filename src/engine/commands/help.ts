// ── Help content — mode-specific help text ──────────────────────────

// Generates structured help content for the /help command.
// Content varies based on the current mode.

import type { ModeId } from "../modes/mode.js";
import type { CommandEntry } from "./registry.js";
import { GENERATED_COMMAND_CATALOG } from "./generatedCatalog.js";
import { catalogCommands } from "./catalogTypes.js";

// ── Help content generation ─────────────────────────────────────────

export interface HelpContent {
	title: string;
	content: string;  // markdown formatted
}

/** Render authoritative modal syntax from the shared command catalogue. */
export function generateCatalogHelp(modeId: string): HelpContent | null {
	const mode = GENERATED_COMMAND_CATALOG.modes.find((entry) => entry.id === modeId);
	if (!mode) return null;
	const commands = catalogCommands(GENERATED_COMMAND_CATALOG, "tui")
		.filter((command) => command.mode === modeId && command.help.visibility !== "hidden")
		.sort((a, b) => a.help.order - b.help.order || a.id.localeCompare(b.id));
	const heading = modeId === "ui" ? "UI Mode" : mode.title;
	const sections = [`# ${heading}`, "", mode.summary, "", ...(mode.vocabulary ? ["## Available types", "", "```text", mode.vocabulary, "```", ""] : []), ...(modeId === "ui" ? ["## Syntax", "", "`set <target>.<prop> <value>`", ""] : []), "## Commands", "", "| Command | Description |", "|---------|-------------|"];
	for (const command of commands) {
		const recipe = command.recipes.tui;
		if (recipe) sections.push(`| \`${recipe.display.replaceAll("\n", " → ")}\` | ${command.purpose} |`);
	}
	if (mode.notes.length > 0) {
		sections.push("", "## Notes", "", ...mode.notes.map((note) => `- ${note}`));
	}
	return { title: `Help — ${modeId}`, content: sections.join("\n") };
}

/** Help shown while the persistent embedded Pi agent is active in the TUI. */
export function generateAiHelp(): HelpContent {
	return {
		title: "Embedded HISE Agent",
		content: `## Embedded HISE Agent

The \`/ai\` mode is a persistent Pi-powered development assistant focused on using hise-cli's structured tool calls. It can inspect HISE state, explain errors, make focused changes, and verify the result.

### Examples

- \`inspect the current builder tree\`
- \`add a ScriptSlider under Content and verify it\`
- \`show Interface.onInit, then add a Console.print callback\`
- \`explain why this DSP connection fails\`

The agent uses canonical hise-cli arguments and stdin for callback source. TUI mutations execute optimistically and remain undoable with \`/undo\`. Press **Escape** or use \`/stop\` to cancel an active run.

### AI commands

| Command | Description |
| --- | --- |
| \`/clear\` | Start a fresh AI conversation |
| \`/login\` | Authenticate a provider or add a custom provider with a wizard |
| \`/model\` | Open the model and reasoning-level selector |
| \`/nuke\` | Remove embedded AI credentials, custom models, model defaults, and model cache |
| \`/sessions [id]\` | List or resume a saved project session |
| \`/research <query>\` | Research HISE documentation and validated examples |
| \`/stop\` | Stop the active generation |
| \`/exit\` | Leave AI mode |

HISE slash commands such as \`/builder\`, \`/dsp\`, and \`/quit\` leave AI mode and retain their normal meaning.`,
	};
}

/** Generate help content for the current mode and available commands. */
export function generateHelp(
	modeId: ModeId,
	commands: CommandEntry[],
): HelpContent {
	if (modeId !== "root") {
		const catalogHelp = generateCatalogHelp(modeId);
		if (catalogHelp) return catalogHelp;
	}

	const sections: string[] = [];

	// Root navigation and registry commands are runtime data, not catalogue entries.
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

