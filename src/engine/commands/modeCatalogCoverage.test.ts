import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../cli/args.js";
import { listCliCommands } from "../../cli/commands.js";
import { createSession, SUPPORTED_MODE_IDS } from "../../session-bootstrap.js";
import { catalogCommands } from "./catalogTypes.js";
import { GENERATED_COMMAND_CATALOG } from "./generatedCatalog.js";

const MODE_HELP_EXEMPTIONS = new Set(["undo"]);
const TUI_ONLY_NAVIGATION_COMMANDS = new Set(["cd", "pwd", "ls"]);

function firstCliCommand(argv: readonly string[] | undefined, modeId: string): string | undefined {
	if (!argv) return undefined;
	const modeIndex = argv.findIndex((arg) => arg === modeId || arg === `-${modeId}` || arg === `--${modeId}`);
	if (modeIndex < 0) return undefined;
	const command = argv[modeIndex + 1];
	return command && !command.startsWith("-") ? command : undefined;
}

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
	it("covers TUI completions and validates CLI recipes for every supported mode", () => {
		const { session } = createSession({ connection: null, enableLlm: false });
		const cliCommands = listCliCommands(session.allCommands());
		const catalogModes = new Map(GENERATED_COMMAND_CATALOG.modes.map((mode) => [mode.id, mode]));
		const missingTuiCommands: string[] = [];
		const invalidCliRecipes: string[] = [];
		const incorrectSurfaces: string[] = [];

		for (const modeId of SUPPORTED_MODE_IDS) {
			if (MODE_HELP_EXEMPTIONS.has(modeId)) continue;

			if (!catalogModes.has(modeId)) {
				missingTuiCommands.push(`${modeId}: no mode catalogue`);
				continue;
			}

			const modeCommands = catalogCommands(GENERATED_COMMAND_CATALOG)
				.filter((command) => command.mode === modeId);
			const runtimeTuiCommands = new Set(session.getOrCreateMode(modeId).complete?.("", 0).items
				.map((item) => item.label.split(/\s+/)[0]!)
				.filter((command) => command.length > 0) ?? []);

			for (const command of runtimeTuiCommands) {
				const entries = modeCommands.filter((entry) =>
					tuiCommands(entry.recipes.tui?.lines, modeId).includes(command)
						|| firstCliCommand(entry.recipes.cli?.argv, modeId) === command);
				if (entries.length === 0) missingTuiCommands.push(`${modeId}: ${command}`);

				const cliProbe = parseCliArgs(["node", "hise-cli", modeId, command], cliCommands);
				const hasCliRecipe = entries.some((entry) => entry.surfaces.includes("cli") && entry.recipes.cli);
				const hasTuiRecipe = entries.some((entry) => entry.surfaces.includes("tui") && entry.recipes.tui);
				if (TUI_ONLY_NAVIGATION_COMMANDS.has(command)) {
					if (hasCliRecipe) incorrectSurfaces.push(`${modeId}: ${command} is TUI-only navigation but has a CLI recipe`);
				} else if (cliProbe.kind === "execute" && !hasCliRecipe) {
					incorrectSurfaces.push(`${modeId}: ${command} is accepted by CLI parsing but lacks a CLI recipe`);
				}
				if (!hasTuiRecipe) incorrectSurfaces.push(`${modeId}: ${command} is offered by TUI completion but lacks a TUI recipe`);
			}

			for (const command of modeCommands.filter((item) => item.surfaces.includes("cli"))) {
				const argv = command.recipes.cli?.argv;
				if (!argv) {
					invalidCliRecipes.push(`${modeId}: ${command.id} has no argv recipe`);
					continue;
				}
				const parsed = parseCliArgs(["node", "hise-cli", ...argv.slice(1)], cliCommands);
				if (parsed.kind === "error") invalidCliRecipes.push(`${modeId}: ${command.id} (${parsed.message})`);
			}
		}

		expect({ missingTuiCommands, invalidCliRecipes, incorrectSurfaces }).toEqual({
			missingTuiCommands: [],
			invalidCliRecipes: [],
			incorrectSurfaces: [],
		});
	});
});
