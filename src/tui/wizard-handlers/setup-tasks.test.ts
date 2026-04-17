import { describe, expect, it } from "vitest";
import {
	createSetupGitInstallHandler,
	createSetupCloneRepoHandler,
	createSetupBuildDepsHandler,
	createSetupFaustInstallHandler,
	createSetupVsInstallHandler,
	createSetupCompileHandler,
	filterMsbuildLine,
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

	it("fails fast on Windows when not elevated", async () => {
		const executor = new MockPhaseExecutor();
		// net session exitCode != 0 → not elevated.
		executor.onSpawn("net", { exitCode: 1, stdout: "", stderr: "Access denied" });
		const handler = createSetupFaustInstallHandler(executor);
		const result = await handler({ includeFaust: "1", hasFaust: "0", platform: "Windows" }, noop);
		expect(result.success).toBe(false);
		expect(result.message).toMatch(/admin/i);
		// No download or install attempted.
		const nonNetCalls = executor.calls.filter((c) => c.command !== "net");
		expect(nonNetCalls).toHaveLength(0);
	});

	it("downloads and silently installs on Windows when elevated", async () => {
		const executor = new MockPhaseExecutor();
		// All stubs default to exitCode 0; `net session` succeeds → elevated.
		const handler = createSetupFaustInstallHandler(executor);
		const result = await handler({ includeFaust: "1", hasFaust: "0", platform: "Windows" }, noop);
		expect(result.success).toBe(true);

		const curl = executor.calls.find((c) => c.command === "curl");
		expect(curl).toBeDefined();
		const url = curl!.args[curl!.args.length - 1]!;
		expect(url).toContain("https://github.com/grame-cncm/faust/releases/download/");
		expect(url).toContain("Faust-");
		expect(url.endsWith("-win64.exe")).toBe(true);

		const installerCall = executor.calls.find((c) => c.command.endsWith("faust-installer.exe"));
		expect(installerCall).toBeDefined();
		expect(installerCall!.args).toEqual(["/S", "/D=C:\\Program Files\\Faust"]);
	});
});

describe("setupVsInstall", () => {
	it("skips on non-Windows platforms", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupVsInstallHandler(executor);
		const result = await handler({ platform: "Linux" }, noop);
		expect(result.success).toBe(true);
		expect(executor.calls).toHaveLength(0);
	});

	it("skips when VS is already detected", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupVsInstallHandler(executor);
		const result = await handler({ platform: "Windows", hasVs: "1" }, noop);
		expect(result.success).toBe(true);
		expect(result.message).toContain("already installed");
	});

	it("fails fast when not elevated", async () => {
		const executor = new MockPhaseExecutor();
		executor.onSpawn("net", { exitCode: 1, stdout: "", stderr: "Access denied" });
		const handler = createSetupVsInstallHandler(executor);
		const result = await handler({ platform: "Windows", hasVs: "0" }, noop);
		expect(result.success).toBe(false);
		expect(result.message).toMatch(/admin/i);
		// No download or install attempted.
		const nonNetCalls = executor.calls.filter((c) => c.command !== "net");
		expect(nonNetCalls).toHaveLength(0);
	});

	it("downloads bootstrapper and runs install with the expected args", async () => {
		const executor = new MockPhaseExecutor();
		const handler = createSetupVsInstallHandler(executor);
		const result = await handler({ platform: "Windows", hasVs: "0" }, noop);
		expect(result.success).toBe(true);

		const curl = executor.calls.find((c) => c.command === "curl");
		expect(curl).toBeDefined();
		expect(curl!.args).toContain("https://aka.ms/vs/stable/vs_BuildTools.exe");

		const installerCall = executor.calls.find((c) => c.command.endsWith("vs_BuildTools.exe"));
		expect(installerCall).toBeDefined();
		const args = installerCall!.args;
		expect(args).toContain("--passive");
		expect(args).toContain("--wait");
		expect(args).toContain("--norestart");
		expect(args).toContain("Microsoft.VisualStudio.Workload.VCTools");
		expect(args).toContain("Microsoft.VisualStudio.Component.VC.Tools.x86.x64");
		expect(args).toContain("Microsoft.VisualStudio.Component.Windows11SDK.26100");
		expect(args).toContain("--addProductLang");
		expect(args).toContain("en-US");
	});

	it("treats installer exit code 3010 (reboot-pending) as success", async () => {
		const executor = new MockPhaseExecutor();
		// We don't know the exact installer path string to key the mock on,
		// so we match by filename suffix via a custom sub-class approach:
		// simpler — override spawn directly.
		const baseSpawn = executor.spawn.bind(executor);
		executor.spawn = async (command, args, options) => {
			if (command.endsWith("vs_BuildTools.exe") && args.includes("--passive")) {
				// Still record the call.
				executor.calls.push({ command, args, env: options.env });
				return { exitCode: 3010, stdout: "", stderr: "" };
			}
			return baseSpawn(command, args, options);
		};
		const handler = createSetupVsInstallHandler(executor);
		const result = await handler({ platform: "Windows", hasVs: "0" }, noop);
		expect(result.success).toBe(true);
	});
});

describe("setupCompile (Windows)", () => {
	it("passes VSLANG=1033 to MSBuild so output is English", async () => {
		const executor = new MockPhaseExecutor();
		// vswhere → installationPath, Projucer + MSBuild → success
		executor.onSpawn("C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe", {
			exitCode: 0,
			stdout: "C:\\Program Files (x86)\\Microsoft Visual Studio\\18\\BuildTools\n",
			stderr: "",
		});
		const handler = createSetupCompileHandler(executor);
		await handler({ platform: "Windows", installPath: "C:\\HISE", includeFaust: "0" }, noop);

		const msbuildCall = executor.calls.find((c) => c.command.endsWith("MSBuild.exe"));
		expect(msbuildCall).toBeDefined();
		expect(msbuildCall?.env?.VSLANG).toBe("1033");
		expect(msbuildCall?.env?.VSLANGCODE).toBe("en-US");
	});
});

describe("filterMsbuildLine", () => {
	const installPath = "C:\\HISE";

	it("reformats warning diagnostic with path stripping", () => {
		const input =
			"C:\\HISE\\hi_backend\\backend\\ai_tools\\RestHelpers.cpp(3316,7): " +
			"warning C4189: \"p\": Lokale Variable ist initialisiert aber nicht referenziert " +
			"[C:\\HISE\\projects\\standalone\\Builds\\VisualStudio2026\\HISE Standalone_App.vcxproj]";
		const out = filterMsbuildLine(input, installPath);
		expect(out).toBe(
			"⚠ warning C4189: \"p\": Lokale Variable ist initialisiert aber nicht referenziert\n" +
			"   hi_backend/backend/ai_tools/RestHelpers.cpp (3316,7)",
		);
	});

	it("reformats error diagnostic with ✗ marker", () => {
		const input =
			"C:\\HISE\\foo\\bar.cpp(42,3): error C2065: 'x': undeclared identifier [C:\\HISE\\proj.vcxproj]";
		const out = filterMsbuildLine(input, installPath);
		expect(out).toBe("✗ error C2065: 'x': undeclared identifier\n   foo/bar.cpp (42,3)");
	});

	it("keeps absolute path when file lies outside installPath", () => {
		const input =
			"D:\\External\\thing.cpp(1,1): warning C4100: unused [D:\\External\\proj.vcxproj]";
		const out = filterMsbuildLine(input, installPath);
		expect(out).toBe("⚠ warning C4100: unused\n   D:/External/thing.cpp (1,1)");
	});

	it("handles diagnostics with only line number (no column)", () => {
		const input =
			"C:\\HISE\\a\\b.cpp(10): warning C4189: msg [C:\\HISE\\proj.vcxproj]";
		const out = filterMsbuildLine(input, installPath);
		expect(out).toBe("⚠ warning C4189: msg\n   a/b.cpp (10)");
	});

	it("drops German 'Quelldatei wird kompiliert' follow-ups", () => {
		const input = "  (Quelldatei „../../JuceLibraryCode/include_hi_backend.cpp“ wird kompiliert)";
		expect(filterMsbuildLine(input, installPath)).toBeNull();
	});

	it("drops English 'Compiling source file' follow-ups", () => {
		const input = "  (Compiling source file ../../JuceLibraryCode/foo.cpp)";
		expect(filterMsbuildLine(input, installPath)).toBeNull();
	});

	it("passes through unrelated lines unchanged", () => {
		expect(filterMsbuildLine("Build succeeded.", installPath)).toBe("Build succeeded.");
		expect(filterMsbuildLine("    0 Warning(s)", installPath)).toBe("    0 Warning(s)");
	});

	it("works without installPath (keeps absolute paths)", () => {
		const input =
			"C:\\HISE\\foo.cpp(1,1): warning C4189: msg [C:\\HISE\\proj.vcxproj]";
		const out = filterMsbuildLine(input);
		expect(out).toBe("⚠ warning C4189: msg\n   C:/HISE/foo.cpp (1,1)");
	});
});
