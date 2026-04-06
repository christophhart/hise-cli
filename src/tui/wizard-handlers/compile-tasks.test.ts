import { describe, expect, it, vi } from "vitest";
import { createCompileProjectHandler, createCompileNetworksHandler } from "./compile-tasks.js";
import type { PhaseExecutor, SpawnResult } from "../../engine/wizard/phase-executor.js";
import type { WizardProgress } from "../../engine/wizard/types.js";

function mockExecutor(results: Record<string, SpawnResult>): PhaseExecutor {
	return {
		spawn: async (cmd, args, _opts) => {
			const key = `${cmd} ${args.join(" ")}`;
			// Match by command prefix
			for (const [pattern, result] of Object.entries(results)) {
				if (key.startsWith(pattern) || cmd === pattern) return result;
			}
			return { exitCode: 0, stdout: "", stderr: "" };
		},
	};
}

const okResult: SpawnResult = { exitCode: 0, stdout: "", stderr: "" };
const failResult: SpawnResult = { exitCode: 1, stdout: "", stderr: "error" };

describe("createCompileProjectHandler", () => {
	it("spawns build script from context", async () => {
		const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
		const executor: PhaseExecutor = {
			spawn: async (cmd, args, _opts) => {
				spawnCalls.push({ cmd, args });
				if (cmd === "cat") return { exitCode: 0, stdout: "xcodebuild -project Foo.xcodeproj", stderr: "" };
				return okResult;
			},
		};

		const handler = createCompileProjectHandler(executor);
		const progress: WizardProgress[] = [];
		const result = await handler({}, (p) => progress.push(p), undefined, {
			buildScript: "/path/to/build.sh",
			buildDirectory: "/path/to/Binaries",
			configuration: "Release",
		});

		expect(result.success).toBe(true);
		expect(spawnCalls[0]!.cmd).toBe("cat");
		expect(spawnCalls[0]!.args).toEqual(["/path/to/build.sh"]);
		expect(spawnCalls[1]!.cmd).toBe("bash");
	});

	it("fails when context is missing", async () => {
		const handler = createCompileProjectHandler({ spawn: async () => okResult });
		const result = await handler({}, () => {}, undefined, undefined);
		expect(result.success).toBe(false);
		expect(result.message).toContain("Missing build paths");
	});

	it("fails when context has no buildScript", async () => {
		const handler = createCompileProjectHandler({ spawn: async () => okResult });
		const result = await handler({}, () => {}, undefined, { buildDirectory: "/bin" });
		expect(result.success).toBe(false);
		expect(result.message).toContain("Missing build paths");
	});

	it("reports compilation failure", async () => {
		const executor: PhaseExecutor = {
			spawn: async (cmd) => {
				if (cmd === "cat") return { exitCode: 0, stdout: "make", stderr: "" };
				return failResult;
			},
		};

		const handler = createCompileProjectHandler(executor);
		const result = await handler({}, () => {}, undefined, {
			buildScript: "/build.sh",
			buildDirectory: "/bin",
			configuration: "Release",
		});

		expect(result.success).toBe(false);
		expect(result.message).toContain("Compilation failed");
	});
});

describe("createCompileNetworksHandler", () => {
	it("spawns build script from context", async () => {
		const spawnCalls: Array<{ cmd: string; args: string[] }> = [];
		const executor: PhaseExecutor = {
			spawn: async (cmd, args) => {
				spawnCalls.push({ cmd, args });
				if (cmd === "cat") return { exitCode: 0, stdout: "xcodebuild -project DLL.xcodeproj", stderr: "" };
				return okResult;
			},
		};

		const handler = createCompileNetworksHandler(executor);
		const result = await handler({}, () => {}, undefined, {
			buildScript: "/dll/build.sh",
			buildDirectory: "/dll/Binaries",
			configuration: "Release",
		});

		expect(result.success).toBe(true);
		expect(spawnCalls[0]!.cmd).toBe("cat");
	});

	it("fails when context is missing", async () => {
		const handler = createCompileNetworksHandler({ spawn: async () => okResult });
		const result = await handler({}, () => {}, undefined, {});
		expect(result.success).toBe(false);
		expect(result.message).toContain("Missing build paths");
	});
});
