import type { CommandEntry } from "../engine/commands/registry.js";
import { GENERATED_COMMAND_CATALOG } from "../engine/commands/generatedCatalog.js";
import { catalogCommands, type CatalogCommand } from "../engine/commands/catalogTypes.js";
import { getAgentCommand, renderAgentModeHelp } from "./agentContext.js";

/** Render shell help from the same catalogue used by the TUI. */
export function renderCliHelp(_commands: CommandEntry[], scope?: string, commandName?: string): string {
	if (scope) {
		const mode = GENERATED_COMMAND_CATALOG.modes.find((entry) => entry.id === scope);
		if (mode && commandName) return renderModeCommandHelp(scope, commandName);
		if (mode) {
			const generated = renderAgentModeHelp(scope);
			if (generated) return generated;
			return renderCatalogModeHelp(mode.id);
		}
		const rootCommand = findRootCliCommand(scope);
		if (rootCommand) return renderRootCommandHelp(rootCommand);
		return `Unknown help topic: "${scope}". Available: ${GENERATED_COMMAND_CATALOG.modes.map((mode) => mode.id).join(", ")}`;
	}
	return renderGlobalHelp();
}

function renderGlobalHelp(): string {
	const modes = GENERATED_COMMAND_CATALOG.modes
		.filter((mode) => catalogCommands(GENERATED_COMMAND_CATALOG, "cli").some((command) => command.mode === mode.id))
		.map((mode) => `  ${mode.id.padEnd(14)} ${mode.summary}`);
	const rootCommands = GENERATED_COMMAND_CATALOG.rootCommands
		.filter((command) => command.surfaces.includes("cli"))
		.sort((a, b) => a.help.order - b.help.order || a.id.localeCompare(b.id))
		.map((command) => `  ${command.recipes.cli?.display ?? ""}\n    ${command.purpose}${"notes" in command && command.notes?.length ? ` ${command.notes.join(" ")}` : ""}`);
	return [
		"hise-cli — automation frontend for HISE audio plugin framework.",
		"",
		"USAGE",
		"  hise-cli <mode> <command> [flags]",
		"  hise-cli <mode> <command> --help  (command details)",
		"  hise-cli <root-command> --help    (root command details)",
		"  hise-cli -<mode> <command> [flags]  (legacy selector)",
		"  hise-cli                         (launch the interactive TUI)",
		"  hise-cli which \"<intent>\" [--surface cli|tui]",
		"  hise-cli how \"<question>\" [--surface cli|tui] [--mode builder|dsp|ui] --agent",
		"  hise-cli --research-server [--port <number>] [--no-open]",
		"",
		"ROOT COMMANDS",
		...rootCommands,
		"",
		"MODES",
		...modes,
		"", 
		"LOCAL TUI MAINTENANCE",
		"  /nuke scans HISE installations or reviews permanent cleanup, including a sole installation.",
		"  /wizard nuke_scan rescans; /wizard nuke_cleanup uses the recent inventory.",
		"  Keeping an installation is optional (none allows full uninstall). Select IDs, acknowledge backups, type NUKE.",
		"  Back up user data and local commits. Cancellation cannot undo deletions.",
		"  Settings are shared; Windows PATH changes are exact and backed up; Unix edits are manual.",
		"  Audit logs: ~/.hise/cleanup-logs. These are TUI commands, not shell subcommands.",
		"  AI mode: /nukemodelconfig resets model configuration, preserving conversations.",
		"",
		"OUTPUT",
		"  --json emits structured JSON. --agent implies compact JSON with stable error codes.",
		"  { \"ok\": false, \"code\": \"hise_api_error\", \"error\": \"...\" }",
		"  Exit codes: 4 HISE API error; 6 expectation failure.",
		"  --select <path> extracts a value while preserving the result envelope.",
	].join("\n");
}

function renderModeCommandHelp(modeId: string, commandName: string): string {
	const command = getAgentCommand(`${modeId}.${commandName}`)
		?? getAgentCommandByAlias(modeId, commandName);
	if (!command) return `Unknown command help topic: "${modeId} ${commandName}". Run hise-cli ${modeId} --help to list commands.`;
	const lines = [
		`hise-cli ${modeId} ${commandName} — ${command.title}`,
		"",
		command.purpose,
		"",
		"SYNTAX",
		`  ${command.syntax}`,
		...(command.recipes?.cli ? ["", "CLI", `  ${command.recipes.cli.display}`] : []),
		...(command.recipes?.tui ? ["", "TUI", `  ${command.recipes.tui.display}`] : []),
	];
	if (command.examples?.length) {
		lines.push("", "EXAMPLES", ...command.examples.map((example) => `  ${example.display}`));
	}
	if (command.notes?.length) lines.push("", "NOTES", ...command.notes.map((note) => `  - ${note}`));
	if (command.aliases.length) lines.push("", `ALIASES\n  ${command.aliases.join(", ")}`);
	lines.push("", "MACHINE-READABLE DETAILS", `  hise-cli agent-context --command ${command.id} --agent`);
	return lines.join("\n");
}

function getAgentCommandByAlias(modeId: string, commandName: string) {
	const mode = GENERATED_COMMAND_CATALOG.modes.find((entry) => entry.id === modeId);
	const id = mode?.commands.find((entry) => entry.aliases.some((alias) => alias === commandName))?.id;
	return id ? getAgentCommand(id) : undefined;
}

function findRootCliCommand(name: string): CatalogCommand | undefined {
	return (GENERATED_COMMAND_CATALOG.rootCommands as readonly CatalogCommand[]).find((command) => {
		const token = command.recipes.cli?.argv?.[1];
		return token === name || token?.replace(/^-{1,2}/, "") === name;
	});
}

function renderRootCommandHelp(command: CatalogCommand): string {
	const lines = [`${command.recipes.cli?.display ?? command.id}`, "", command.purpose];
	if (command.examples?.length) lines.push("", "EXAMPLES", ...command.examples.map((example) => `  ${example.display}`));
	if (command.notes?.length) lines.push("", "NOTES", ...command.notes.map((note) => `  - ${note}`));
	return lines.join("\n");
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
