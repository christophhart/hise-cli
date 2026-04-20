// ── Setup wizard task handlers — 8 phases of HISE installation ───────
//
// Each factory takes a PhaseExecutor and returns an InternalTaskHandler.
// Platform-specific commands derived from docs/LEGACY_SETUP_SCRIPTS.md.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";
import { isOn } from "../../engine/wizard/types.js";
import { runJuceCompile } from "./project-compile.js";

// ── Helpers ──────────────────────────────────────────────────────────

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

/** True when the current process has administrator rights on Windows.
 *  `net session` is the cheapest documented way to probe: it succeeds
 *  only in an elevated token, fails with exitCode 2 otherwise. */
async function requireWindowsElevation(executor: PhaseExecutor): Promise<boolean> {
	const r = await executor.spawn("net", ["session"], {});
	return r.exitCode === 0;
}

/** True when macOS `xcode-select -p` resolves — invoking developer-tool
 *  stubs (git, clang) is safe and won't pop the CLT install dialog. */
async function hasDevDir(executor: PhaseExecutor): Promise<boolean> {
	const sel = await executor.spawn("xcode-select", ["-p"], {});
	return sel.exitCode === 0 && sel.stdout.trim().length > 0;
}

/** Runtime faust probe — mirrors detectFaust in setup-detect.ts. Kept
 *  inline rather than imported to avoid the handler depending on the
 *  init handler's module. */
async function reprobeFaust(
	executor: PhaseExecutor,
	platform: string,
	installPath: string,
): Promise<boolean> {
	if (platform === "Windows") {
		const global = await executor.spawn(
			"cmd",
			["/c", "if exist \"C:\\Program Files\\Faust\\lib\\faust.dll\" echo found"],
			{},
		);
		if (global.stdout.includes("found")) return true;
		if (!installPath) return false;
		const local = `${installPath}\\tools\\faust\\lib\\libfaust.dll`;
		const localCheck = await executor.spawn("cmd", ["/c", `if exist "${local}" echo found`], {});
		return localCheck.stdout.includes("found");
	}
	const onPath = await executor.spawn("faust", ["--version"], {});
	if (onPath.exitCode === 0) return true;
	if (!installPath) return false;
	const ext = platform === "macOS" ? "dylib" : "so";
	const local = `${installPath}/tools/faust/lib/libfaust.${ext}`;
	const localCheck = await executor.spawn("test", ["-f", local], {});
	return localCheck.exitCode === 0;
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
		const platform = answers.platform ?? "Linux";

		// Re-probe git — answers.hasGit is a snapshot from wizard init and
		// can be stale after /resume (e.g. Command Line Tools just landed
		// and now provide git, or winget installed git in a previous run).
		// On macOS, skip the probe when no developer dir is set — the
		// /usr/bin/git stub would pop the CLT install dialog.
		const canProbeGit = platform !== "macOS" || await hasDevDir(executor);
		if (canProbeGit) {
			const probe = await executor.spawn("git", ["--version"], {});
			if (probe.exitCode === 0) {
				onProgress({ phase: "git-install", percent: 100, message: "Git detected, skipping install." });
				return ok("✓ Git detected.");
			}
		}

		onProgress({ phase: "git-install", percent: 0, message: "Installing git..." });

		if (platform === "macOS") {
			// CLT provides git. If we get here, compilerInstall should have
			// already installed CLT. Hint the user at the resume flow.
			return fail("Git not found. Install Command Line Tools (xcode-select --install) then /resume.");
		}

		if (platform === "Linux") {
			const result = await executor.spawn("sudo", ["apt-get", "install", "-y", "git"], {
				onLog: (line, transient) => onProgress({ phase: "git-install", message: line, transient }),
			});
			if (result.exitCode !== 0) return fail(`Git installation failed: ${result.stderr}`);
			return ok("✓ Git installed.");
		}

		// Windows — winget or direct download
		const winget = await executor.spawn("winget", ["install", "Git.Git", "--accept-package-agreements", "--accept-source-agreements"], {
			onLog: (line, transient) => onProgress({ phase: "git-install", message: line, transient }),
		});
		if (winget.exitCode === 0) {
			// winget updates the system PATH registry, but the current Node
			// process keeps its launch-time PATH. Prepend the default install
			// location so later phases (clone, submodule init) can find git.
			const gitDirs = ["C:\\Program Files\\Git\\cmd", "C:\\Program Files (x86)\\Git\\cmd"];
			const existing = process.env.PATH ?? "";
			const missing = gitDirs.filter((d) => !existing.toLowerCase().includes(d.toLowerCase()));
			if (missing.length > 0) process.env.PATH = `${missing.join(";")};${existing}`;
			return ok("✓ Git installed via winget.");
		}
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
				onLog: (line, transient) => onProgress({ phase: "clone-repo", message: line, transient }),
			});
			if (clone.exitCode !== 0) return fail(`Git clone failed: ${clone.stderr}`);
		} else {
			// Existing repo — fetch
			onProgress({ phase: "clone-repo", message: "Repository exists, fetching updates..." });
			await executor.spawn("git", ["-C", installPath, "fetch", "origin"], {
				onLog: (line, transient) => onProgress({ phase: "clone-repo", message: line, transient }),
			});
		}

		// Checkout
		if (targetCommit) {
			const checkout = await executor.spawn("git", ["-C", installPath, "checkout", targetCommit], {});
			if (checkout.exitCode !== 0) return fail(`Checkout of ${targetCommit} failed: ${checkout.stderr}`);
		} else {
			await executor.spawn("git", ["-C", installPath, "checkout", "develop"], {});
			await executor.spawn("git", ["-C", installPath, "pull", "origin", "develop"], {
				onLog: (line, transient) => onProgress({ phase: "clone-repo", message: line, transient }),
			});
		}

		onProgress({ phase: "clone-repo", percent: 80, message: "Initialising submodules..." });

		// Submodules
		await executor.spawn("git", ["-C", installPath, "submodule", "update", "--init"], {
			onLog: (line, transient) => onProgress({ phase: "clone-repo", message: line, transient }),
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
			onLog: (line, transient) => onProgress({ phase: "build-deps", message: line, transient }),
		});

		if (result.exitCode !== 0) return fail(`Dependency installation failed: ${result.stderr}`);
		return ok("✓ Build dependencies installed.");
	};
}

// ── 4. Faust install ─────────────────────────────────────────────────

/** Pinned Faust release — bump when GRAME publishes a newer one. */
const FAUST_VERSION = "2.81.2";

export function createSetupFaustInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		if (!isOn(answers.includeFaust)) {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust not requested, skipping." });
			return ok("✓ Faust installation skipped.");
		}

		const platform = answers.platform ?? "Linux";
		const installPath = answers.installPath ?? "";

		// Re-probe faust so a stale hasFaust=0 (from init) doesn't trigger
		// a redundant install when the user manually installed between runs.
		if (await reprobeFaust(executor, platform, installPath)) {
			onProgress({ phase: "faust-install", percent: 100, message: "Faust detected, skipping install." });
			return ok("✓ Faust detected.");
		}

		onProgress({ phase: "faust-install", percent: 0, message: "Installing Faust..." });

		if (platform === "Linux") {
			const result = await executor.spawn("sudo", ["apt-get", "install", "-y", "faust", "libfaust-dev"], {
				onLog: (line, transient) => onProgress({ phase: "faust-install", message: line, transient }),
			});
			if (result.exitCode !== 0) {
				return fail("Faust installation failed. Install manually from https://faust.grame.fr");
			}
			return ok("✓ Faust installed.");
		}

		if (platform === "Windows") {
			if (!(await requireWindowsElevation(executor))) {
				return fail(
					"Faust install needs admin privileges. " +
					"Restart the terminal as administrator, then re-run: hise setup.",
				);
			}

			const tmpDir = process.env.TEMP ?? "C:\\Windows\\Temp";
			const installer = `${tmpDir}\\faust-installer.exe`;
			const url = `https://github.com/grame-cncm/faust/releases/download/${FAUST_VERSION}/Faust-${FAUST_VERSION}-win64.exe`;

			onProgress({ phase: "faust-install", percent: 0, message: `Downloading Faust ${FAUST_VERSION}...` });
			const dl = await executor.spawn("curl", ["-L", "-o", installer, url], {
				onLog: (line, transient) => {
					if (!isProgressNoise(line)) onProgress({ phase: "faust-install", message: line, transient });
				},
			});
			if (dl.exitCode !== 0) return fail(`Faust download failed: ${dl.stderr}`);

			onProgress({ phase: "faust-install", percent: 50, message: "Installing Faust..." });
			// NSIS installer. /S = silent, /D=<path> = install dir — MUST be
			// the last arg, unquoted, per NSIS convention.
			const inst = await executor.spawn(installer, ["/S", "/D=C:\\Program Files\\Faust"], {
				onLog: (line, transient) => onProgress({ phase: "faust-install", message: line, transient }),
			});
			if (inst.exitCode !== 0) return fail(`Faust install failed: ${inst.stderr}`);

			// Inject bin dir into this Node process's PATH so any downstream
			// phase that calls `faust` resolves it without a terminal restart.
			const faustBin = "C:\\Program Files\\Faust\\bin";
			const existing = process.env.PATH ?? "";
			if (!existing.toLowerCase().includes(faustBin.toLowerCase())) {
				process.env.PATH = `${existing.replace(/;$/, "")};${faustBin}`;
			}
			onProgress({ phase: "faust-install", percent: 100 });
			return ok("✓ Faust installed.");
		}

		// macOS — download the architecture-specific DMG, mount it, copy
		// bin/lib/include/share into tools/faust/, unmount. Preserves the
		// existing fakelib/ stub. See HISE/tools/faust/Readme.md.
		const arch = answers.architecture === "x64" ? "x64" : "arm64";
		const tmpDir = process.env.TMPDIR ?? "/tmp";
		const dmgPath = `${tmpDir}/Faust-${FAUST_VERSION}-${arch}.dmg`;
		const url = `https://github.com/grame-cncm/faust/releases/download/${FAUST_VERSION}/Faust-${FAUST_VERSION}-${arch}.dmg`;

		onProgress({ phase: "faust-install", percent: 0, message: `Downloading Faust ${FAUST_VERSION} (${arch})...` });
		const dl = await executor.spawn("curl", ["-L", "-o", dmgPath, url], {
			onLog: (line, transient) => {
				if (!isProgressNoise(line)) onProgress({ phase: "faust-install", message: line, transient });
			},
		});
		if (dl.exitCode !== 0) return fail(`Faust download failed: ${dl.stderr}`);

		onProgress({ phase: "faust-install", percent: 50, message: "Mounting Faust DMG..." });
		// Force a known mount point (/tmp/hise-faust-mnt). Avoids parsing
		// hdiutil's tab-delimited stdout, which `-quiet` would suppress.
		const mountPoint = `${tmpDir}/hise-faust-mnt`;
		// Pre-cleanup any stale mount from a prior failed run.
		await executor.spawn("hdiutil", ["detach", "-force", mountPoint], {});
		const mount = await executor.spawn("hdiutil", [
			"attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath,
		], {});
		if (mount.exitCode !== 0) return fail(`DMG mount failed: ${mount.stderr || mount.stdout}`);

		// DMG layout: /Volumes/Faust-<VERSION>/Faust-<VERSION>/{bin,lib,include,share}
		// (versioned subfolder alongside INSTALL.html / README.html at root).
		// Defensive check — if GRAME ever flattens or switches to a .pkg,
		// fail loudly rather than silently leaving tools/faust incomplete.
		const srcRoot = `${mountPoint}/Faust-${FAUST_VERSION}`;
		const check = await executor.spawn("bash", ["-c",
			`test -d "${srcRoot}/bin" && test -d "${srcRoot}/lib" && test -d "${srcRoot}/include" && test -d "${srcRoot}/share"`,
		], {});
		if (check.exitCode !== 0) {
			await executor.spawn("hdiutil", ["detach", "-force", mountPoint], {});
			return fail(
				`Faust DMG doesn't contain the expected Faust-${FAUST_VERSION}/bin,lib,include,share layout. ` +
				"The release format may have changed; install manually from https://faust.grame.fr/downloads/.",
			);
		}

		onProgress({ phase: "faust-install", percent: 75, message: `Copying into ${installPath}/tools/faust/...` });
		const destDir = `${installPath}/tools/faust`;
		// `ditto` mirrors src → dst (overwrites cleanly, preserves xattrs);
		// cp -R would nest dirs when the target already exists.
		const copy = await executor.spawn("bash", ["-c",
			`mkdir -p "${destDir}" && ` +
			`ditto "${srcRoot}/bin" "${destDir}/bin" && ` +
			`ditto "${srcRoot}/lib" "${destDir}/lib" && ` +
			`ditto "${srcRoot}/include" "${destDir}/include" && ` +
			`ditto "${srcRoot}/share" "${destDir}/share"`,
		], {
			onLog: (line, transient) => onProgress({ phase: "faust-install", message: line, transient }),
		});

		// Always detach, regardless of copy outcome.
		await executor.spawn("hdiutil", ["detach", "-force", mountPoint], {});

		if (copy.exitCode !== 0) return fail(`Faust copy failed: ${copy.stderr}`);

		onProgress({ phase: "faust-install", percent: 100 });
		return ok(
			`✓ Faust installed at ${destDir}. ` +
			`If the build complains about unsigned Faust libs on first run, allow them via ` +
			`System Settings → Privacy & Security.`,
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

// ── MSBuild / cl.exe output filter ───────────────────────────────────
//
// Collapses the verbose MSBuild diagnostic format:
//   <abs_path>(line,col): warning C1234: "message" [<project.vcxproj>]
// into a compact two-line form:
//   ⚠ warning C1234: "message"
//      <rel_path> (line,col)
// Errors get a ✗ prefix. installPath (when provided) is stripped from
// the absolute path so the rendered location is relative to the HISE
// repo root. Localised compiler chatter lines like "(Quelldatei ... wird
// kompiliert)" and the English "(Compiling source file ...)" are dropped.
// Every other line is returned unchanged so build summary / progress
// messages still render (dimmed via the default path in app.tsx).

const MSBUILD_DIAG_RE = /^(.+?)\((\d+)(?:,(\d+))?\):\s+(warning|error)\s+([A-Z]+\d+):\s+(.+?)(?:\s*\[[^\]]+\])?\s*$/;

export function filterMsbuildLine(line: string, installPath?: string): string | null {
	// Drop localised "source file being compiled" follow-ups (German + English).
	if (/^\s*\(Quelldatei\s/.test(line)) return null;
	if (/^\s*\(Compiling source file/i.test(line)) return null;

	const m = line.match(MSBUILD_DIAG_RE);
	if (!m) return line;

	const absPath = m[1]!;
	const ln = m[2]!;
	const col = m[3] ?? "";
	const severity = m[4]!;
	const code = m[5]!;
	const msg = m[6]!;

	let rel = absPath;
	if (installPath) {
		const prefix = installPath.toLowerCase().replace(/[\\\/]+$/, "");
		if (absPath.toLowerCase().startsWith(prefix)) {
			rel = absPath.slice(prefix.length).replace(/^[\\\/]+/, "");
		}
	}
	rel = rel.replace(/\\/g, "/");

	const marker = severity === "error" ? "✗" : "⚠";
	const loc = col ? `${rel} (${ln},${col})` : `${rel} (${ln})`;
	return `${marker} ${severity} ${code}: ${msg}\n   ${loc}`;
}

// ── 5b. Compiler toolkit install (platform-dispatching) ──────────────
//
// Windows: downloads the `vs_BuildTools.exe` bootstrapper and runs an
// unattended install with the minimum component set HISE needs (MSVC
// v14x x64/x86, Windows 11 SDK, en-US language pack for English
// diagnostics).
// macOS:   probes `clang --version` (CLT-provided). If missing, spawns
// `xcode-select --install` which pops a system install dialog, then
// fails the phase with a `/resume` hint — the existing pause/resume
// infra handles the wait rather than polling here.
// Linux:   no-op. Toolchain is installed by the buildDeps task.

const VS_BUILD_TOOLS_URL = "https://aka.ms/vs/stable/vs_BuildTools.exe";

export function createSetupCompilerInstallHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const platform = answers.platform ?? "Linux";

		if (platform === "macOS") {
			onProgress({ phase: "compiler-install", percent: 0, message: "Checking Command Line Tools..." });

			// Gate probe — xcode-select -p doesn't pop the CLT install
			// dialog. Only invoke `clang` once we know the dev dir is set.
			const sel = await executor.spawn("xcode-select", ["-p"], {});
			const devDir = sel.exitCode === 0 ? sel.stdout.trim() : "";
			if (devDir) {
				const clangCheck = await executor.spawn("test", ["-x", `${devDir}/usr/bin/clang`], {});
				if (clangCheck.exitCode === 0) {
					onProgress({ phase: "compiler-install", percent: 100 });
					return ok("✓ Command Line Tools detected.");
				}
			}

			onProgress({ phase: "compiler-install", message: "Launching Command Line Tools installer..." });
			const trigger = await executor.spawn("xcode-select", ["--install"], {});
			// Exit codes: 0 = dialog shown, 1 = already installed/triggered.
			// Either way the user needs to drive the install to completion.

			// Bring the CLT installer window to the front — it opens behind
			// the terminal by default. Fire-and-forget; ignore failures.
			await executor.spawn("osascript", [
				"-e",
				'tell application "System Events" to set frontmost of every process whose name contains "Install Command Line Developer Tools" to true',
			], {});

			const lines = [
				"Command Line Tools installer launched. A system dialog should appear now.",
				"",
				"  1. Click 'Install' in the dialog.",
				"  2. Wait for the download to complete (~5–10 min).",
				"  3. Type /resume to continue the wizard.",
			];
			if (trigger.exitCode !== 0 && !trigger.stderr.includes("already installed")) {
				lines.push("", `(xcode-select exit ${trigger.exitCode}: ${trigger.stderr.trim() || "no detail"})`);
			}
			return fail(lines.join("\n"));
		}

		if (platform === "Linux") {
			onProgress({ phase: "compiler-install", percent: 100, message: "Skipping (handled by buildDeps)." });
			return ok("✓ Compiler toolkit installed by buildDeps phase.");
		}

		// Windows — re-probe via vswhere (answers.hasVs is the stale init
		// snapshot; would be wrong on /resume after a manual VS install).
		const vsProbe = await executor.spawn(
			"C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe",
			[
				"-latest",
				"-products", "*",
				"-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
				"-property", "displayName",
			],
			{},
		);
		if (vsProbe.exitCode === 0 && vsProbe.stdout.trim()) {
			onProgress({ phase: "compiler-install", percent: 100, message: "Visual Studio detected, skipping install." });
			return ok("✓ Visual Studio detected.");
		}

		if (!(await requireWindowsElevation(executor))) {
			return fail(
				"Visual Studio Build Tools install needs admin privileges. " +
				"Close the wizard, restart the terminal as administrator, then re-run: hise setup.",
			);
		}

		const tmpDir = process.env.TEMP ?? "C:\\Windows\\Temp";
		const installer = `${tmpDir}\\vs_BuildTools.exe`;

		onProgress({ phase: "compiler-install", percent: 0, message: "Downloading VS Build Tools bootstrapper..." });
		const download = await executor.spawn("curl", ["-L", "-o", installer, VS_BUILD_TOOLS_URL], {
			onLog: (line, transient) => {
				if (!isProgressNoise(line)) onProgress({ phase: "compiler-install", message: line, transient });
			},
		});
		if (download.exitCode !== 0) return fail(`VS Build Tools download failed: ${download.stderr}`);

		onProgress({ phase: "compiler-install", percent: 40, message: "Installing VS Build Tools (this can take 5–10 minutes)..." });
		const install = await executor.spawn(installer, [
			"--passive", "--wait", "--norestart", "--nocache",
			"--add", "Microsoft.VisualStudio.Workload.VCTools",
			"--add", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
			"--add", "Microsoft.VisualStudio.Component.Windows11SDK.26100",
			"--addProductLang", "en-US",
		], {
			onLog: (line, transient) => onProgress({ phase: "compiler-install", message: line, transient }),
		});
		// 3010 = installed OK, reboot requested (suppressed via --norestart).
		if (install.exitCode !== 0 && install.exitCode !== 3010) {
			return fail(`VS Build Tools install failed (exit ${install.exitCode}): ${install.stderr || install.stdout}`);
		}
		onProgress({ phase: "compiler-install", percent: 100 });
		return ok("✓ Visual Studio Build Tools installed.");
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

		if (platform !== "Windows" || !isOn(answers.includeIpp)) {
			onProgress({ phase: "ipp-install", percent: 100, message: "Skipping Intel IPP." });
			return ok("✓ Intel IPP installation skipped.");
		}

		// Re-probe; a stale answers.hasIpp=0 (from init) would otherwise
		// redo an ~800 MB install that was completed between runs.
		const ippProbe = await executor.spawn(
			"cmd",
			["/c", "if exist \"C:\\Program Files (x86)\\Intel\\oneAPI\\ipp\\latest\" echo found"],
			{},
		);
		if (ippProbe.stdout.includes("found")) {
			onProgress({ phase: "ipp-install", percent: 100, message: "Intel IPP detected, skipping install." });
			return ok("✓ Intel IPP detected.");
		}

		onProgress({ phase: "ipp-install", percent: 0, message: "Downloading Intel IPP (~800 MB)..." });

		const tmpDir = process.env.TEMP ?? process.env.TMP ?? "C:\\Windows\\Temp";
		const installer = `${tmpDir}\\intel-ipp-installer.exe`;
		const download = await executor.spawn(
			"curl",
			["-L", "-o", installer, IPP_INSTALLER_URL],
			{ onLog: (line, transient) => {
				if (!isProgressNoise(line)) onProgress({ phase: "ipp-install", message: line, transient });
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
			onLog: (line, transient) => onProgress({ phase: "ipp-install", message: line, transient }),
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
		const includeFaust = isOn(answers.includeFaust);

		// Windows MSBuild uses the spaced form; macOS + Linux Makefiles use
		// the space-free form (config names are strict string compares).
		const buildConfig = (includeFaust ? "ReleaseWithFaust" : "Release");

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
			onLog: (line, transient) => onProgress({ phase: "compile", message: line, transient }),
		});
		if (resave.exitCode !== 0) return fail(`Projucer resave failed: ${resave.stderr}`);

		onProgress({ phase: "compile", percent: 10, message: `Compiling (${buildConfig})...` });

		// Platform-specific build
		const jobs = Math.max(1, parseInt(answers.parallelJobs ?? "1", 10) || 1);
		if (platform === "macOS") {
			const makeDir = `${installPath}/projects/standalone/Builds/MacOSXMakefile`;
			// Build a single-slice binary matching the detected architecture
			// (halves compile time vs the Makefile's default x86_64+arm64
			// universal binary). Override via the Architecture field.
			const archFlag = answers.architecture === "x64" ? "x86_64" : "arm64";
			const result = await executor.spawn("make", [
				`CONFIG=${buildConfig}`,
				`-j${jobs}`,
				`TARGET_ARCH=-arch ${archFlag}`,
			], {
				cwd: makeDir,
				env: {
					// JUCE_JOBS_CAPPED=1 suppresses the Makefile's auto -j so
					// our explicit -jN (RAM-aware) wins.
					JUCE_JOBS_CAPPED: "1",
					// SRCROOT is an Xcode-only variable but Projucer's
					// Makefile exporter bakes `-rpath $(SRCROOT)/../../../../tools/faust/lib`
					// into the link. Without this, the linker writes an
					// absolute rpath starting with `/` and HISE crashes at
					// launch with "Library not loaded: libfaust.2.dylib".
					SRCROOT: makeDir,
					// Strip the source-snippet + caret rendering from clang
					// diagnostics — keeps warning/error messages one line
					// each instead of 10+ lines of code context.
					CFLAGS: "-fno-caret-diagnostics",
					CXXFLAGS: "-fno-caret-diagnostics",
				},
				onLog: (line, transient) => onProgress({ phase: "compile", message: line, transient }),
			});
			if (result.exitCode !== 0) return fail(`Compilation failed: ${result.stderr}`);

			// Make drops only HISE.app in build/<CONFIG>/. Add a bare `HISE`
			// symlink alongside so the addPath phase can register this dir
			// on $PATH and users can still invoke `HISE` from the shell.
			const outDir = `${makeDir}/build/${buildConfig}`;
			await executor.spawn("ln", ["-sf", "HISE.app/Contents/MacOS/HISE", `${outDir}/HISE`], {});
		} else if (platform === "Linux") {
			const makeDir = `${installPath}/projects/standalone/Builds/LinuxMakefile`;
			const result = await executor.spawn("make", [`CONFIG=${buildConfig}`, "AR=gcc-ar", `-j${jobs}`], {
				cwd: makeDir,
				onLog: (line, transient) => onProgress({ phase: "compile", message: line, transient }),
			});
			if (result.exitCode !== 0) return fail(`Compilation failed: ${result.stderr}`);
		} else {
			const msbuild = await resolveMsbuildPath(executor);
			if (!msbuild) {
				return fail("Could not locate a Visual Studio installation with MSBuild. Re-run the setup wizard.");
			}
			const sln = `${installPath}\\projects\\standalone\\Builds\\VisualStudio2026\\HISE Standalone.sln`;
			const config = includeFaust ? "ReleaseWithFaust" : "Release";
			const result = await executor.spawn(msbuild, [
				sln,
				`/p:Configuration=${config}`,
				"/p:Platform=x64",
				"/verbosity:minimal",
			], {
				// VSLANG=1033 (en-US LCID) forces MSBuild / cl.exe / link.exe
				// to emit English diagnostics regardless of the OS UI locale,
				// so filterMsbuildLine's regex only needs to parse one language.
				env: {
					PreferredToolArchitecture: "x64",
					VSLANG: "1033",
					VSLANGCODE: "en-US",
				},
				onLog: (line, transient) => {
					const filtered = filterMsbuildLine(line, installPath);
					if (filtered !== null) onProgress({ phase: "compile", message: filtered, transient });
				},
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
		const includeFaust = isOn(answers.includeFaust);

		onProgress({ phase: "add-path", percent: 0, message: "Adding HISE to PATH..." });

		if (platform === "Windows") {
			// HISE.exe lives in the App\ subfolder of the build-config output
			// dir. Register that dir on the per-user PATH via PowerShell so no
			// elevation is needed and the change survives the session.
			const config = includeFaust ? "ReleaseWithFaust" : "Release";
			const binDir = `${installPath}\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\${config}\\App`;
			const psCmd =
				`$cur = [Environment]::GetEnvironmentVariable('Path','User'); ` +
				`if ($cur -notlike '*${binDir.replace(/'/g, "''")}*') { ` +
				`  [Environment]::SetEnvironmentVariable('Path', ($cur.TrimEnd(';') + ';${binDir.replace(/'/g, "''")}'), 'User') ` +
				`}`;
			const result = await executor.spawn("powershell", [
				"-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCmd,
			], {});
			if (result.exitCode !== 0) return fail(`Failed to update user PATH: ${result.stderr}`);
			// Also update this Node process's PATH so subsequent phases
			// (verify, test) can invoke HISE by name without waiting for
			// a terminal restart. The registry update above covers new
			// shells; this in-memory update covers the running wizard.
			const existing = process.env.PATH ?? "";
			if (!existing.toLowerCase().includes(binDir.toLowerCase())) {
				process.env.PATH = `${existing.replace(/;$/, "")};${binDir}`;
			}
			onProgress({ phase: "add-path", percent: 100 });
			return ok(`✓ Added ${binDir} to your user PATH.`);
		}

		let binPath: string;
		if (platform === "macOS") {
			const cfg = includeFaust ? "ReleaseWithFaust" : "Release";
			binPath = `${installPath}/projects/standalone/Builds/MacOSXMakefile/build/${cfg}`;
		} else {
			binPath = `${installPath}/projects/standalone/Builds/LinuxMakefile/build`;
		}

		// Detect shell config
		const shell = process.env.SHELL ?? "/bin/bash";
		const shellConfig = shell.includes("zsh") ? `${process.env.HOME}/.zshrc` : `${process.env.HOME}/.bashrc`;

		const exportLine = `export PATH="$PATH:${binPath}"`;
		const result = await executor.spawn("bash", ["-c", `echo '${exportLine}' >> "${shellConfig}"`], {});
		if (result.exitCode !== 0) return fail(`Failed to update ${shellConfig}: ${result.stderr}`);

		// Also patch this Node process's PATH so the verify + test phases
		// can invoke HISE by bare name in the same session — the shell rc
		// append above only takes effect in new shells.
		const currentPath = process.env.PATH ?? "";
		if (!currentPath.split(":").includes(binPath)) {
			process.env.PATH = currentPath ? `${currentPath}:${binPath}` : binPath;
		}

		onProgress({ phase: "add-path", percent: 100 });
		return ok(`✓ Added HISE to PATH in ${shellConfig}. Restart your shell or run: source ${shellConfig}`);
	};
}

// ── HISE binary path helper ───────────────────────────────────────────

function hiseBinPath(installPath: string, platform: string, includeFaust = false): string {
	if (platform === "macOS") {
		const cfg = includeFaust ? "ReleaseWithFaust" : "Release";
		return `${installPath}/projects/standalone/Builds/MacOSXMakefile/build/${cfg}/HISE.app/Contents/MacOS/HISE`;
	} else if (platform === "Linux") {
		return `${installPath}/projects/standalone/Builds/LinuxMakefile/build/HISE Standalone`;
	}
	// MSBuild config name becomes the output subfolder name, so the
	// Faust-enabled build lives under "ReleaseWithFaust\App\HISE.exe".
	const config = includeFaust ? "ReleaseWithFaust" : "Release";
	return `${installPath}\\projects\\standalone\\Builds\\VisualStudio2026\\x64\\${config}\\App\\HISE.exe`;
}

/** Bare binary name used when invoking HISE via PATH lookup. */
function hiseBinaryName(platform: string): string {
	if (platform === "Windows") return "HISE.exe";
	if (platform === "macOS") return "HISE";
	return "HISE Standalone";
}

/** Resolve the MSBuild.exe path via vswhere so BuildTools / Community /
 *  Pro / Enterprise installs all work. Returns null if not found. */
export async function resolveMsbuildPath(executor: PhaseExecutor): Promise<string | null> {
	const vswhere = "C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe";
	const vs = await executor.spawn(vswhere, [
		"-latest",
		"-products", "*",
		"-requires", "Microsoft.Component.MSBuild",
		"-property", "installationPath",
	], {});
	const vsPath = vs.stdout.trim();
	if (vs.exitCode !== 0 || !vsPath) return null;
	return `${vsPath}\\MSBuild\\Current\\Bin\\MSBuild.exe`;
}

// ── 8. Verify ────────────────────────────────────────────────────────

export function createSetupVerifyHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		const executor = withSignal(_executor, signal);
		const installPath = answers.installPath!;
		const platform = answers.platform ?? "Linux";
		const includeFaust = isOn(answers.includeFaust);

		onProgress({ phase: "verify", percent: 0, message: "Verifying HISE binary on PATH..." });

		// Invoke by bare binary name — this verifies that the add-path phase
		// actually made HISE resolvable via PATH. If it ENOENTs, PATH is
		// broken. Hint the user with the expected install location.
		const binaryName = hiseBinaryName(platform);
		const flags = await executor.spawn(binaryName, ["get_build_flags"], {
			onLog: (line, transient) => onProgress({ phase: "verify", message: line, transient }),
		});
		if (flags.exitCode !== 0) {
			const expected = hiseBinPath(installPath, platform, includeFaust);
			return fail(
				`HISE not found on PATH (expected '${binaryName}'). ` +
				`Binary should be at: ${expected}`,
			);
		}
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
		// Invoke HISE by bare name so it resolves via PATH (set by the
		// add-path phase) rather than tying the test flow to a file layout.
		const hise = hiseBinaryName(platform);
		const demoProject = `${installPath}/extras/demo_project`;

		onProgress({ phase: "test", percent: 0, message: "Setting project folder..." });

		const setFolder = await executor.spawn(hise, [
			"set_project_folder", `-p:${demoProject}`,
		], {
			onLog: (line, transient) => onProgress({ phase: "test", message: line, transient }),
		});
		if (setFolder.exitCode !== 0) return fail(`set_project_folder failed: ${setFolder.stderr}`);

		onProgress({ phase: "test", percent: 20, message: "Exporting demo project..." });

		const exportCi = await executor.spawn(hise, [
			"export_ci", "XmlPresetBackups/Demo.xml",
			"-t:standalone", `-a:${arch}`, "-nolto",
		], {
			cwd: demoProject,
			onLog: (line, transient) => onProgress({ phase: "test", message: line, transient }),
		});
		if (exportCi.exitCode !== 0) return fail(`export_ci failed: ${exportCi.stderr}`);

		onProgress({ phase: "test", percent: 50, message: "Compiling demo project..." });

		const emit = (message: string, transient?: boolean) =>
			onProgress({ phase: "test", message, transient });

		const binaryFolder = platform === "Windows"
			? `${demoProject}\\Binaries`
			: `${demoProject}/Binaries`;
		const jucerFile = platform === "Windows"
			? `${demoProject}\\Binaries\\AutogeneratedProject.jucer`
			: `${demoProject}/Binaries/AutogeneratedProject.jucer`;

		const parallelJobs = Math.max(1, parseInt(answers.parallelJobs ?? "1", 10) || 1);
		const macArchitecture = answers.architecture === "x64" ? "x86_64" : "arm64";
		const compile = await runJuceCompile(executor, {
			binaryFolder,
			hisePath: installPath,
			jucerFile,
			projectName: "Demo Project",
			configuration: "Release",
			parallelJobs,
			macArchitecture,
		}, emit);

		if (!compile.success) return fail(`Demo project compilation failed: ${compile.stderr}`);

		onProgress({ phase: "test", percent: 100 });
		return ok("✓ Demo project exported and compiled successfully.");
	};
}
