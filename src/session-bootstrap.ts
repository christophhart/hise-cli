import type { DataLoader, ModuleList, PreprocessorList, ScriptnodeList } from "./engine/data.js";
import type { HiseConnection } from "./engine/hise.js";
import { CompletionEngine } from "./engine/completion/engine.js";
import { Session } from "./engine/session.js";
import { BuilderMode } from "./engine/modes/builder.js";
import { DspMode } from "./engine/modes/dsp.js";
import { InspectMode } from "./engine/modes/inspect.js";
import { ProjectMode } from "./engine/modes/project.js";
import { ScriptMode } from "./engine/modes/script.js";
import { UndoMode } from "./engine/modes/undo.js";
import { UiMode, type ComponentPropertyMap } from "./engine/modes/ui.js";
import { SequenceMode } from "./engine/modes/sequence.js";
import { HiseMode, type HiseLauncher } from "./engine/modes/hise.js";
import { AnalyseMode } from "./engine/modes/analyse.js";
import { PublishMode } from "./engine/modes/publish.js";
import { WizardRegistry } from "./engine/wizard/registry.js";
import type { WizardHandlerRegistry } from "./engine/wizard/handler-registry.js";
import { registerWizardAliases } from "./engine/commands/slash.js";

export const SUPPORTED_MODE_IDS = ["script", "inspect", "builder", "dsp", "project", "undo", "ui", "sequence", "hise", "analyse", "publish"] as const;

export interface CreateSessionOptions {
	connection: HiseConnection | null;
	completionEngine?: CompletionEngine;
	getModuleList?: () => ModuleList | undefined;
	getScriptnodeList?: () => ScriptnodeList | undefined;
	getComponentProperties?: () => ComponentPropertyMap | undefined;
	getPreprocessorList?: () => PreprocessorList | undefined;
	handlerRegistry?: WizardHandlerRegistry;
	launcher?: HiseLauncher;
}

export function createSession({
	connection,
	completionEngine = new CompletionEngine(),
	getModuleList,
	getScriptnodeList,
	getComponentProperties,
	getPreprocessorList,
	handlerRegistry,
	launcher,
}: CreateSessionOptions): { session: Session; completionEngine: CompletionEngine } {
	const session = new Session(connection, completionEngine);
	if (handlerRegistry) session.handlerRegistry = handlerRegistry;
	session.registerMode("script", (ctx) => new ScriptMode(ctx, completionEngine));
	session.registerMode("inspect", () => new InspectMode(completionEngine));
	session.registerMode(
		"project",
		() => new ProjectMode(completionEngine, getPreprocessorList?.() ?? null),
	);
	session.registerMode(
		"builder",
		(ctx) => new BuilderMode(getModuleList?.(), completionEngine, ctx),
	);
	session.registerMode(
		"dsp",
		(ctx) => new DspMode(getScriptnodeList?.(), completionEngine, ctx),
	);
	session.registerMode("undo", () => new UndoMode(completionEngine));
	session.registerMode(
		"ui",
		(ctx) => new UiMode(completionEngine, ctx, getComponentProperties?.()),
	);
	session.registerMode("sequence", () => new SequenceMode(completionEngine));
	session.registerMode("hise", () => new HiseMode(launcher ?? null, completionEngine));
	session.registerMode("analyse", () => new AnalyseMode(completionEngine));
	session.registerMode("publish", () => new PublishMode());
	return { session, completionEngine };
}

export interface SessionDatasets {
	moduleList?: ModuleList;
	scriptnodeList?: ScriptnodeList;
	componentProperties?: ComponentPropertyMap;
	preprocessorList?: PreprocessorList;
}

export async function loadSessionDatasets(
	dataLoader: DataLoader | null | undefined,
	completionEngine: CompletionEngine,
	session?: Session,
): Promise<SessionDatasets> {
	if (!dataLoader) return {};
	await completionEngine.init(dataLoader);

	// Load wizard definitions from YAML
	if (session) {
		try {
			const wizardDefs = await dataLoader.loadWizardDefinitions();
			session.wizardRegistry = WizardRegistry.fromDefinitions(wizardDefs);
			registerWizardAliases(session.registry, session.wizardRegistry);
			// Refresh completion engine with newly registered alias commands
			if (completionEngine) {
				completionEngine.setSlashCommands(session.registry.all());
			}
		} catch (err) {
			console.error(`[wizard] Failed to load wizard definitions: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	const result: SessionDatasets = {};

	try {
		result.moduleList = await dataLoader.loadModuleList();
	} catch {
		// moduleList not available
	}

	try {
		result.scriptnodeList = await dataLoader.loadScriptnodeList();
	} catch {
		// scriptnodeList not available
	}

	try {
		result.componentProperties = await dataLoader.loadComponentProperties();
	} catch {
		// component properties not available
	}

	try {
		result.preprocessorList = await dataLoader.loadPreprocessorDefinitions();
	} catch {
		// preprocessor definitions not available
	}

	return result;
}
