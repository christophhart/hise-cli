import type { DataLoader, ModuleList } from "./engine/data.js";
import type { HiseConnection } from "./engine/hise.js";
import { CompletionEngine } from "./engine/completion/engine.js";
import { Session } from "./engine/session.js";
import { BuilderMode } from "./engine/modes/builder.js";
import { InspectMode } from "./engine/modes/inspect.js";
import { ScriptMode } from "./engine/modes/script.js";
import { UndoMode } from "./engine/modes/undo.js";
import { WizardRegistry } from "./engine/wizard/registry.js";
import type { WizardHandlerRegistry } from "./engine/wizard/handler-registry.js";

export const SUPPORTED_MODE_IDS = ["script", "inspect", "builder", "undo"] as const;

export interface CreateSessionOptions {
	connection: HiseConnection | null;
	completionEngine?: CompletionEngine;
	getModuleList?: () => ModuleList | undefined;
	handlerRegistry?: WizardHandlerRegistry;
}

export function createSession({
	connection,
	completionEngine = new CompletionEngine(),
	getModuleList,
	handlerRegistry,
}: CreateSessionOptions): { session: Session; completionEngine: CompletionEngine } {
	const session = new Session(connection, completionEngine);
	if (handlerRegistry) session.handlerRegistry = handlerRegistry;
	session.registerMode("script", (ctx) => new ScriptMode(ctx, completionEngine));
	session.registerMode("inspect", () => new InspectMode(completionEngine));
	session.registerMode(
		"builder",
		(ctx) => new BuilderMode(getModuleList?.(), completionEngine, ctx),
	);
	session.registerMode("undo", () => new UndoMode(completionEngine));
	return { session, completionEngine };
}

export async function loadSessionDatasets(
	dataLoader: DataLoader | null | undefined,
	completionEngine: CompletionEngine,
	session?: Session,
): Promise<ModuleList | undefined> {
	if (!dataLoader) return undefined;
	await completionEngine.init(dataLoader);

	// Load wizard definitions from YAML
	if (session) {
		try {
			const wizardDefs = await dataLoader.loadWizardDefinitions();
			session.wizardRegistry = WizardRegistry.fromDefinitions(wizardDefs);
		} catch (err) {
			console.error(`[wizard] Failed to load wizard definitions: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	try {
		return await dataLoader.loadModuleList();
	} catch {
		return undefined;
	}
}
