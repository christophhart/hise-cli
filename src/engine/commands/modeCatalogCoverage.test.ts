import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../cli/args.js";
import { listCliCommands } from "../../cli/commands.js";
import { createSession, SUPPORTED_MODE_IDS } from "../../session-bootstrap.js";
import { catalogCommands } from "./catalogTypes.js";
import { GENERATED_COMMAND_CATALOG } from "./generatedCatalog.js";

function tuiCommands(lines: readonly string[] | undefined, modeId: string): string[] {
	if (!lines) return [];
	return lines.flatMap((line) => {
		const tokens = line.trim().replace(/^\//, "").split(/\s+/);
		if (tokens[0] === modeId) tokens.shift();
		return tokens.length > 0 && !/^\d+ms$/.test(tokens[0]!) ? [tokens[0]!] : [];
	});
}


describe("mode command catalogue coverage", () => {
	it("covers project mode TUI commands and validates every project CLI recipe", () => {
		const { session } = createSession({ connection: null, enableLlm: false });
		const cliCommands = listCliCommands(session.allCommands());
		const projectEntries = catalogCommands(GENERATED_COMMAND_CATALOG).filter((command) => command.mode === "project");
		const runtimeCommands = new Set(session.getOrCreateMode("project").complete?.("", 0).items.map((item) => item.label.split(/\\s+/)[0]!) ?? []);
		const missingTui = [...runtimeCommands].filter((name) => !projectEntries.some((entry) =>
			entry.surfaces.includes("tui") && tuiCommands(entry.recipes.tui?.lines, "project").includes(name),
		));
		const invalidCli = projectEntries
			.filter((entry) => entry.surfaces.includes("cli"))
			.flatMap((entry) => {
				const argv = entry.recipes.cli?.argv;
				if (!argv) return [entry.id];
				const parsed = parseCliArgs(["node", "hise-cli", ...argv.slice(1)], cliCommands);
				return parsed.kind === "error" ? [`${entry.id}: ${parsed.message}`] : [];
			});
		expect({ missingTui, invalidCli }).toEqual({ missingTui: [], invalidCli: [] });
	});

	it("covers root TUI commands and validates root CLI recipes", () => {
		const { session } = createSession({ connection: null, enableLlm: false });
		const cliCommands = listCliCommands(session.allCommands());
		const rootModeCommands = catalogCommands(GENERATED_COMMAND_CATALOG)
			.filter((command) => command.mode === "root" && command.surfaces.includes("tui"));
		const documentedTui = new Set(rootModeCommands.flatMap((command) => [
			...(command.recipes.tui?.lines ?? []).map((line) => line.trim().replace(/^\//, "").split(/\s+/)[0]!),
			...command.aliases,
		]));
		const missingTui = session.allCommands()
			.filter((command) => command.kind === "command" && (!command.surfaces || command.surfaces.includes("tui")))
			.map((command) => command.name)
			.filter((name) => !documentedTui.has(name));
		const invalidCli = GENERATED_COMMAND_CATALOG.rootCommands
			.filter((command) => command.surfaces.includes("cli") && !["cli.research-server", "cli.ai", "cli.research", "cli.lsp", "cli.dap"].includes(command.id))
			.flatMap((command) => {
				const argv = command.recipes.cli?.argv;
				if (!argv) return [command.id];
				const result = parseCliArgs(["node", "hise-cli", ...argv.slice(1)], cliCommands);
				return result.kind === "error" ? [`${command.id}: ${result.message}`] : [];
			});

		expect({ missingTui, invalidCli }).toEqual({ missingTui: [], invalidCli: [] });
	});
	it("validates recipes and declared surfaces across supported modes", () => {
		const { session } = createSession({ connection: null, enableLlm: false });
		const cliCommands = listCliCommands(session.allCommands());
		const catalogModes = new Map(GENERATED_COMMAND_CATALOG.modes.map((mode) => [mode.id, mode]));
		const errors: string[] = [];

		for (const modeId of SUPPORTED_MODE_IDS) {
			if (!catalogModes.has(modeId)) {
				errors.push(`${modeId}: no mode catalogue`);
				continue;
			}
			const commands = catalogCommands(GENERATED_COMMAND_CATALOG).filter((command) => command.mode === modeId);
			for (const command of commands) {
				if (command.surfaces.includes("tui") && !command.recipes.tui?.lines?.length) {
					errors.push(`${command.id}: missing TUI recipe`);
				}
				if (!command.surfaces.includes("cli")) continue;
				const argv = command.recipes.cli?.argv;
				if (!argv) {
					errors.push(`${command.id}: missing CLI recipe`);
					continue;
				}
				const parsed = parseCliArgs(["node", "hise-cli", ...argv.slice(1)], cliCommands);
				if (parsed.kind === "error") errors.push(`${command.id}: ${parsed.message}`);
			}
		}

		expect(errors).toEqual([]);
	});
});
