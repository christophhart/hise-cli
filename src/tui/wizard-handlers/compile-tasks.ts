// ── Compile wizard task handlers — local compilation after HISE prepare ──
//
// These handlers receive build paths from the preceding HTTP "prepare" task
// via the `context` parameter and run the system compiler locally.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";
import { runJuceCompile, runUnixJuceCompile } from "./project-compile.js";

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

		onProgress({ phase: "compile", percent: 0, message: `Compiling (${configuration})...` });

		const result = await runJuceCompile(executor, {
			binaryFolder,
			hisePath,
			jucerFile,
			projectName,
			configuration,
		}, (message, transient) => {
			onProgress({ phase: "compile", message, transient });
		});

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
		if (!context?.buildScript || !context?.buildDirectory) {
			return fail("Missing build paths from prepare step — cannot compile networks.");
		}

		const executor = withSignal(_executor, signal);
		const { buildScript, buildDirectory, configuration } = context;

		onProgress({ phase: "compile-networks", percent: 0, message: `Compiling DLL (${configuration ?? "Release"})...` });

		const result = await runUnixJuceCompile(executor, { buildScript, buildDirectory }, (message, transient) => {
			onProgress({ phase: "compile-networks", message, transient });
		});

		if (!result.success) {
			return fail(`Network DLL compilation failed (exit code ${result.exitCode}).`);
		}

		onProgress({ phase: "compile-networks", percent: 100, message: "DLL compilation complete." });
		return ok("✓ Scriptnode networks compiled successfully.");
	};
}
