import { describe, expect, it } from "vitest";
import { GENERATED_COMMAND_CATALOG } from "./generatedCatalog.js";
import { catalogCommands, type CatalogCommand } from "./catalogTypes.js";

function command(id: string): CatalogCommand {
	const entry = catalogCommands(GENERATED_COMMAND_CATALOG).find((item) => item.id === id);
	if (!entry) throw new Error(`Missing catalogue command: ${id}`);
	return entry;
}

describe("generated command catalogue", () => {
	it("uses quoted aliases for modal add commands", () => {
		expect(command("builder.add.module").recipes.tui?.lines).toEqual(["/builder", "add SimpleGain as \"Drive\""]);
		expect(command("ui.add.component").recipes.tui?.lines).toEqual(["/ui", "add ScriptSlider as \"Cutoff\""]);
		expect(command("dsp.add.node").recipes.tui?.lines).toEqual(["/dsp", "cd \"Script FX1\"", "add core.filter as \"F1\""]);
	});

	it("documents the HISE update wizard on both supported surfaces", () => {
		const update = command("wizard.update-hise");
		expect(update.recipes.tui?.lines).toEqual(["/wizard", "run update"]);
		expect(update.recipes.cli?.argv).toEqual(["hise-cli", "-wizard", "run", "update", "--agent"]);
	});
});
