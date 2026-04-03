// ── Node.js DataLoader — reads JSON datasets from disk ──────────────

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
	DataLoader,
	ModuleList,
	ScriptingApi,
	ScriptnodeList,
} from "../engine/data.js";
import type { WizardDefinition } from "../engine/wizard/types.js";

/**
 * Create a DataLoader that reads the static JSON datasets from a
 * directory on disk. Used by the TUI frontend; the engine layer
 * stays isomorphic (no node: imports).
 */
export function createNodeDataLoader(dataDir: string): DataLoader {
	return {
		async loadModuleList(): Promise<ModuleList> {
			const raw = fs.readFileSync(
				path.join(dataDir, "moduleList.json"),
				"utf8",
			);
			return JSON.parse(raw) as ModuleList;
		},
		async loadScriptingApi(): Promise<ScriptingApi> {
			const raw = fs.readFileSync(
				path.join(dataDir, "scripting_api.json"),
				"utf8",
			);
			return JSON.parse(raw) as ScriptingApi;
		},
		async loadScriptnodeList(): Promise<ScriptnodeList> {
			const raw = fs.readFileSync(
				path.join(dataDir, "scriptnodeList.json"),
				"utf8",
			);
			return JSON.parse(raw) as ScriptnodeList;
		},
		async loadWizardDefinitions(): Promise<WizardDefinition[]> {
			const wizardDir = path.join(dataDir, "wizards");
			if (!fs.existsSync(wizardDir)) return [];
			const files = fs.readdirSync(wizardDir).filter(
				(f) => f.endsWith(".yaml"),
			);
			return files.map((f) => {
				const content = fs.readFileSync(path.join(wizardDir, f), "utf8");
				return parseYaml(content) as WizardDefinition;
			});
		},
	};
}
