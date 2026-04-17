// ── Setup wizard task handlers — 8 phases of HISE installation ───────
//
// Each factory takes a PhaseExecutor and returns an InternalTaskHandler.
// Platform-specific commands derived from docs/LEGACY_SETUP_SCRIPTS.md.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

import type { SpawnOptions } from "../../engine/wizard/phase-executor.js";

/** Create a spawn wrapper that injects signal into every call. */
function withSignal(
	executor: PhaseExecutor,
	signal?: AbortSignal,
): PhaseExecutor {
	if (!signal) return executor;
	return {
		spawn: (cmd, args, opts) => executor.spawn(cmd, args, { ...opts, signal }),
	};
}

function ok(message: string, logs?: string[]): WizardExecResult {
	return { success: true, message, logs };
}

function fail(message: string, logs?: string[]): WizardExecResult {
	return { success: false, message, logs };
}

/** Detect noise lines from curl / winget that would otherwise flood the log
 *  4x/sec during multi-minute downloads. Keeps anything with real text,
 *  drops progress bars, spinner chars, and pure size/percentage tickers. */
function isProgressNoise(line: string): boolean {
	const t = line.trim();
	if (t === "") return true;
	// winget spinner: single /|\- char
	if (/^[/|\\\-]$/.test(t)) return true;
	// Progress bar: block shading + digits + percent + vertical bars only
	if (/^[█▒░▓│─\s\d%.]+$/.test(t)) return true;
	// curl's progress table rows: only digits, dashes, colons, slashes, %, k/M/G/B
	if (/^[\s\d:.\-%/kMGBbtoalD]+$/.test(t) && !/[a-z]{3,}/i.test(t)) return true;
	// Pure size readouts like "2.00 MB / 2.83 MB"
	if (/^[\s\d.]+(MB|KB|GB|B)\s*\/\s*[\d.]+\s*(MB|KB|GB|B)\s*$/i.test(t)) return true;
	return false;
}

// ── 1. Git install ───────────────────────────────────────────────────

export function createSetupGitInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		if (answers.hasGit === "1") {
			onProgress({ phase: "git-install", percent: 100, message: "Git already installed, skipping." });
			return ok("✓ Git already installed.");
		}

		const platform = answers.platform ?? "Linux";
		onProgress({ phase: "git-install", percent: 0, message: "Installing git..." });

		if (platform === "macOS") {
			return fail("Git is not installed. Please run: xcode-select --install");
		}

		if (platform === "Linux") {
			const result = await executor.spawn("sudo", ["apt-get", "install", "-y", "git"], {
				onLog: (line) => onProgress({ phase: "git-install", message: line }),
			});
			if (result.exitCode !== 0) return fail(`Git installation failed: ${result.stderr}`);
			return ok("✓ Git installed.");
		}

		// Windows — winget or direct download
		const winget = await executor.spawn("winget", ["install", "Git.Git", "--accept-package-agreements", "--accept-source-agreements"], {
			onLog: (line) => onProgress({ phase: "git-install", message: line }),
		});
		if (winget.exitCode === 0) return ok("✓ Git installed via winget.");
		return fail("Git installation failed. Please install Git manually from https://git-scm.com");
	};
}

// ── 2. Clone repo ────────────────────────────────────────────────────

export function createSetupCloneRepoHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const targetCommit = answers.targetCommit?.trim() || "";

		onProgress({ phase: "clone-repo", percent: 0, message: "Cloning HISE repository..." });

		// Clone or fetch
		const gitCheck = await executor.spawn("git", ["-C", installPath, "status"], {});
		if (gitCheck.exitCode !== 0) {
			// Fresh clone
			const clone = await executor.spawn("git", ["clone", "https://github.com/christophhart/HISE.git", installPath], {
				onLog: (line) => onProgress({ phase: "clone-repo", message: line }),
			});
			if (clone.exitCode !== 0) return fail(`Git clone failed: ${clone.stderr}`);
		} else {
			// Existing repo — fetch
			onProgress({ phase: "clone-repo", message: "Repository exists, fetching updates..." });
			await executor.spawn("git", ["-C", installPath, "fetch", "origin"], {
				onLog: (line) => onProgress({ phase: "clone-repo", message: line }),
			});
		}

		// Checkout
		if (targetCommit) {
			const checkout = await executor.spawn("git", ["-C", installPath, "checkout", targetCommit], {});
			if (checkout.exitCode !== 0) return fail(`Checkout of ${targetCommit} failed: ${checkout.stderr}`);
		} else {
			await executor.spawn("git", ["-C", installPath, "checkout", "develop"], {});
			await executor.spawn("git", ["-C", installPath, "pull", "origin", "develop"], {
				onLog: (line) => onProgress({ phase: "clone-repo", message: line }),
			});
		}

		onProgress({ phase: "clone-repo", percent: 80, message: "Initialising submodules..." });

		// Submodules
		await executor.spawn("git", ["-C", installPath, "submodule", "update", "--init"], {
			onLog: (line) => onProgress({ phase: "clone-repo", message: line }),
		});

		// JUCE checkout
		const juceDir = `${installPath}/JUCE`;
		await executor.spawn("git", ["-C", juceDir, "checkout", "juce6"], {});

		onProgress({ phase: "clone-repo", percent: 100 });
		return ok("✓ Repository cloned and configured.");
	};
}

// ── 3. Build deps (Linux only) ───────────────────────────────────────

export function createSetupBuildDepsHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		if (answers.platform !== "Linux") {
			onProgress({ phase: "build-deps", percent: 100, message: "Skipping (not Linux)." });
			return ok("✓ Build dependencies not needed on this platform.");
		}

		onProgress({ phase: "build-deps", percent: 0, message: "Installing build dependencies..." });

		const packages = [
			"build-essential", "make", "llvm", "clang",
			"libfreetype6-dev", "libx11-dev", "libxinerama-dev",
			"libxrandr-dev", "libxcursor-dev", "mesa-common-dev",
			"libasound2-dev", "freeglut3-dev", "libxcomposite-dev",
			"libcurl4-gnutls-dev", "libgtk-3-dev", "libjack-jackd2-dev",
			"libwebkit2gtk-4.0-dev", "libpthread-stubs0-dev", "ladspa-sdk",
		];

		const result = await executor.spawn("sudo", ["apt-get", "install", "-y", ...packages], {
			onLog: (line) => onProgress({ phase: "build-deps", message: line }),
		});

		if (result.exitCode !== 0) return fail(`Dependency installation failed: ${result.stderr}`);
		return ok("✓ Build dependencies installed.");
	};
}

// ── 4. Faust install ─────────────────────────────────────────────────

export function createSetupFaustInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		if (answers.includeFaust !== "1") {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust not requested, skipping." });
			return ok("✓ Faust installation skipped.");
		}
		if (answers.hasFaust === "1") {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust already installed, skipping." });
			return ok("✓ Faust already installed.");
		}

		const platform = answers.platform ?? "Linux";
		onProgress({ phase: "faust-install", percent: 0, message: "Installing Faust..." });

		if (platform === "Linux") {
			const result = await executor.spawn("sudo", ["apt-get", "install", "-y", "faust", "libfaust-dev"], {
				onLog: (line) => onProgress({ phase: "faust-install", message: line }),
			});
			if (result.exitCode !== 0) {
				return fail("Faust installation failed. Install manually from https://faust.grame.fr");
			}
			return ok("✓ Faust installed.");
		}

		// macOS / Windows — guide user to manual install for now
		return fail(
			`Automatic Faust installation is not yet supported on ${platform}. ` +
			"Please install from https://faust.grame.fr/downloads/ and re-run the wizard.",
		);
	};
}

// ── 5. Extract SDKs ─────────────────────────────────────────────────

export function createSetupExtractSdksHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const sdkDir = `${installPath}/tools/SDK`;

		onProgress({ phase: "extract-sdks", percent: 0, message: "Extracting SDK files..." });

		const check = await executor.spawn("ls", ["-d", `${sdkDir}/ASIOSDK2.3`], {});
		if (check.exitCode === 0) {
			onProgress({ phase: "extract-sdks", percent: 100, message: "SDKs already extracted." });
			return ok("✓ SDKs already extracted.");
		}

		const result = await executor.spawn("tar", ["-xf", "sdk.zip"], { cwd: sdkDir });
		if (result.exitCode !== 0) return fail(`SDK extraction failed: ${result.stderr}`);

		onProgress({ phase: "extract-sdks", percent: 100 });
		return ok("✓ SDKs extracted.");
	};
}

// ── xcodebuild output filter ─────────────────────────────────────────

export function filterXcodeLine(line: string): string | null {
	const compileMatch = line.match(/^Compile[\w]*\s+.*\/([\w.]+)\s/);
	if (compileMatch) return `Compiling ${compileMatch[1]}`;

	const ldMatch = line.match(/^Ld\s+.*\/([\w. ]+)\s/);
	if (ldMatch) return `Linking ${ldMatch[1]}`;

	if (line.startsWith("PhaseScriptExecution")) return line.split(/\s+/)[1] ?? line;
	if (line.startsWith("ProcessInfoPlistFile")) return "Processing Info.plist";
	if (/^=== BUILD TARGET/.test(line)) return line;

	// Errors — broad matching to avoid filtering out important messages
	if (/error:/i.test(line)) return `✗ ${line}`;
	if (/\bfailed\b/i.test(line)) return `✗ ${line}`;
	if (/\bundefined symbols?\b/i.test(line)) return `✗ ${line}`;
	if (/\blinker command failed\b/i.test(line)) return `✗ ${line}`;

	if (/warning:/i.test(line)) return `⚠ ${line}`;

	if (line.startsWith("** BUILD SUCCEEDED **")) return `✓ ${line}`;
	if (line.startsWith("** BUILD FAILED **")) return `✗ ${line}`;

	return null;
}

// ── 5b. Visual Studio 2026 check (Windows only) ──────────────────────
//
// We intentionally do not script the VS install. The bootstrapper URL
// for VS 2026 isn't discoverable from a static page, the winget catalog
// behaviour around "already installed" is unreliable, the download is
// 8+ GB, and elevation requirements vary. A clear set of manual steps
// is more honest than a fragile auto-install.

export function createSetupVsInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, _signal) => {
		const platform = answers.platform ?? "Linux";

		if (platform !== "Windows") {
			onProgress({ phase: "vs-install", percent: 100, message: "Skipping (not Windows)." });
			return ok("✓ Visual Studio installation not needed on this platform.");
		}
		if (answers.hasVs === "1") {
			onProgress({ phase: "vs-install", percent: 100, message: "Visual Studio already installed, skipping." });
			return ok("✓ Visual Studio already installed.");
		}

		onProgress({ phase: "vs-install", message: "" });
		onProgress({ phase: "vs-install", message: "Visual Studio 2026 Community is required to compile HISE on Windows." });
		onProgress({ phase: "vs-install", message: "" });
		onProgress({ phase: "vs-install", message: "  1. Download from: https://visualstudio.microsoft.com/vs/community/" });
		onProgress({ phase: "vs-install", message: "  2. In the installer, select the workload:" });
		onProgress({ phase: "vs-install", message: "       • Desktop development with C++" });
		onProgress({ phase: "vs-install", message: "  3. Confirm these components are checked under that workload:" });
		onProgress({ phase: "vs-install", message: "       • MSVC v144 — VS 2026 C++ x64/x86 build tools (latest)" });
		onProgress({ phase: "vs-install", message: "       • Windows 11 SDK (latest)" });
		onProgress({ phase: "vs-install", message: "  4. After installation finishes, re-run /setup." });
		onProgress({ phase: "vs-install", message: "" });
		return fail("Visual Studio 2026 Community not installed — see instructions above.");
	};
}

// ── 5c. Intel IPP install (Windows only) ─────────────────────────────

const IPP_INSTALLER_URL =
	"https://registrationcenter-download.intel.com/akdlm/IRC_NAS/9c651894-4548-491c-b69f-49e84b530c1d/intel-ipp-2022.3.1.10_offline.exe";

/** Escape a string for a single-quoted PowerShell literal. */
function psQuote(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}

export function createSetupIppInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const platform = answers.platform ?? "Linux";

		if (platform !== "Windows" || answers.includeIpp !== "1") {
			onProgress({ phase: "ipp-install", percent: 100, message: "Skipping Intel IPP." });
			return ok("✓ Intel IPP installation skipped.");
		}
		if (answers.hasIpp === "1") {
			onProgress({ phase: "ipp-install", percent: 100, message: "Intel IPP already installed, skipping." });
			return ok("✓ Intel IPP already installed.");
		}

		onProgress({ phase: "ipp-install", percent: 0, message: "Downloading Intel IPP (~800 MB)..." });

		const tmpDir = process.env.TEMP ?? process.env.TMP ?? "C:\\Windows\\Temp";
		const installer = `${tmpDir}\\intel-ipp-installer.exe`;
		const download = await executor.spawn(
			"curl",
			["-L", "-o", installer, IPP_INSTALLER_URL],
			{ onLog: (line) => {
				if (!isProgressNoise(line)) onProgress({ phase: "ipp-install", message: line });
			} },
		);
		if (download.exitCode !== 0) return fail(`Intel IPP download failed: ${download.stderr}`);

		onProgress({ phase: "ipp-install", percent: 50, message: "Installing Intel IPP (approve the UAC prompt)..." });

		// The IPP installer has requireAdministrator in its manifest —
		// Start-Process -Verb RunAs triggers UAC so it can elevate.
		const installerArgs = ["-s", "-a", "--silent", "--eula", "accept"];
		const psArgList = installerArgs.map(psQuote).join(",");
		const psCmd = `$p = Start-Process -FilePath ${psQuote(installer)} -ArgumentList @(${psArgList}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
		const install = await executor.spawn("powershell", [
			"-NoProfile",
			"-ExecutionPolicy", "Bypass",
			"-Command", psCmd,
		], {
			onLog: (line) => onProgress({ phase: "ipp-install", message: line }),
		});
		if (install.exitCode !== 0) return fail(`Intel IPP installation failed: ${install.stderr || install.stdout}`);

		onProgress({ phase: "ipp-install", percent: 100 });
		return ok("✓ Intel IPP installed.");
	};
}

// ── 6. Compile ───────────────────────────────────────────────────────

export function createSetupCompileHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";
		const includeFaust = answers.includeFaust === "1";

		const buildConfig = platform === "Linux"
			? (includeFaust ? "ReleaseWithFaust" : "Release")
			: (includeFaust ? "Release with Faust" : "Release");

		onProgress({ phase: "compile", percent: 0, message: "Running Projucer resave..." });

		// Projucer resave
		let jucerFile: string;
		let projucerPath: string;
		if (platform === "macOS") {
			jucerFile = `${installPath}/projects/standalone/HISE Standalone.jucer`;
			projucerPath = `${installPath}/JUCE/Projucer/Projucer.app/Contents/MacOS/Projucer`;
		} else if (platform === "Linux") {
			jucerFile = `${installPath}/projects/standalone/HISE Standalone.jucer`;
			projucerPath = `${installPath}/JUCE/Projucer/Projucer`;
		} else {
			jucerFile = `${installPath}\\projects\\standalone\\HISE Standalone.jucer`;
			projucerPath = `${installPath}\\JUCE\\Projucer\\Projucer.exe`;
		}

		const resave = await executor.spawn(projucerPath, ["--resave", jucerFile], {
			onLog: (line) => onProgress({ phase: "compile", message: line }),
		});
		if (resave.exitCode !== 0) return fail(`Projucer resave failed: ${resave.stderr}`);

		onProgress({ phase: "compile", percent: 10, message: `Compiling (${buildConfig})...` });

		// Platform-specific build
		if (platform === "macOS") {
			const xcodeproj = `${installPath}/projects/standalone/Builds/MacOSX/HISE Standalone.xcodeproj`;
			const result = await executor.spawn("xcodebuild", [
				"-project", xcodeproj,
				"-configuration", buildConfig,
				"-jobs", "8",
			], {
				onLog: (line) => {
					const filtered = filterXcodeLine(line);
					if (filtered) onProgress({ phase: "compile", message: filtered });
				},
			});
			if (result.exitCode !== 0) return fail(`Compilation failed: ${result.stderr}`);
		} else if (platform === "Linux") {
			const makeDir = `${installPath}/projects/standalone/Builds/LinuxMakefile`;
			const result = await executor.spawn("make", [`CONFIG=${buildConfig}`, "AR=gcc-ar", "-j8"], {
				cwd: makeDir,
				onLog: (line) => onProgress({ phase: "compile", message: line }),
			});
			if (result.exitCode !== 0) return fail(`Compilation failed: ${result.stderr}`);
		} else {
			// Windows — MSBuild against VS 2026 Community
			const msbuild = "C:\\Program Files\\Microsoft Visual Studio\\18\\Community\\MSBuild\\Current\\Bin\\MsBuild.exe";
			const sln = `${installPath}\\projects\\standalone\\Builds\\VisualStudio2026\\HISE Standalone.sln`;
			const config = includeFaust ? "Release with Faust" : "Release";
			const result = await executor.spawn(msbuild, [
				sln,
				`/p:Configuration=${config}`,
				"/p:Platform=x64",
				"/verbosity:minimal",
			], {
				env: { PreferredToolArchitecture: "x64" },
				onLog: (line) => onProgress({ phase: "compile", message: line }),
			});
			if (result.exitCode !== 0) return fail(`Compilation failed: ${result.stderr}`);
		}

		onProgress({ phase: "compile", percent: 100, message: "Compilation complete." });
		return ok("✓ HISE compiled successfully.");
	};
}

// ── 7. Add to PATH ───────────────────────────────────────────────────

export function createSetupAddPathHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";

		onProgress({ phase: "add-path", percent: 0, message: "Adding HISE to PATH..." });

		let binPath: string;
		if (platform === "macOS") {
			binPath = `${installPath}/projects/standalone/Builds/MacOSX/build/Release`;
		} else if (platform === "Linux") {
			binPath = `${installPath}/projects/standalone/Builds/LinuxMakefile/build`;
		} else {
			// Windows handled via environment variable
			onProgress({ phase: "add-path", percent: 100, message: "PATH update skipped (manual on Windows)." });
			return ok("✓ Add the HISE build directory to your PATH manually.");
		}

		// Detect shell config
		const shell = process.env.SHELL ?? "/bin/bash";
		const shellConfig = shell.includes("zsh") ? `${process.env.HOME}/.zshrc` : `${process.env.HOME}/.bashrc`;

		const exportLine = `export PATH="$PATH:${binPath}"`;
		const result = await executor.spawn("bash", ["-c", `echo '${exportLine}' >> "${shellConfig}"`], {});
		if (result.exitCode !== 0) return fail(`Failed to update ${shellConfig}: ${result.stderr}`);

		onProgress({ phase: "add-path", percent: 100 });
		return ok(`✓ Added HISE to PATH in ${shellConfig}. Restart your shell or run: source ${shellConfig}`);
	};
}

// ── HISE binary path helper ───────────────────────────────────────────

function hiseBinPath(installPath: string, platform: string): string {
	if (platform === "macOS") {
		return `${installPath}/projects/standalone/Builds/MacOSX/build/Release/HISE.app/Contents/MacOS/HISE`;
	} else if (platform === "Linux") {
		return `${installPath}/projects/standalone/Builds/LinuxMakefile/build/HISE Standalone`;
	}
	return `${installPath}\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\Release\\App\\HISE.exe`;
}

// ── 8. Verify ────────────────────────────────────────────────────────

export function createSetupVerifyHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";

		onProgress({ phase: "verify", percent: 0, message: "Verifying HISE binary..." });

		const binPath = hiseBinPath(installPath, platform);

		const check = await executor.spawn("ls", ["-la", binPath], {});
		if (check.exitCode !== 0) {
			return fail(`HISE binary not found at ${binPath}`);
		}

		const flags = await executor.spawn(binPath, ["get_build_flags"], {
			onLog: (line) => onProgress({ phase: "verify", message: line }),
		});
		const logs = flags.stdout.trim() ? [flags.stdout.trim()] : undefined;

		onProgress({ phase: "verify", percent: 100, message: "HISE verified successfully." });
		return ok("✓ HISE binary verified.", logs);
	};
}

// ── 9. Test export ───────────────────────────────────────────────────

export function createSetupTestHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";
		const arch = answers.architecture ?? "x64";
		const binPath = hiseBinPath(installPath, platform);
		const demoProject = `${installPath}/extras/demo_project`;

		onProgress({ phase: "test", percent: 0, message: "Setting project folder..." });

		const setFolder = await executor.spawn(binPath, [
			"set_project_folder", `-p:${demoProject}`,
		], {
			onLog: (line) => onProgress({ phase: "test", message: line }),
		});
		if (setFolder.exitCode !== 0) return fail(`set_project_folder failed: ${setFolder.stderr}`);

		onProgress({ phase: "test", percent: 20, message: "Exporting demo project..." });

		const exportCi = await executor.spawn(binPath, [
			"export_ci", "XmlPresetBackups/Demo.xml",
			"-t:standalone", `-a:${arch}`, "-nolto",
		], {
			cwd: demoProject,
			onLog: (line) => onProgress({ phase: "test", message: line }),
		});
		if (exportCi.exitCode !== 0) return fail(`export_ci failed: ${exportCi.stderr}`);

		onProgress({ phase: "test", percent: 50, message: "Compiling demo project..." });

		let batchScript: string;
		if (platform === "macOS") {
			batchScript = `${demoProject}/Binaries/batchCompileOSX`;
		} else if (platform === "Linux") {
			batchScript = `${demoProject}/Binaries/batchCompileLinux`;
		} else {
			batchScript = `${demoProject}\\Binaries\\batchCompile.bat`;
		}

		// Strip the xcbeautify pipe from the batch script so we get raw
		// xcodebuild output through our own filterXcodeLine instead
		const scriptContent = await executor.spawn("cat", [batchScript], {});
		const patchedScript = scriptContent.stdout.replace(/\s*\|\s*"[^"]*xcbeautify"/, "");
		const compile = await executor.spawn("bash", ["-c", patchedScript], {
			cwd: `${demoProject}/Binaries`,
			onLog: (line) => {
				const filtered = filterXcodeLine(line);
				if (filtered) onProgress({ phase: "test", message: filtered });
			},
		});
		if (compile.exitCode !== 0) return fail(`Demo project compilation failed: ${compile.stderr}`);

		onProgress({ phase: "test", percent: 100 });
		return ok("✓ Demo project exported and compiled successfully.");
	};
}
