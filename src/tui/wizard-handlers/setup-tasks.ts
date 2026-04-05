// ── Setup wizard task handlers — 8 phases of HISE installation ───────
//
// Each factory takes a PhaseExecutor and returns an InternalTaskHandler.
// Platform-specific commands derived from docs/LEGACY_SETUP_SCRIPTS.md.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function ok(message: string, logs?: string[]): WizardExecResult {
	return { success: true, message, logs };
}

function fail(message: string, logs?: string[]): WizardExecResult {
	return { success: false, message, logs };
}

// ── 1. Git install ───────────────────────────────────────────────────

export function createSetupGitInstallHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		if (answers.hasGit === "1") {
			onProgress({ phase: "git-install", percent: 100, message: "Git already installed, skipping." });
			return ok("Git already installed.");
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
			return ok("Git installed.");
		}

		// Windows — winget or direct download
		const winget = await executor.spawn("winget", ["install", "Git.Git", "--accept-package-agreements", "--accept-source-agreements"], {
			onLog: (line) => onProgress({ phase: "git-install", message: line }),
		});
		if (winget.exitCode === 0) return ok("Git installed via winget.");
		return fail("Git installation failed. Please install Git manually from https://git-scm.com");
	};
}

// ── 2. Clone repo ────────────────────────────────────────────────────

export function createSetupCloneRepoHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
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
		return ok("Repository cloned and configured.");
	};
}

// ── 3. Build deps (Linux only) ───────────────────────────────────────

export function createSetupBuildDepsHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		if (answers.platform !== "Linux") {
			onProgress({ phase: "build-deps", percent: 100, message: "Skipping (not Linux)." });
			return ok("Build dependencies not needed on this platform.");
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
		return ok("Build dependencies installed.");
	};
}

// ── 4. Faust install ─────────────────────────────────────────────────

export function createSetupFaustInstallHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		if (answers.includeFaust !== "1") {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust not requested, skipping." });
			return ok("Faust installation skipped.");
		}
		if (answers.hasFaust === "1") {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust already installed, skipping." });
			return ok("Faust already installed.");
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
			return ok("Faust installed.");
		}

		// macOS / Windows — guide user to manual install for now
		return fail(
			`Automatic Faust installation is not yet supported on ${platform}. ` +
			"Please install from https://faust.grame.fr/downloads/ and re-run the wizard.",
		);
	};
}

// ── 5. Extract SDKs ─────────────────────────────────────────────────

export function createSetupExtractSdksHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		const installPath = answers.installPath!;
		const sdkDir = `${installPath}/tools/SDK`;

		onProgress({ phase: "extract-sdks", percent: 0, message: "Extracting SDK files..." });

		const check = await executor.spawn("ls", ["-d", `${sdkDir}/ASIOSDK2.3`], {});
		if (check.exitCode === 0) {
			onProgress({ phase: "extract-sdks", percent: 100, message: "SDKs already extracted." });
			return ok("SDKs already extracted.");
		}

		const result = await executor.spawn("tar", ["-xf", "sdk.zip"], { cwd: sdkDir });
		if (result.exitCode !== 0) return fail(`SDK extraction failed: ${result.stderr}`);

		onProgress({ phase: "extract-sdks", percent: 100 });
		return ok("SDKs extracted.");
	};
}

// ── 6. Compile ───────────────────────────────────────────────────────

export function createSetupCompileHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";
		const includeFaust = answers.includeFaust === "1";

		const buildConfig = platform === "Linux"
			? (includeFaust ? "ReleaseWithFaust" : "Release")
			: (includeFaust ? "Release with Faust" : "Release");

		onProgress({ phase: "compile", percent: 0, message: "Running Projucer resave..." });

		// Projucer resave
		const jucerFile = `${installPath}/projects/standalone/HISE Standalone.jucer`;
		let projucerPath: string;
		if (platform === "macOS") {
			projucerPath = `${installPath}/JUCE/Projucer/Projucer.app/Contents/MacOS/Projucer`;
		} else if (platform === "Linux") {
			projucerPath = `${installPath}/JUCE/Projucer/Projucer`;
		} else {
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
				onLog: (line) => onProgress({ phase: "compile", message: line }),
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
			// Windows — MSBuild
			return fail("Windows compilation not yet implemented. Use Visual Studio to build manually.");
		}

		onProgress({ phase: "compile", percent: 100, message: "Compilation complete." });
		return ok("HISE compiled successfully.");
	};
}

// ── 7. Add to PATH ───────────────────────────────────────────────────

export function createSetupAddPathHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
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
			return ok("Add the HISE build directory to your PATH manually.");
		}

		// Detect shell config
		const shell = process.env.SHELL ?? "/bin/bash";
		const shellConfig = shell.includes("zsh") ? `${process.env.HOME}/.zshrc` : `${process.env.HOME}/.bashrc`;

		const exportLine = `export PATH="$PATH:${binPath}"`;
		const result = await executor.spawn("bash", ["-c", `echo '${exportLine}' >> "${shellConfig}"`], {});
		if (result.exitCode !== 0) return fail(`Failed to update ${shellConfig}: ${result.stderr}`);

		onProgress({ phase: "add-path", percent: 100 });
		return ok(`Added HISE to PATH in ${shellConfig}. Restart your shell or run: source ${shellConfig}`);
	};
}

// ── 8. Verify ────────────────────────────────────────────────────────

export function createSetupVerifyHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress) => {
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";

		onProgress({ phase: "verify", percent: 0, message: "Verifying HISE binary..." });

		let binPath: string;
		if (platform === "macOS") {
			binPath = `${installPath}/projects/standalone/Builds/MacOSX/build/Release/HISE Standalone.app/Contents/MacOS/HISE Standalone`;
		} else if (platform === "Linux") {
			binPath = `${installPath}/projects/standalone/Builds/LinuxMakefile/build/HISE Standalone`;
		} else {
			binPath = `${installPath}\\projects\\standalone\\Builds\\VisualStudio2022\\x64\\Release\\App\\HISE.exe`;
		}

		const check = await executor.spawn("ls", ["-la", binPath], {});
		if (check.exitCode !== 0) {
			return fail(`HISE binary not found at ${binPath}`);
		}

		const flags = await executor.spawn(binPath, ["get_build_flags"], {
			onLog: (line) => onProgress({ phase: "verify", message: line }),
		});
		const logs = flags.stdout.trim() ? [flags.stdout.trim()] : undefined;

		onProgress({ phase: "verify", percent: 100, message: "HISE verified successfully." });
		return ok("HISE binary verified.", logs);
	};
}
