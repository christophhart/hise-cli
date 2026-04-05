// ── PhaseExecutor interface — platform-specific shell command execution ──
//
// Engine-layer interface (zero node: imports). Node.js implementation
// lives in src/tui/nodePhaseExecutor.ts.

/** Result of a spawned process. */
export interface SpawnResult {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** Options for spawning a process. */
export interface SpawnOptions {
	readonly cwd?: string;
	readonly env?: Record<string, string>;
	readonly onLog?: (line: string) => void;
	readonly signal?: AbortSignal;
}

/** Platform-specific shell command executor. */
export interface PhaseExecutor {
	spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult>;
}
