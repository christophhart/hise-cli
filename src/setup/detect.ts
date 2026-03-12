import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	Architecture,
	DetectedEnvironment,
	DetectedHiseInstall,
	Platform,
	PrereqCheckResult,
} from "../setup-core/types.js";

// ── Platform Detection ──────────────────────────────────────────────

export function detectPlatform(): Platform {
	switch (process.platform) {
		case "win32":
			return "windows";
		case "darwin":
			return "macos";
		case "linux":
			return "linux";
		default:
			throw new Error(`Unsupported platform: ${process.platform}`);
	}
}

export function detectArchitecture(): Architecture {
	const arch = process.arch;
	if (arch === "arm64") return "arm64";
	return "x64";
}

// ── Tool Detection ──────────────────────────────────────────────────

function commandExists(cmd: string): boolean {
	try {
		if (process.platform === "win32") {
			execSync(`where ${cmd}`, { stdio: "ignore" });
		} else {
			execSync(`command -v ${cmd}`, { stdio: "ignore" });
		}
		return true;
	} catch {
		return false;
	}
}

function getCommandOutput(cmd: string): string | null {
	try {
		return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
			.toString()
			.trim();
	} catch {
		return null;
	}
}

function detectGit(): boolean {
	return commandExists("git");
}

// ── Compiler Detection ──────────────────────────────────────────────

interface CompilerResult {
	found: boolean;
	info?: string;
}

function detectCompilerWindows(): CompilerResult {
	// Check for VS 2022 via vswhere
	const vswherePaths = [
		"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe",
		"C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe",
	];

	for (const vswhere of vswherePaths) {
		if (fs.existsSync(vswhere)) {
			const output = getCommandOutput(
				`"${vswhere}" -latest -property displayName`
			);
			if (output) {
				return { found: true, info: output };
			}
		}
	}

	// Fallback: check for MSBuild directly
	const msbuildPaths = [
		"C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
		"C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\MSBuild\\Current\\Bin\\MSBuild.exe",
	];

	for (const msbuild of msbuildPaths) {
		if (fs.existsSync(msbuild)) {
			return { found: true, info: `MSBuild found at ${msbuild}` };
		}
	}

	return { found: false };
}

function detectCompilerMacOS(): CompilerResult {
	// Check for Xcode Command Line Tools
	const xcrunVersion = getCommandOutput("xcodebuild -version");
	if (xcrunVersion) {
		const firstLine = xcrunVersion.split("\n")[0];
		return { found: true, info: firstLine };
	}

	// Fallback: check for clang
	if (commandExists("clang")) {
		const version = getCommandOutput("clang --version");
		const firstLine = version?.split("\n")[0];
		return { found: true, info: firstLine || "clang found" };
	}

	return { found: false };
}

function detectCompilerLinux(): CompilerResult {
	if (commandExists("gcc")) {
		const version = getCommandOutput("gcc --version");
		const firstLine = version?.split("\n")[0];
		return { found: true, info: firstLine || "gcc found" };
	}

	if (commandExists("g++")) {
		return { found: true, info: "g++ found" };
	}

	return { found: false };
}

function detectCompiler(platform: Platform): CompilerResult {
	switch (platform) {
		case "windows":
			return detectCompilerWindows();
		case "macos":
			return detectCompilerMacOS();
		case "linux":
			return detectCompilerLinux();
	}
}

// ── Faust Detection ─────────────────────────────────────────────────

interface FaustResult {
	found: boolean;
	path?: string;
}

function detectFaust(platform: Platform): FaustResult {
	if (platform === "windows") {
		const faustDll = "C:\\Program Files\\Faust\\lib\\faust.dll";
		if (fs.existsSync(faustDll)) {
			return { found: true, path: "C:\\Program Files\\Faust" };
		}
	}

	if (platform === "macos") {
		// Faust on macOS is typically in the HISE tools folder, not system-wide.
		// We check for system faust command as well.
		if (commandExists("faust")) {
			const faustPath = getCommandOutput("command -v faust");
			return { found: true, path: faustPath || undefined };
		}
	}

	if (platform === "linux") {
		if (commandExists("faust")) {
			return { found: true };
		}
	}

	return { found: false };
}

// ── IPP Detection (Windows only) ────────────────────────────────────

function detectIPP(): boolean {
	return fs.existsSync(
		"C:\\Program Files (x86)\\Intel\\oneAPI\\ipp\\latest"
	);
}

// ── HISE Installation Discovery ─────────────────────────────────────

function findHiseInstallations(platform: Platform): DetectedHiseInstall[] {
	const installs: DetectedHiseInstall[] = [];
	const candidates: string[] = [];

	// Common candidate paths
	const home = os.homedir();

	switch (platform) {
		case "windows":
			candidates.push(
				"C:\\HISE",
				path.join(home, "HISE"),
				"D:\\HISE",
				path.join(home, "Documents", "HISE"),
				path.join(home, "Desktop", "HISE"),
			);
			break;
		case "macos":
			candidates.push(
				path.join(home, "HISE"),
				"/Users/Shared/HISE",
				path.join(home, "Documents", "HISE"),
				path.join(home, "Desktop", "HISE"),
			);
			break;
		case "linux":
			candidates.push(
				path.join(home, "HISE"),
				"/opt/HISE",
				path.join(home, "Documents", "HISE"),
			);
			break;
	}

	for (const candidate of candidates) {
		const jucerPath = path.join(
			candidate,
			"projects",
			"standalone",
			"HISE Standalone.jucer"
		);

		if (!fs.existsSync(jucerPath)) {
			continue;
		}

		const isGitRepo = fs.existsSync(path.join(candidate, ".git"));
		let hasFaust = false;

		if (platform === "windows") {
			hasFaust = fs.existsSync(
				path.join(candidate, "tools", "faust", "lib", "faust.dll")
			);
		} else if (platform === "macos") {
			hasFaust = fs.existsSync(
				path.join(candidate, "tools", "faust", "lib", "libfaust.dylib")
			);
		} else {
			hasFaust = fs.existsSync(
				path.join(candidate, "tools", "faust")
			);
		}

		let commitHash: string | undefined;
		if (isGitRepo) {
			commitHash =
				getCommandOutput(`git -C "${candidate}" rev-parse HEAD`) ??
				undefined;
		}

		installs.push({
			path: candidate,
			isGitRepo,
			hasFaust,
			commitHash,
		});
	}

	return installs;
}

// ── Full Environment Detection ──────────────────────────────────────

export function detectEnvironment(): DetectedEnvironment {
	const platform = detectPlatform();
	const architecture = detectArchitecture();
	const hasGit = detectGit();
	const compiler = detectCompiler(platform);
	const faust = detectFaust(platform);
	const hasIPP = platform === "windows" ? detectIPP() : false;
	const hiseInstallations = findHiseInstallations(platform);

	return {
		platform,
		architecture,
		hasGit,
		hasCompiler: compiler.found,
		compilerInfo: compiler.info,
		hasFaust: faust.found,
		faustPath: faust.path,
		hasIPP,
		hiseInstallations,
	};
}

// ── Prerequisite Checks ─────────────────────────────────────────────

export function checkPrerequisites(
	env: DetectedEnvironment,
	config: { includeFaust: boolean; includeIPP: boolean }
): PrereqCheckResult[] {
	const results: PrereqCheckResult[] = [];

	// Git
	results.push({
		id: "git",
		name: "Git",
		status: env.hasGit ? "found" : "missing",
		detail: env.hasGit ? "git found on PATH" : undefined,
		required: true,
		actions: env.hasGit
			? []
			: env.platform === "windows"
				? [
						{
							label: "Install via winget",
							action: "run-command",
							command: "winget install Git.Git",
						},
						{
							label: "Open download page",
							action: "open-url",
							url: "https://git-scm.com/download/win",
						},
						{ label: "Re-check", action: "recheck" },
					]
				: env.platform === "macos"
					? [
							{
								label: "Install Xcode CLI Tools",
								action: "run-command",
								command: "xcode-select --install",
							},
							{ label: "Re-check", action: "recheck" },
						]
					: [
							{
								label: "Install via apt",
								action: "run-command",
								command: "sudo apt-get install -y git",
							},
							{ label: "Re-check", action: "recheck" },
						],
	});

	// Compiler
	results.push({
		id: "compiler",
		name: env.platform === "windows"
			? "Visual Studio"
			: env.platform === "macos"
				? "Xcode"
				: "GCC/G++",
		status: env.hasCompiler ? "found" : "missing",
		detail: env.compilerInfo,
		required: true,
		actions: env.hasCompiler
			? []
			: env.platform === "windows"
				? [
						{
							label: "Install via winget",
							action: "run-command",
							command:
								"winget install Microsoft.VisualStudio.2022.Community --override \"--add Microsoft.VisualStudio.Workload.NativeDesktop --passive --norestart\"",
						},
						{
							label: "Open download page",
							action: "open-url",
							url: "https://visualstudio.microsoft.com/downloads/",
						},
						{ label: "Re-check", action: "recheck" },
					]
				: env.platform === "macos"
					? [
							{
								label: "Install Xcode CLI Tools",
								action: "run-command",
								command: "xcode-select --install",
							},
							{
								label: "Open Mac App Store (Xcode)",
								action: "open-url",
								url: "https://apps.apple.com/app/xcode/id497799835",
							},
							{ label: "Re-check", action: "recheck" },
						]
					: [
							{
								label: "Install build tools",
								action: "run-command",
								command:
									"sudo apt-get install -y build-essential gcc g++",
							},
							{ label: "Re-check", action: "recheck" },
						],
	});

	// Faust (optional)
	if (config.includeFaust) {
		results.push({
			id: "faust",
			name: "Faust",
			status: env.hasFaust ? "found" : "missing",
			detail: env.faustPath
				? `Found at ${env.faustPath}`
				: undefined,
			required: false,
			actions: env.hasFaust
				? []
				: [
						{
							label: "Will be installed during setup",
							action: "recheck",
						},
					],
		});
	}

	// IPP (Windows, optional)
	if (env.platform === "windows" && config.includeIPP) {
		results.push({
			id: "ipp",
			name: "Intel IPP",
			status: env.hasIPP ? "found" : "missing",
			detail: env.hasIPP
				? "Intel IPP found"
				: "IPP not detected - build will continue without it",
			required: false,
			actions: env.hasIPP
				? []
				: [
						{
							label: "Open Intel IPP download",
							action: "open-url",
							url: "https://www.intel.com/content/www/us/en/developer/tools/oneapi/ipp-download.html",
						},
						{ label: "Re-check", action: "recheck" },
					],
		});
	}

	return results;
}
