import { describe, expect, it } from "vitest";
import { createSetupDetectHandler } from "./setup-detect.js";
import { MockPhaseExecutor } from "../../engine/wizard/mock-phase-executor.js";

describe("setupDetectEnvironment", () => {
	it("detects platform and architecture", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("git", { exitCode: 0, stdout: "git version 2.43.0", stderr: "" });
		executor.onSpawn("xcodebuild", { exitCode: 0, stdout: "Xcode 15.2\nBuild version 15C500b", stderr: "" });
		executor.onSpawn("faust", { exitCode: 1, stdout: "", stderr: "not found" });

		const handler = createSetupDetectHandler(executor);
		const defaults = await handler("setup");

		expect(defaults.platform).toBeDefined();
		expect(defaults.architecture).toBeDefined();
		expect(defaults.installPath).toBeDefined();
	});

	it("detects git presence", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("git", { exitCode: 0, stdout: "git version 2.43.0", stderr: "" });

		const handler = createSetupDetectHandler(executor);
		const defaults = await handler("setup");
		expect(defaults.hasGit).toBe("1");
	});

	it("detects git absence", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("git", { exitCode: 1, stdout: "", stderr: "not found" });

		const handler = createSetupDetectHandler(executor);
		const defaults = await handler("setup");
		expect(defaults.hasGit).toBe("0");
	});
});
