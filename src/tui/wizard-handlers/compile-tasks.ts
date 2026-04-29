// ── Compile wizard task handlers — local compilation after HISE prepare ──
//
// These handlers receive build paths from the preceding HTTP "prepare" task
// via the `context` parameter and run the system compiler locally.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";
import type { CompileEmit } from "./project-compile.js";
import { runJuceCompile } from "./project-compile.js";
import { normaliseVsVersion } from "./setup-tasks.js";

// ── Helpers ──────────────────────────────────────────────────────────

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

/**
 * Wrap a CompileEmit to remove redundant noise from clang diagnostics:
 * - Drop "In file included from ..." preamble lines (no flag to suppress).
 * - Drop "... note: ..." lines (informational follow-ups to a warning/error).
 * - Reduce `path/to/file.h:line:col:` to just `file.h:line:col:` so the
 *   build root prefix doesn't dominate the line.
 * - Prefix warnings with `⚠ ` and errors with `✗ ` so the upstream TUI
 *   renderer paints them yellow / red (same machinery as wizard outcomes).
 */
function stripCompilerNoise(emit: CompileEmit): CompileEmit {
	const diagPrefix = /^(\s*)((?:[^\s:]+\/)+)([^\s/:]+:\d+:\d+:)/;
	return (line, transient) => {
		const trimmed = line.trimStart();
		if (trimmed.startsWith("In file included from ")) return;
		if (/:\s*note:\s/.test(line)) return;
		let stripped = line.replace(diagPrefix, (_m, indent, _path, tail) => indent + tail);
		if (/:\s*error:\s/.test(stripped)) stripped = `✗ ${stripped.trimStart()}`;
		else if (/:\s*warning:\s/.test(stripped)) stripped = `⚠ ${stripped.trimStart()}`;
		emit(stripped, transient);
	};
}

// ── Plugin / standalone compile ─────────────────────────────────────

export function createCompileProjectHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (_answers, onProgress, signal, context) => {
		const binaryFolder = context?.binaryFolder;
		const hisePath = context?.hisePath;
		const jucerFile = context?.jucerFile;
		const projectName = context?.projectName;
		if (!binaryFolder || !hisePath || !jucerFile || !projectName) {
			return fail("Missing build paths from prepare step — cannot compile.");
		}

		const executor = withSignal(_executor, signal);
		const configuration = context?.configuration ?? "Release";
		// Plugins always built UB on macOS — DAWs may run native or under Rosetta.
		const macArchitecture = process.platform === "darwin" ? "universal" : undefined;
		const vsVersion = context?.vsVersion ? normaliseVsVersion(context.vsVersion) : undefined;

		onProgress({ phase: "compile", percent: 0, message: `Compiling (${configuration})...` });

		const result = await runJuceCompile(executor, {
			binaryFolder,
			hisePath,
			jucerFile,
			projectName,
			configuration,
			macArchitecture,
			vsVersion,
		}, stripCompilerNoise((message, transient) => {
			onProgress({ phase: "compile", message, transient });
		}));

		if (!result.success) {
			return fail(`Compilation failed (exit code ${result.exitCode}).`);
		}

		onProgress({ phase: "compile", percent: 100, message: "Compilation complete." });
		return ok("✓ Project compiled successfully.");
	};
}

// ── Scriptnode network DLL compile ──────────────────────────────────

export function createCompileNetworksHandler(_executor: PhaseExecutor): InternalTaskHandler {
	return async (_answers, onProgress, signal, context) => {
		const binaryFolder = context?.binaryFolder;
		const hisePath = context?.hisePath;
		const jucerFile = context?.jucerFile;
		const projectName = context?.projectName;
		if (!binaryFolder || !hisePath || !jucerFile || !projectName) {
			return fail("Missing build paths from prepare step — cannot compile networks.");
		}

		const executor = withSignal(_executor, signal);
		const configuration = context?.configuration ?? "Release";
		// Network DLL must match the running HISE process — host arch only.
		const macArchitecture = process.platform === "darwin"
			? (process.arch === "arm64" ? "arm64" : "x86_64")
			: undefined;
		const vsVersion = context?.vsVersion ? normaliseVsVersion(context.vsVersion) : undefined;

		onProgress({ phase: "compile-networks", percent: 0, message: `Compiling DLL (${configuration})...` });

		const emit: CompileEmit = stripCompilerNoise((message, transient) => {
			onProgress({ phase: "compile-networks", message, transient });
		});
		const result = await runJuceCompile(executor, {
			binaryFolder,
			hisePath,
			jucerFile,
			projectName,
			configuration,
			macArchitecture,
			vsVersion,
		}, emit);

		if (!result.success) {
			return fail(`Network DLL compilation failed (exit code ${result.exitCode}).`);
		}

		onProgress({ phase: "compile-networks", percent: 100, message: "DLL compilation complete." });
		return ok("✓ Scriptnode networks compiled successfully.");
	};
}
