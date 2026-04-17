// ── Wizard handler registration ─────────────────────────────────────

import type { WizardHandlerRegistry } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import { createSetupDetectHandler } from "./setup-detect.js";
import {
	createSetupGitInstallHandler,
	createSetupCloneRepoHandler,
	createSetupBuildDepsHandler,
	createSetupFaustInstallHandler,
	createSetupExtractSdksHandler,
	createSetupVsInstallHandler,
	createSetupIppInstallHandler,
	createSetupCompileHandler,
	createSetupAddPathHandler,
	createSetupVerifyHandler,
	createSetupTestHandler,
} from "./setup-tasks.js";
import {
	createCompileProjectHandler,
	createCompileNetworksHandler,
} from "./compile-tasks.js";

/** Register all setup wizard handlers (init + tasks). */
export function registerSetupHandlers(
	registry: WizardHandlerRegistry,
	executor: PhaseExecutor,
): void {
	// Init handler — environment detection
	registry.registerInit("setupDetectEnvironment", createSetupDetectHandler(executor));

	// Task handlers
	registry.registerTask("setupGitInstall", createSetupGitInstallHandler(executor));
	registry.registerTask("setupCloneRepo", createSetupCloneRepoHandler(executor));
	registry.registerTask("setupBuildDeps", createSetupBuildDepsHandler(executor));
	registry.registerTask("setupFaustInstall", createSetupFaustInstallHandler(executor));
	registry.registerTask("setupExtractSdks", createSetupExtractSdksHandler(executor));
	registry.registerTask("setupVsInstall", createSetupVsInstallHandler(executor));
	registry.registerTask("setupIppInstall", createSetupIppInstallHandler(executor));
	registry.registerTask("setupCompile", createSetupCompileHandler(executor));
	registry.registerTask("setupAddPath", createSetupAddPathHandler(executor));
	registry.registerTask("setupVerify", createSetupVerifyHandler(executor));
	registry.registerTask("setupTest", createSetupTestHandler(executor));
}

/** Register compile handlers for plugin export + network compile wizards. */
export function registerCompileHandlers(
	registry: WizardHandlerRegistry,
	executor: PhaseExecutor,
): void {
	registry.registerTask("compileProject", createCompileProjectHandler(executor));
	registry.registerTask("compileNetworks", createCompileNetworksHandler(executor));
}
