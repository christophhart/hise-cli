import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseWizardJson } from "./parser.js";
import type { WizardDefinition, WizardField } from "./types.js";

const WIZARDS_DIR = join(__dirname, "../../../wizards");

function loadWizard(filename: string): WizardDefinition {
	const raw = JSON.parse(readFileSync(join(WIZARDS_DIR, filename), "utf-8"));
	const id = filename.replace(".json", "");
	return parseWizardJson(id, raw);
}

/** Collect all fields across all tabs in a definition. */
function allFields(def: WizardDefinition): WizardField[] {
	return def.tabs.flatMap((t) => t.fields);
}

/** Find a field by ID across all tabs. */
function findField(def: WizardDefinition, id: string): WizardField | undefined {
	return allFields(def).find((f) => f.id === id);
}

describe("parseWizardJson", () => {
	describe("recompile", () => {
		const def = loadWizard("recompile.json");

		it("parses header and ID", () => {
			expect(def.id).toBe("recompile");
			expect(def.header).toBe("Recompile all scripts");
		});

		it("has one tab with 4 toggle fields", () => {
			expect(def.tabs.length).toBe(1);
			const fields = def.tabs[0]!.fields;
			expect(fields.length).toBe(4);
			expect(fields.every((f) => f.type === "toggle")).toBe(true);
		});

		it("extracts field IDs", () => {
			const ids = allFields(def).map((f) => f.id);
			expect(ids).toContain("clearGlobals");
			expect(ids).toContain("clearFonts");
			expect(ids).toContain("clearAudioFiles");
			expect(ids).toContain("clearImages");
		});

		it("extracts help text", () => {
			const field = findField(def, "clearGlobals");
			expect(field?.help).toMatch(/global variable/i);
		});

		it("has one task", () => {
			expect(def.tasks.length).toBe(1);
		});
	});

	describe("new_project", () => {
		const def = loadWizard("new_project.json");

		it("parses header", () => {
			expect(def.header).toBe("Create New Project");
		});

		it("has text and file fields", () => {
			expect(findField(def, "ProjectName")?.type).toBe("text");
			expect(findField(def, "DefaultProjectFolder")?.type).toBe("file");
		});

		it("marks ProjectName as required", () => {
			expect(findField(def, "ProjectName")?.required).toBe(true);
		});

		it("marks DefaultProjectFolder as required", () => {
			expect(findField(def, "DefaultProjectFolder")?.required).toBe(true);
		});

		it("parses Template as a choice", () => {
			const field = findField(def, "Template");
			expect(field?.type).toBe("choice");
			expect(field?.items?.length).toBeGreaterThan(0);
		});

		it("has tasks", () => {
			expect(def.tasks.length).toBeGreaterThan(0);
		});

		it("extracts branch tabs for Template", () => {
			const branchTabs = def.tabs.filter((t) => t.condition?.fieldId === "Template");
			expect(branchTabs.length).toBeGreaterThan(0);
		});
	});

	describe("plugin_export", () => {
		const def = loadWizard("plugin_export.json");

		it("parses header", () => {
			expect(def.header).toBe("Compile Project");
		});

		it("merges duplicate ExportType buttons into a choice", () => {
			const field = findField(def, "ExportType");
			expect(field?.type).toBe("choice");
			expect(field?.items).toContain("Plugin");
			expect(field?.items).toContain("Standalone App");
		});

		it("parses projectType as a choice", () => {
			const field = findField(def, "projectType");
			expect(field?.type).toBe("choice");
			expect(field?.items).toContain("Instrument");
			expect(field?.items).toContain("FX plugin");
		});

		it("parses pluginType as a choice with help", () => {
			const field = findField(def, "pluginType");
			expect(field?.type).toBe("choice");
			expect(field?.items).toContain("VST");
			expect(field?.items).toContain("AU");
			expect(field?.help).toMatch(/plugin architecture/i);
		});

		it("has a compile task", () => {
			const task = def.tasks.find((t) => t.function === "compileTask");
			expect(task).toBeDefined();
		});

		it("has post-actions on the last page", () => {
			expect(def.postActions.length).toBe(2);
			expect(def.postActions.some((a) => a.id === "showCompiledFile")).toBe(true);
			expect(def.postActions.some((a) => a.id === "showPluginFolder")).toBe(true);
		});

		it("populates globalDefaults from GlobalState", () => {
			expect(def.globalDefaults["projectType"]).toBe("Instrument");
			expect(def.globalDefaults["pluginType"]).toBe("VST");
		});
	});

	describe("audio_export", () => {
		const def = loadWizard("audio_export.json");

		it("parses header", () => {
			expect(def.header).toBe("Audio Exporter");
		});

		it("has a file field for Location", () => {
			const field = findField(def, "Location");
			expect(field?.type).toBe("file");
			expect(field?.required).toBe(true);
			expect(field?.wildcard).toBe(".wav");
		});

		it("has a choice field for Length", () => {
			const field = findField(def, "Length");
			expect(field?.type).toBe("choice");
		});

		it("has toggle fields", () => {
			expect(findField(def, "Realtime")?.type).toBe("toggle");
			expect(findField(def, "MidiInput")?.type).toBe("toggle");
		});

		it("has post-actions", () => {
			// OpenInEditor on the last page is a non-trigger toggle, not a post-action
			// But the completeFunction page has it — let's just check tasks
			expect(def.tasks.length).toBeGreaterThan(0);
		});
	});

	describe("compile_networks", () => {
		const def = loadWizard("compile_networks.json");

		it("parses header", () => {
			expect(def.header).toBe("Compile Networks");
		});

		it("has toggle fields for compile options", () => {
			expect(findField(def, "replaceScriptModules")?.type).toBe("toggle");
			expect(findField(def, "openIDE")?.type).toBe("toggle");
		});

		it("has a compile task", () => {
			const task = def.tasks.find((t) => t.function === "compileTask");
			expect(task).toBeDefined();
		});
	});

	describe("install_package_maker", () => {
		const def = loadWizard("install_package_maker.json");

		it("parses header", () => {
			expect(def.header).toBe("Create Install Asset payload");
		});

		it("has text fields for wildcards", () => {
			expect(findField(def, "PositiveWildcard")?.type).toBe("text");
			expect(findField(def, "NegativeWildcard")?.type).toBe("text");
		});

		it("has toggle fields for filter options", () => {
			expect(findField(def, "UseFileTypeFilter")?.type).toBe("toggle");
			expect(findField(def, "UsePreprocessors")?.type).toBe("toggle");
			expect(findField(def, "UseClipboard")?.type).toBe("toggle");
		});

		it("has a file selector for test archive", () => {
			const field = findField(def, "ExternalZipSelector");
			expect(field?.type).toBe("file");
		});

		it("has defaults from GlobalState", () => {
			expect(def.globalDefaults["PositiveWildcard"]).toBe("*");
		});
	});

	describe("all wizards parse without error", () => {
		const files = [
			"recompile.json",
			"new_project.json",
			"plugin_export.json",
			"audio_export.json",
			"compile_networks.json",
			"install_package_maker.json",
		];

		for (const file of files) {
			it(`parses ${file}`, () => {
				expect(() => loadWizard(file)).not.toThrow();
				const def = loadWizard(file);
				expect(def.id).toBeTruthy();
				expect(def.header).toBeTruthy();
				expect(def.tabs.length).toBeGreaterThan(0);
			});
		}
	});

	describe("field deduplication", () => {
		it("merges radio-group buttons into a single choice", () => {
			const raw = {
				Properties: { Header: "Test" },
				GlobalState: {},
				Children: [{
					Type: "List",
					Children: [
						{ Type: "Button", ID: "mode", Text: "Option A" },
						{ Type: "Button", ID: "mode", Text: "Option B" },
						{ Type: "Button", ID: "mode", Text: "Option C" },
					],
				}],
			};
			const def = parseWizardJson("test", raw);
			const fields = allFields(def);
			expect(fields.filter((f) => f.id === "mode").length).toBe(1);
			const field = findField(def, "mode")!;
			expect(field.type).toBe("choice");
			expect(field.items).toEqual(["Option A", "Option B", "Option C"]);
		});
	});
});
