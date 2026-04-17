// ── Mock PhaseExecutor for testing ───────────────────────────────────

import type { PhaseExecutor, SpawnResult, SpawnOptions } from "./phase-executor.js";

export class MockPhaseExecutor implements PhaseExecutor {
	readonly calls: Array<{ command: string; args: string[]; env?: Record<string, string> }> = [];
	private readonly results = new Map<string, SpawnResult>();

	onSpawn(command: string, result: SpawnResult): this {
		this.results.set(command, result);
		return this;
	}

	async spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
		this.calls.push({ command, args, env: options.env });
		return this.results.get(command) ?? { exitCode: 0, stdout: "", stderr: "" };
	}
}
