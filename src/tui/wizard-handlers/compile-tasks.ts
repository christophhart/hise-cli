// ── Compile wizard task handlers — local compilation after HISE prepare ──
//
// These handlers receive build paths from the preceding HTTP "prepare" task
// via the `context` parameter and run the system compiler locally.

import type { InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor, SpawnOptions } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";
import { filterXcodeLine } from "./setup-tasks.js";

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
		if (!context?.buildScript || !context?.buildDirectory) {
			return fail("Missing build paths from prepare step — cannot compile.");
		}

		const executor = withSignal(_executor, signal);
		const { buildScript, buildDirectory, configuration } = context;

		onProgress({ phase: "compile", percent: 0, message: `Compiling (${configuration ?? "Release"})...` });

		// Read the build script content
		const scriptContent = await executor.spawn("cat", [buildScript], {});
		if (scriptContent.exitCode !== 0) {
			return fail(`Cannot read build script: ${buildScript}`);
		}

		// Strip xcbeautify pipe so we get raw compiler output
		const patchedScript = scriptContent.stdout.replace(/\s*\|\s*"[^"]*xcbeautify"/, "");

		const result = await executor.spawn("bash", ["-c", patchedScript], {
			cwd: buildDirectory,
			onLog: (line) => {
				const filtered = filterXcodeLine(line);
				if (filtered) onProgress({ phase: "compile", message: filtered });
			},
		});

		if (result.exitCode !== 0) {
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

		const scriptContent = await executor.spawn("cat", [buildScript], {});
		if (scriptContent.exitCode !== 0) {
			return fail(`Cannot read build script: ${buildScript}`);
		}

		const patchedScript = scriptContent.stdout.replace(/\s*\|\s*"[^"]*xcbeautify"/, "");

		const result = await executor.spawn("bash", ["-c", patchedScript], {
			cwd: buildDirectory,
			onLog: (line) => {
				const filtered = filterXcodeLine(line);
				if (filtered) onProgress({ phase: "compile-networks", message: filtered });
			},
		});

		if (result.exitCode !== 0) {
			return fail(`Network DLL compilation failed (exit code ${result.exitCode}).`);
		}

		onProgress({ phase: "compile-networks", percent: 100, message: "DLL compilation complete." });
		return ok("✓ Scriptnode networks compiled successfully.");
	};
}
