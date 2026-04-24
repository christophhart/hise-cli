// ── Wizard handler registration ─────────────────────────────────────

import type { HiseConnection } from "../../engine/hise.js";
import type { HiseLauncher } from "../../engine/modes/hise.js";
import type { WizardHandlerRegistry } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import { createSetupDetectHandler } from "./setup-detect.js";
import {
	createSetupGitInstallHandler,
	createSetupCloneRepoHandler,
	createSetupBuildDepsHandler,
	createSetupFaustInstallHandler,
	createSetupExtractSdksHandler,
	createSetupCompilerInstallHandler,
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
import { createUpdateDetectHandler } from "./update-detect.js";
import {
	createUpdateShutdownHandler,
	createUpdateCheckoutHandler,
	createUpdateCleanBuildsHandler,
	createUpdateCompileHandler,
	createUpdateSymlinkHandler,
	createUpdateLaunchHandler,
	createUpdateVerifyHandler,
} from "./update-tasks.js";

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
	registry.registerTask("setupCompilerInstall", createSetupCompilerInstallHandler(executor));
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

/** Register update wizard handlers. Unlike the setup/compile wizards these
 *  need a live HISE connection (for shutdown + verify) and a launcher (for
 *  relaunch), so they must be registered per-session once those are known. */
export function registerUpdateHandlers(
	registry: WizardHandlerRegistry,
	deps: {
		executor: PhaseExecutor;
		connection: HiseConnection;
		launcher: HiseLauncher;
	},
): void {
	registry.registerInit(
		"updateDetectEnvironment",
		createUpdateDetectHandler({ executor: deps.executor, connection: deps.connection }),
	);
	registry.registerTask("updateShutdown", createUpdateShutdownHandler(deps));
	registry.registerTask("updateCheckout", createUpdateCheckoutHandler(deps));
	registry.registerTask("updateCleanBuilds", createUpdateCleanBuildsHandler(deps));
	registry.registerTask("updateCompile", createUpdateCompileHandler(deps));
	registry.registerTask("updateSymlink", createUpdateSymlinkHandler(deps));
	registry.registerTask("updateLaunch", createUpdateLaunchHandler(deps));
	registry.registerTask("updateVerify", createUpdateVerifyHandler(deps));
}
