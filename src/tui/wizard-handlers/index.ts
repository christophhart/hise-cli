// ── Wizard handler registration — setup wizard ──────────────────────

import type { WizardHandlerRegistry } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import { createSetupDetectHandler } from "./setup-detect.js";
import {
	createSetupGitInstallHandler,
	createSetupCloneRepoHandler,
	createSetupBuildDepsHandler,
	createSetupFaustInstallHandler,
	createSetupExtractSdksHandler,
	createSetupCompileHandler,
	createSetupAddPathHandler,
	createSetupVerifyHandler,
} from "./setup-tasks.js";

/** Register all setup wizard handlers (init + tasks). */
export function registerSetupHandlers(
	registry: WizardHandlerRegistry,
	executor: PhaseExecutor,
): void {
	// Init handler — environment detection
	registry.registerInit("setupDetectEnvironment", createSetupDetectHandler(executor));

	// Task handlers — 8 phases
	registry.registerTask("setupGitInstall", createSetupGitInstallHandler(executor));
	registry.registerTask("setupCloneRepo", createSetupCloneRepoHandler(executor));
	registry.registerTask("setupBuildDeps", createSetupBuildDepsHandler(executor));
	registry.registerTask("setupFaustInstall", createSetupFaustInstallHandler(executor));
	registry.registerTask("setupExtractSdks", createSetupExtractSdksHandler(executor));
	registry.registerTask("setupCompile", createSetupCompileHandler(executor));
	registry.registerTask("setupAddPath", createSetupAddPathHandler(executor));
	registry.registerTask("setupVerify", createSetupVerifyHandler(executor));
}
