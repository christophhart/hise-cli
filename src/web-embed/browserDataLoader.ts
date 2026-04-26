// ── Browser DataLoader — fetches JSON datasets over HTTP ────────────
//
// Mirror of src/tui/nodeDataLoader.ts using fetch instead of fs.
// Used by the embedded web build that ships hise-cli into a docs site.
// The engine layer stays isomorphic — this implementation lives outside it.

import type {
	DataLoader,
	ModuleList,
	ScriptingApi,
	ScriptnodeList,
} from "../engine/data.js";
import type { WizardDefinition } from "../engine/wizard/types.js";
import type { ComponentPropertyMap } from "../engine/modes/ui.js";

export interface BrowserDataLoaderOptions {
	/** Base URL where dataset JSON files are served. Trailing slash optional. */
	baseUrl: string;
	/** Optional fetch override (for testing). Defaults to the global fetch. */
	fetcher?: typeof fetch;
}

/**
 * Create a DataLoader that fetches static dataset JSONs over HTTP.
 *
 * Expected layout at baseUrl:
 *   baseUrl/moduleList.json
 *   baseUrl/scriptnodeList.json
 *   baseUrl/ui_component_properties.json
 *
 * `loadScriptingApi` and `loadWizardDefinitions` always return empty —
 * the embed bundle does not ship the scripting API (2.2 MB, only used
 * for HiseScript completion) and registers no internal wizard handlers.
 */
export function createBrowserDataLoader(
	options: BrowserDataLoaderOptions,
): DataLoader {
	const base = options.baseUrl.endsWith("/")
		? options.baseUrl
		: options.baseUrl + "/";
	const fetcher = options.fetcher ?? fetch;

	async function loadJson<T>(filename: string): Promise<T> {
		const response = await fetcher(base + filename);
		if (!response.ok) {
			throw new Error(`${filename}: ${response.status} ${response.statusText}`);
		}
		return (await response.json()) as T;
	}

	return {
		loadModuleList: () => loadJson<ModuleList>("moduleList.json"),
		loadScriptnodeList: () => loadJson<ScriptnodeList>("scriptnodeList.json"),
		async loadComponentProperties(): Promise<ComponentPropertyMap> {
			try {
				return await loadJson<ComponentPropertyMap>(
					"ui_component_properties.json",
				);
			} catch {
				return {};
			}
		},
		async loadScriptingApi(): Promise<ScriptingApi> {
			throw new Error(
				"scripting_api.json is not bundled in the web embed — only needed for HiseScript completion",
			);
		},
		async loadWizardDefinitions(): Promise<WizardDefinition[]> {
			return [];
		},
	};
}
