// ── Bundled DataLoader — static imports for standalone binary builds ─
//
// This loader inlines all data files at build time via esbuild's JSON
// and text loaders. Used by the production entry point so the compiled
// binary is fully self-contained (no data/ directory on disk needed).
//
// When adding a new wizard YAML file to data/wizards/, add a
// corresponding import and entry in the wizardYamls array below.

import moduleListData from "../../data/moduleList.json";
import scriptingApiData from "../../data/scripting_api.json";
import scriptnodeListData from "../../data/scriptnodeList.json";
import componentPropertiesData from "../../data/ui_component_properties.json";
import preprocessorData from "../../data/preprocessor.json";

import audioExportYaml from "../../data/wizards/audio_export.yaml";
import buildInstallerYaml from "../../data/wizards/build_installer.yaml";
import compileNetworksYaml from "../../data/wizards/compile_networks.yaml";
import installPackageMakerYaml from "../../data/wizards/install_package_maker.yaml";
import newProjectYaml from "../../data/wizards/new_project.yaml";
import pluginExportYaml from "../../data/wizards/plugin_export.yaml";
import recompileYaml from "../../data/wizards/recompile.yaml";
import setupYaml from "../../data/wizards/setup.yaml";
import updateYaml from "../../data/wizards/update.yaml";

import { parse as parseYaml } from "yaml";
import type {
	DataLoader,
	ModuleList,
	PreprocessorList,
	ScriptingApi,
	ScriptnodeList,
} from "../engine/data.js";
import type { WizardDefinition } from "../engine/wizard/types.js";

const wizardYamls = [
	audioExportYaml,
	buildInstallerYaml,
	compileNetworksYaml,
	installPackageMakerYaml,
	newProjectYaml,
	pluginExportYaml,
	recompileYaml,
	setupYaml,
	updateYaml,
];

export function createBundledDataLoader(): DataLoader {
	return {
		async loadModuleList(): Promise<ModuleList> {
			return moduleListData as ModuleList;
		},
		async loadScriptingApi(): Promise<ScriptingApi> {
			return scriptingApiData as unknown as ScriptingApi;
		},
		async loadScriptnodeList(): Promise<ScriptnodeList> {
			return scriptnodeListData as unknown as ScriptnodeList;
		},
		async loadWizardDefinitions(): Promise<WizardDefinition[]> {
			return wizardYamls.map((raw) => parseYaml(raw) as WizardDefinition);
		},
		async loadComponentProperties() {
			return componentPropertiesData as import("../engine/modes/ui.js").ComponentPropertyMap;
		},
		async loadPreprocessorDefinitions(): Promise<PreprocessorList> {
			return preprocessorData as unknown as PreprocessorList;
		},
	};
}
