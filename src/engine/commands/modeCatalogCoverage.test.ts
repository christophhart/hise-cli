import { describe, expect, it } from "vitest";
import { parseCliArgs } from "../../cli/args.js";
import { listCliCommands } from "../../cli/commands.js";
import { createSession, SUPPORTED_MODE_IDS } from "../../session-bootstrap.js";
import { catalogCommands } from "./catalogTypes.js";
import { GENERATED_COMMAND_CATALOG } from "./generatedCatalog.js";

const MODE_HELP_EXEMPTIONS = new Set(["undo"]);

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
	it("covers root TUI commands and validates root CLI recipes", () => {
		const { session } = createSession({ connection: null, enableLlm: false });
		const cliCommands = listCliCommands(session.allCommands());
		const rootModeCommands = catalogCommands(GENERATED_COMMAND_CATALOG)
			.filter((command) => command.mode === "root" && command.surfaces.includes("tui"));
		const documentedTui = new Set(rootModeCommands.flatMap((command) =>
			(command.recipes.tui?.lines ?? []).map((line) => line.trim().replace(/^\//, "").split(/\s+/)[0]!)));
		const missingTui = session.allCommands()
			.filter((command) => command.kind === "command" && (!command.surfaces || command.surfaces.includes("tui")))
			.map((command) => command.name)
			.filter((name) => !documentedTui.has(name));
		const invalidCli = GENERATED_COMMAND_CATALOG.rootCommands
			.filter((command) => command.surfaces.includes("cli") && command.id !== "cli.research-server")
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
			const documentedTuiCommands = new Set(modeCommands
				.filter((command) => command.surfaces.includes("tui"))
				.flatMap((command) => tuiCommands(command.recipes.tui?.lines, modeId)));
			const documentedCliCommands = new Set(modeCommands
				.filter((command) => command.surfaces.includes("cli"))
				.map((command) => firstCliCommand(command.recipes.cli?.argv, modeId))
				.filter((command): command is string => command !== undefined));
			const runtimeTuiCommands = new Set(session.getOrCreateMode(modeId).complete?.("", 0).items
				.map((item) => item.label.split(/\s+/)[0]!)
				.filter((command) => command.length > 0) ?? []);

			for (const command of runtimeTuiCommands) {
				if (!documentedTuiCommands.has(command)) missingTuiCommands.push(`${modeId}: ${command}`);

				const probe = parseCliArgs(["node", "hise-cli", modeId, command], cliCommands);
				const hasCliRecipe = documentedCliCommands.has(command);
				const cliAcceptsCommand = probe.kind === "execute" || hasCliRecipe;
				if (cliAcceptsCommand && !hasCliRecipe) incorrectSurfaces.push(`${modeId}: ${command} parses as CLI but has no CLI recipe`);
				if (!cliAcceptsCommand && documentedCliCommands.has(command)) incorrectSurfaces.push(`${modeId}: ${command} has a CLI recipe but is rejected`);
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
