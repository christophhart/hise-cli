// ── JUCE project compile — shared across setup test + compile wizard ──
//
// Extracts the per-platform compile flow so the setup wizard's demo
// project test and the stand-alone compile wizard can share one
// implementation. Each platform has one entry point:
//
//   • Windows → Projucer resave → vswhere-resolved MSBuild on the .sln
//   • macOS / Linux → cat the shipped batch script, strip its
//     xcbeautify pipe, run through bash (keeps raw compiler output
//     flowing into filterXcodeLine).
//
// The HISE-generated `batchCompile.bat` on Windows still hardcodes the
// old VS 2026 Community MSBuild path, so we deliberately do NOT run it.
// Instead the caller supplies the .sln path (resolvable from the build
// output directory) and we drive MSBuild directly.

import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import { filterMsbuildLine, filterXcodeLine, resolveMsbuildPath } from "./setup-tasks.js";

/** Progress callback: a log line plus the transient flag from spawn. */
export type CompileEmit = (message: string, transient?: boolean) => void;

export interface WindowsCompileSpec {
	/** .jucer file to pass through Projucer --resave before building. */
	readonly jucerFile: string;
	/** Path to Projucer.exe (lives inside the HISE install). */
	readonly projucerPath: string;
	/** .sln to build with MSBuild. */
	readonly slnFile: string;
	/** MSBuild /p:Configuration value (e.g. "Release", "Release with Faust"). */
	readonly configuration: string;
	/** MSBuild /p:Platform value (e.g. "x64", "Win32", "ARM64"). Default "x64". */
	readonly msbuildPlatform?: string;
	/**
	 * Root of the HISE install — used only to strip the path prefix on
	 * MSBuild diagnostic lines so they render compactly. Optional.
	 */
	readonly hiseInstallPath?: string;
	/** Extra env vars merged into the MSBuild spawn. */
	readonly extraEnv?: Record<string, string>;
}

export interface UnixCompileSpec {
	/** batchCompileOSX / batchCompileLinux / generated build script. */
	readonly buildScript: string;
	/** Working directory for the build script. */
	readonly buildDirectory: string;
}

export interface CompileOutcome {
	readonly success: boolean;
	readonly exitCode: number;
	readonly stderr: string;
}

/** Compile a JUCE-generated Windows solution. */
export async function runWindowsJuceCompile(
	executor: PhaseExecutor,
	spec: WindowsCompileSpec,
	emit: CompileEmit,
): Promise<CompileOutcome> {
	const resave = await executor.spawn(spec.projucerPath, ["--resave", spec.jucerFile], {
		onLog: (line, transient) => emit(line, transient),
	});
	if (resave.exitCode !== 0) {
		return { success: false, exitCode: resave.exitCode, stderr: `Projucer resave failed: ${resave.stderr}` };
	}

	const msbuild = await resolveMsbuildPath(executor);
	if (!msbuild) {
		return {
			success: false,
			exitCode: 1,
			stderr: "Could not locate a Visual Studio installation with MSBuild.",
		};
	}

	const env: Record<string, string> = {
		PreferredToolArchitecture: "x64",
		VisualStudioVersion: "18.0",
		// VSLANG=1033 (en-US LCID) forces MSBuild / cl.exe to emit English
		// diagnostics regardless of the OS UI locale so filterMsbuildLine
		// only has to parse one language.
		VSLANG: "1033",
		VSLANGCODE: "en-US",
		...spec.extraEnv,
	};

	const result = await executor.spawn(msbuild, [
		spec.slnFile,
		`/p:Configuration=${spec.configuration}`,
		`/p:Platform=${spec.msbuildPlatform ?? "x64"}`,
		"/verbosity:minimal",
	], {
		env,
		onLog: (line, transient) => {
			const filtered = filterMsbuildLine(line, spec.hiseInstallPath);
			if (filtered !== null) emit(filtered, transient);
		},
	});

	return { success: result.exitCode === 0, exitCode: result.exitCode, stderr: result.stderr };
}

export interface JuceCompileSpec {
	/** Project Binaries folder — root of the JUCE build output. */
	readonly binaryFolder: string;
	/** HISE install path — used to resolve Projucer binary on Windows. */
	readonly hisePath: string;
	/** .jucer file path — passed to Projucer --resave. */
	readonly jucerFile: string;
	/** Project name — baked into the Windows .sln filename. */
	readonly projectName: string;
	/** MSBuild /p:Configuration value. Default "Release". */
	readonly configuration?: string;
	/** MSBuild /p:Platform value. Default "x64". */
	readonly msbuildPlatform?: string;
}

/**
 * Dispatches a JUCE-generated project build to the platform-specific compile
 * primitive. Callers supply the four fields HISE's wizard prepare step returns
 * (binaryFolder, hisePath, jucerFile, projectName); everything else is derived.
 */
export async function runJuceCompile(
	executor: PhaseExecutor,
	spec: JuceCompileSpec,
	emit: CompileEmit,
): Promise<CompileOutcome> {
	if (process.platform === "win32") {
		const slnFile = `${spec.binaryFolder}\\Builds\\VisualStudio2026\\${spec.projectName}.sln`;
		const projucerPath = `${spec.hisePath}\\JUCE\\Projucer\\Projucer.exe`;
		return runWindowsJuceCompile(executor, {
			jucerFile: spec.jucerFile,
			projucerPath,
			slnFile,
			configuration: spec.configuration ?? "Release",
			msbuildPlatform: spec.msbuildPlatform ?? "x64",
			hiseInstallPath: spec.hisePath,
		}, emit);
	}

	const buildScript = process.platform === "darwin"
		? `${spec.binaryFolder}/batchCompileOSX`
		: `${spec.binaryFolder}/batchCompileLinux`;
	return runUnixJuceCompile(executor, {
		buildScript,
		buildDirectory: spec.binaryFolder,
	}, emit);
}

/** Compile a JUCE-generated build via its Unix shell script. */
export async function runUnixJuceCompile(
	executor: PhaseExecutor,
	spec: UnixCompileSpec,
	emit: CompileEmit,
): Promise<CompileOutcome> {
	const scriptContent = await executor.spawn("cat", [spec.buildScript], {});
	if (scriptContent.exitCode !== 0) {
		return {
			success: false,
			exitCode: scriptContent.exitCode,
			stderr: `Cannot read build script: ${spec.buildScript}`,
		};
	}
	// Strip the xcbeautify pipe so raw xcodebuild/make output reaches
	// filterXcodeLine untouched.
	const patchedScript = scriptContent.stdout.replace(/\s*\|\s*"[^"]*xcbeautify"/, "");
	const result = await executor.spawn("bash", ["-c", patchedScript], {
		cwd: spec.buildDirectory,
		onLog: (line, transient) => {
			const filtered = filterXcodeLine(line);
			if (filtered) emit(filtered, transient);
		},
	});
	return { success: result.exitCode === 0, exitCode: result.exitCode, stderr: result.stderr };
}
