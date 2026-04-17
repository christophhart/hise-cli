// ── Setup wizard init handler — environment detection ────────────────
//
// Detects platform, architecture, git, compiler, and Faust availability.
// Returns default values to pre-fill the setup wizard form.

import type { InternalInitHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";

const DEFAULT_INSTALL_PATHS_MACOS = ["~/HISE", "/Users/Shared/HISE", "~/Documents/HISE", "~/Desktop/HISE"];
const DEFAULT_INSTALL_PATHS_WINDOWS = ["C:\\HISE", "~/HISE", "D:\\HISE", "~/Documents/HISE", "~/Desktop/HISE"];
const DEFAULT_INSTALL_PATHS_LINUX = ["~/HISE", "/opt/HISE", "~/Documents/HISE"];

function expandHome(p: string): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return p.replace(/^~/, home);
}

export function createSetupDetectHandler(executor: PhaseExecutor): InternalInitHandler {
	return async (_wizardId) => {
		const defaults: Record<string, string> = {};

		// Platform
		const platform =
			process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
		defaults.platform = platform;

		// Architecture
		defaults.architecture = process.arch === "arm64" ? "arm64" : "x64";

		// Git detection — try PATH first, then known install locations
		// (Windows installer updates PATH only for new shells, so fresh
		// installs won't resolve via `git` on an already-running process).
		defaults.hasGit = await detectGit(executor, platform) ? "1" : "0";

		// Compiler detection
		defaults.compilerVersion = await detectCompiler(executor, platform);
		defaults.hasVs =
			platform === "Windows" && defaults.compilerVersion !== "Not detected" ? "1" : "0";

		// Intel IPP detection (Windows only)
		defaults.hasIpp = await detectIpp(executor, platform) ? "1" : "0";

		// Faust detection
		defaults.hasFaust = await detectFaust(executor, platform) ? "1" : "0";

		// Default install path (first existing HISE install or ~/HISE)
		const candidates =
			platform === "macOS"
				? DEFAULT_INSTALL_PATHS_MACOS
				: platform === "Windows"
					? DEFAULT_INSTALL_PATHS_WINDOWS
					: DEFAULT_INSTALL_PATHS_LINUX;

		defaults.installPath = expandHome(candidates[0]!);

		return defaults;
	};
}

async function detectCompiler(
	executor: PhaseExecutor,
	platform: string,
): Promise<string> {
	if (platform === "macOS") {
		const result = await executor.spawn("xcodebuild", ["-version"], {});
		if (result.exitCode === 0) {
			const firstLine = result.stdout.split("\n")[0] ?? "";
			return firstLine.trim();
		}
		const clang = await executor.spawn("clang", ["--version"], {});
		if (clang.exitCode === 0) {
			return (clang.stdout.split("\n")[0] ?? "").trim();
		}
	} else if (platform === "Linux") {
		const gcc = await executor.spawn("gcc", ["--version"], {});
		if (gcc.exitCode === 0) {
			return (gcc.stdout.split("\n")[0] ?? "").trim();
		}
	} else {
		// Windows — try vswhere. Use -products * to include Build Tools
		// (default product list excludes them) and require the MSVC C++
		// compiler component so "MSBuild-only" installs don't false-positive.
		const vswhere = await executor.spawn(
			"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe",
			[
				"-latest",
				"-products", "*",
				"-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
				"-property", "displayName",
			],
			{},
		);
		if (vswhere.exitCode === 0 && vswhere.stdout.trim()) {
			return vswhere.stdout.trim();
		}
	}
	return "Not detected";
}

async function detectGit(executor: PhaseExecutor, platform: string): Promise<boolean> {
	const onPath = await executor.spawn("git", ["--version"], {});
	if (onPath.exitCode === 0) return true;
	if (platform !== "Windows") return false;
	// Windows fallback: check known install locations (winget/Git for Windows).
	// If found, inject the dir into process.env.PATH so subsequent spawns
	// (clone, submodule update) can resolve plain `git` — the terminal that
	// started the wizard inherited its PATH before git was installed, so a
	// fresh hise-cli launch from that same terminal won't see the system
	// PATH update winget wrote to the registry.
	const candidates = [
		"C:\\Program Files\\Git\\cmd",
		"C:\\Program Files (x86)\\Git\\cmd",
	];
	for (const dir of candidates) {
		const exe = `${dir}\\git.exe`;
		const check = await executor.spawn("cmd", ["/c", `if exist "${exe}" echo found`], {});
		if (check.stdout.includes("found")) {
			const existing = process.env.PATH ?? "";
			if (!existing.toLowerCase().includes(dir.toLowerCase())) {
				process.env.PATH = `${dir};${existing}`;
			}
			return true;
		}
	}
	return false;
}

async function detectIpp(executor: PhaseExecutor, platform: string): Promise<boolean> {
	if (platform !== "Windows") return false;
	const result = await executor.spawn(
		"cmd",
		["/c", "if exist \"C:\\Program Files (x86)\\Intel\\oneAPI\\ipp\\latest\" echo found"],
		{},
	);
	return result.stdout.includes("found");
}

async function detectFaust(executor: PhaseExecutor, platform: string): Promise<boolean> {
	if (platform === "Windows") {
		// Check known install path
		const result = await executor.spawn("cmd", ["/c", "if exist \"C:\\Program Files\\Faust\\lib\\faust.dll\" echo found"], {});
		return result.stdout.includes("found");
	}
	// macOS / Linux — check PATH
	const result = await executor.spawn("faust", ["--version"], {});
	return result.exitCode === 0;
}
