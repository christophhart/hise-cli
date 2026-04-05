// ── Node.js PhaseExecutor — child_process.spawn() wrapper ────────────

import { spawn as cpSpawn } from "node:child_process";
import type { PhaseExecutor, SpawnResult, SpawnOptions } from "../engine/wizard/phase-executor.js";

export function createNodePhaseExecutor(): PhaseExecutor {
	return {
		async spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
			return new Promise((resolve) => {
				const proc = cpSpawn(command, args, {
					cwd: options.cwd,
					env: options.env ? { ...process.env, ...options.env } : undefined,
					signal: options.signal,
					stdio: ["ignore", "pipe", "pipe"],
					shell: process.platform === "win32",
				});

				const stdoutChunks: string[] = [];
				const stderrChunks: string[] = [];

				proc.stdout?.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stdoutChunks.push(text);
					if (options.onLog) {
						for (const line of text.split("\n").filter(Boolean)) {
							options.onLog(line);
						}
					}
				});

				proc.stderr?.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stderrChunks.push(text);
					if (options.onLog) {
						for (const line of text.split("\n").filter(Boolean)) {
							options.onLog(line);
						}
					}
				});

				proc.on("close", (code) => {
					resolve({
						exitCode: code ?? 1,
						stdout: stdoutChunks.join(""),
						stderr: stderrChunks.join(""),
					});
				});

				proc.on("error", (err) => {
					resolve({
						exitCode: 1,
						stdout: stdoutChunks.join(""),
						stderr: err.message,
					});
				});
			});
		},
	};
}
