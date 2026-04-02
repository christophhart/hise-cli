import type { DataLoader, ModuleList } from "./engine/data.js";
import type { HiseConnection } from "./engine/hise.js";
import { CompletionEngine } from "./engine/completion/engine.js";
import { Session } from "./engine/session.js";
import { BuilderMode } from "./engine/modes/builder.js";
import { InspectMode } from "./engine/modes/inspect.js";
import { ScriptMode } from "./engine/modes/script.js";

export const SUPPORTED_MODE_IDS = ["script", "inspect", "builder"] as const;

export interface CreateSessionOptions {
	connection: HiseConnection | null;
	completionEngine?: CompletionEngine;
	getModuleList?: () => ModuleList | undefined;
}

export function createSession({
	connection,
	completionEngine = new CompletionEngine(),
	getModuleList,
}: CreateSessionOptions): { session: Session; completionEngine: CompletionEngine } {
	const session = new Session(connection, completionEngine);
	session.registerMode("script", (ctx) => new ScriptMode(ctx, completionEngine));
	session.registerMode("inspect", () => new InspectMode(completionEngine));
	session.registerMode(
		"builder",
		(ctx) => new BuilderMode(getModuleList?.(), completionEngine, ctx),
	);
	return { session, completionEngine };
}

export async function loadSessionDatasets(
	dataLoader: DataLoader | null | undefined,
	completionEngine: CompletionEngine,
): Promise<ModuleList | undefined> {
	if (!dataLoader) return undefined;
	await completionEngine.init(dataLoader);
	try {
		return await dataLoader.loadModuleList();
	} catch {
		return undefined;
	}
}
