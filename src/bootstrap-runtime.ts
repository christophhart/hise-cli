// ── Shared Node.js runtime bootstrap ────────────────────────────────
//
// Lifts the top-level wiring previously in src/index.ts so both the TUI
// and the web frontend can share it. Owns the singleton phase executor,
// wizard handler registry (with setup + compile handlers pre-registered),
// HISE launcher, and bundled data loader.
//
// Update wizard handlers depend on a live HiseConnection + launcher and
// are registered per-launch (in launchTui / launchWeb), not here.

import type { DataLoader } from "./engine/data.js";
import type { PhaseExecutor } from "./engine/wizard/phase-executor.js";
import { WizardHandlerRegistry } from "./engine/wizard/handler-registry.js";
import type { HiseLauncher } from "./engine/modes/hise.js";
import { createNodePhaseExecutor } from "./tui/nodePhaseExecutor.js";
import { createNodeHiseLauncher } from "./tui/nodeHiseLauncher.js";
import { createBundledDataLoader } from "./tui/bundledDataLoader.js";
import {
	registerSetupHandlers,
	registerCompileHandlers,
} from "./tui/wizard-handlers/index.js";

export interface NodeRuntime {
	phaseExecutor: PhaseExecutor;
	handlerRegistry: WizardHandlerRegistry;
	hiseLauncher: HiseLauncher;
	dataLoader: DataLoader;
}

export function bootstrapNodeRuntime(): NodeRuntime {
	const phaseExecutor = createNodePhaseExecutor();
	const handlerRegistry = new WizardHandlerRegistry();
	registerSetupHandlers(handlerRegistry, phaseExecutor);
	registerCompileHandlers(handlerRegistry, phaseExecutor);

	const hiseLauncher = createNodeHiseLauncher();
	const dataLoader = createBundledDataLoader();

	return { phaseExecutor, handlerRegistry, hiseLauncher, dataLoader };
}
