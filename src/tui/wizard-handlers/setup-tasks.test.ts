import { describe, expect, it } from "vitest";
import {
	createSetupGitInstallHandler,
	createSetupCloneRepoHandler,
	createSetupBuildDepsHandler,
	createSetupFaustInstallHandler,
} from "./setup-tasks.js";
import { MockPhaseExecutor } from "../../engine/wizard/mock-phase-executor.js";
import type { WizardProgress } from "../../engine/wizard/types.js";

function noop(_p: WizardProgress): void {}

describe("setupGitInstall", () => {
	it("skips when git is already installed", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupGitInstallHandler(executor);
		const result = await handler({ hasGit: "1", platform: "macOS" }, noop);
		expect(result.success).toBe(true);
		expect(result.message).toContain("already installed");
		expect(executor.calls).toHaveLength(0);
	});

	it("fails on macOS with manual instructions", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupGitInstallHandler(executor);
		const result = await handler({ hasGit: "0", platform: "macOS" }, noop);
		expect(result.success).toBe(false);
		expect(result.message).toContain("xcode-select");
	});

	it("attempts apt-get on Linux", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("sudo", { exitCode: 0, stdout: "", stderr: "" });
		const handler = createSetupGitInstallHandler(executor);
		const result = await handler({ hasGit: "0", platform: "Linux" }, noop);
		expect(result.success).toBe(true);
		expect(executor.calls[0]!.command).toBe("sudo");
	});
});

describe("setupCloneRepo", () => {
	it("clones fresh when directory does not exist", async () => {
		const executor = new MockPhaseExecutor();
		// git -C fails (no repo), clone succeeds, rest succeeds
		executor.onSpawn("git", { exitCode: 0, stdout: "", stderr: "" });
		const handler = createSetupCloneRepoHandler(executor);
		const result = await handler({ installPath: "/tmp/hise" }, noop);
		expect(result.success).toBe(true);
		expect(executor.calls.length).toBeGreaterThan(0);
	});
});

describe("setupBuildDeps", () => {
	it("skips on non-Linux platforms", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupBuildDepsHandler(executor);
		const result = await handler({ platform: "macOS" }, noop);
		expect(result.success).toBe(true);
		expect(result.message).toContain("not needed");
		expect(executor.calls).toHaveLength(0);
	});

	it("installs packages on Linux", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("sudo", { exitCode: 0, stdout: "", stderr: "" });
		const handler = createSetupBuildDepsHandler(executor);
		const result = await handler({ platform: "Linux" }, noop);
		expect(result.success).toBe(true);
	});
});

describe("setupFaustInstall", () => {
	it("skips when faust not requested", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupFaustInstallHandler(executor);
		const result = await handler({ includeFaust: "0" }, noop);
		expect(result.success).toBe(true);
		expect(result.message).toContain("skipped");
	});

	it("skips when faust already installed", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupFaustInstallHandler(executor);
		const result = await handler({ includeFaust: "1", hasFaust: "1" }, noop);
		expect(result.success).toBe(true);
		expect(result.message).toContain("already installed");
	});

	it("installs on Linux via apt-get", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("sudo", { exitCode: 0, stdout: "", stderr: "" });
		const handler = createSetupFaustInstallHandler(executor);
		const result = await handler({ includeFaust: "1", hasFaust: "0", platform: "Linux" }, noop);
		expect(result.success).toBe(true);
	});
});
