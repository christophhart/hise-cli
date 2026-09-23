import type { CommandEntry } from "../engine/commands/registry.js";
import { GENERATED_COMMAND_CATALOG } from "../engine/commands/generatedCatalog.js";
import { catalogCommands } from "../engine/commands/catalogTypes.js";
import { renderAgentModeHelp } from "./agentContext.js";

/** Render shell help from the same catalogue used by the TUI. */
export function renderCliHelp(_commands: CommandEntry[], scope?: string): string {
	if (scope) {
		const generated = renderAgentModeHelp(scope);
		if (generated) return generated;
		const mode = GENERATED_COMMAND_CATALOG.modes.find((entry) => entry.id === scope);
		if (mode) return renderCatalogModeHelp(mode.id);
		return `Unknown help topic: "${scope}". Available: ${GENERATED_COMMAND_CATALOG.modes.map((mode) => mode.id).join(", ")}`;
	}
	return renderGlobalHelp();
}

function renderGlobalHelp(): string {
	const modes = GENERATED_COMMAND_CATALOG.modes
		.filter((mode) => catalogCommands(GENERATED_COMMAND_CATALOG, "cli").some((command) => command.mode === mode.id))
		.map((mode) => `  ${mode.id.padEnd(14)} ${mode.summary}`);
	return [
		"hise-cli — automation frontend for HISE audio plugin framework.",
		"",
		"USAGE",
		"  hise-cli <mode> <command> [flags]",
		"  hise-cli which \"<intent>\" [--surface cli|tui]",
		"  hise-cli how \"<question>\" [--surface cli|tui] [--mode builder|dsp|ui] --agent",
		"  hise-cli --research-server [--port <number>] [--no-open]",
		"",
		"MODES",
		...modes,
		"",
		"OUTPUT",
		"  --json emits structured JSON. --agent implies compact JSON with stable error codes.",
		"  { \"ok\": false, \"code\": \"hise_api_error\", \"error\": \"...\" }",
		"  Exit codes: 4 HISE API error; 6 expectation failure.",
		"  --select <path> extracts a value while preserving the result envelope.",
	].join("\n");
}

function renderCatalogModeHelp(modeId: string): string {
	const mode = GENERATED_COMMAND_CATALOG.modes.find((entry) => entry.id === modeId);
	if (!mode) return "";
	const commands = catalogCommands(GENERATED_COMMAND_CATALOG, "cli")
		.filter((command) => command.mode === modeId && command.help.visibility !== "hidden")
		.sort((a, b) => a.help.order - b.help.order || a.id.localeCompare(b.id));
	return [
		`hise-cli ${mode.id} — ${mode.title}`,
		"",
		mode.summary,
		"",
		"COMMANDS",
		...commands.map((command) => `  ${command.recipes.cli?.display ?? ""}\n    ${command.purpose}`),
		...(mode.notes.length > 0 ? ["", "NOTES", ...mode.notes.map((note) => `  - ${note}`)] : []),
	].join("\n");
}
