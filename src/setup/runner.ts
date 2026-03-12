import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { PhaseResult } from "../setup-core/types.js";

// ── Setup Logger ────────────────────────────────────────────────────

/**
 * Logs all setup output to a file for post-mortem debugging.
 * File is created in the OS temp directory with a timestamp.
 */
export class SetupLogger {
	readonly filePath: string;
	private fd: number;

	constructor() {
		const timestamp = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.replace("Z", "");
		const filename = `hise-setup-${timestamp}.log`;
		this.filePath = path.join(os.tmpdir(), filename);
		this.fd = fs.openSync(this.filePath, "w");
		this.write(`HISE CLI Setup Log`);
		this.write(`Started: ${new Date().toISOString()}`);
		this.write(`Platform: ${process.platform} ${process.arch}`);
		this.write(`Node: ${process.version}`);
		this.write(`Log file: ${this.filePath}`);
		this.write("=".repeat(72));
		this.write("");
	}

	write(line: string): void {
		try {
			fs.writeSync(this.fd, `${line}\n`);
		} catch {
			// Best effort
		}
	}

	phaseStart(id: string, name: string): void {
		this.write("");
		this.write("=".repeat(72));
		this.write(`PHASE: ${name} (${id})`);
		this.write(`Started: ${new Date().toISOString()}`);
		this.write("-".repeat(72));
	}

	phaseScript(script: string): void {
		this.write("[SCRIPT]");
		for (const line of script.split("\n")) {
			this.write(`  ${line}`);
		}
		this.write("[/SCRIPT]");
		this.write("");
	}

	stdout(line: string): void {
		this.write(`[stdout] ${line}`);
	}

	stderr(line: string): void {
		this.write(`[stderr] ${line}`);
	}

	phaseEnd(result: PhaseResult): void {
		this.write("-".repeat(72));
		this.write(
			`Result: ${result.status} | exit code: ${result.exitCode ?? "n/a"} | duration: ${result.durationMs}ms`
		);
		if (result.error) {
			this.write(`Error: ${result.error}`);
		}
	}

	phaseSkipped(id: string, name: string): void {
		this.write(`PHASE SKIPPED: ${name} (${id})`);
	}

	finish(success: boolean): void {
		this.write("");
		this.write("=".repeat(72));
		this.write(
			`Setup ${success ? "COMPLETED" : "FAILED"} at ${new Date().toISOString()}`
		);
		this.write(`Full log: ${this.filePath}`);
		this.write("=".repeat(72));
		try {
			fs.closeSync(this.fd);
		} catch {
			// Best effort
		}
	}
}

// ── Types ───────────────────────────────────────────────────────────

export interface RunPhaseOptions {
	/** Phase identifier */
	id: string;
	/** Phase display name (for logging) */
	name?: string;
	/** Shell to use */
	shell: "powershell" | "bash";
	/** Script content to execute */
	script: string;
	/** Working directory */
	cwd: string;
	/** Environment variables */
	env?: Record<string, string>;
	/** Callback for each line of stdout */
	onStdout?: (line: string) => void;
	/** Callback for each line of stderr */
	onStderr?: (line: string) => void;
	/** Abort signal */
	signal?: AbortSignal;
	/** Logger instance for persistent file logging */
	logger?: SetupLogger;
}

// ── Runner ──────────────────────────────────────────────────────────

/**
 * Execute a single phase as a self-contained script.
 * Writes the script to a temp file, runs it with the appropriate shell,
 * streams output, and returns a structured result.
 */
export async function runPhase(options: RunPhaseOptions): Promise<PhaseResult> {
	const { id, name, shell, script, cwd, env, onStdout, onStderr, signal, logger } = options;

	logger?.phaseStart(id, name || id);
	logger?.phaseScript(script);

	const startTime = Date.now();
	const stdoutLines: string[] = [];
	const stderrLines: string[] = [];

	// Write script to temp file
	const ext = shell === "powershell" ? ".ps1" : ".sh";
	const tmpDir = os.tmpdir();
	const tmpFile = path.join(tmpDir, `hise-setup-${id}-${Date.now()}${ext}`);

	try {
		fs.writeFileSync(tmpFile, script, "utf-8");

		if (shell === "bash") {
			fs.chmodSync(tmpFile, 0o755);
		}

		const result = await new Promise<PhaseResult>((resolve) => {
			let shellCmd: string;
			let shellArgs: string[];

			if (shell === "powershell") {
				shellCmd = "powershell";
				shellArgs = [
					"-ExecutionPolicy",
					"Bypass",
					"-NoProfile",
					"-NonInteractive",
					"-File",
					tmpFile,
				];
			} else {
				shellCmd = "bash";
				shellArgs = [tmpFile];
			}

			// Ensure cwd exists
			if (!fs.existsSync(cwd)) {
				try {
					fs.mkdirSync(cwd, { recursive: true });
				} catch {
					// If we can't create it, let the script fail with a clear error
				}
			}

			const proc = spawn(shellCmd, shellArgs, {
				cwd,
				env: { ...process.env, ...env },
				stdio: ["ignore", "pipe", "pipe"],
			});

			if (signal) {
				const onAbort = () => {
					proc.kill("SIGTERM");
				};
				signal.addEventListener("abort", onAbort, { once: true });
				proc.on("exit", () => {
					signal.removeEventListener("abort", onAbort);
				});
			}

			let stdoutBuffer = "";
			let stderrBuffer = "";

			proc.stdout.on("data", (data: Buffer) => {
				stdoutBuffer += data.toString("utf-8");

				let newlineIndex = stdoutBuffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = stdoutBuffer.slice(0, newlineIndex);
					stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
					newlineIndex = stdoutBuffer.indexOf("\n");

					const trimmed = line.replace(/\r$/, "");
					stdoutLines.push(trimmed);
					logger?.stdout(trimmed);
					onStdout?.(trimmed);
				}
			});

			proc.stderr.on("data", (data: Buffer) => {
				stderrBuffer += data.toString("utf-8");

				let newlineIndex = stderrBuffer.indexOf("\n");
				while (newlineIndex >= 0) {
					const line = stderrBuffer.slice(0, newlineIndex);
					stderrBuffer = stderrBuffer.slice(newlineIndex + 1);
					newlineIndex = stderrBuffer.indexOf("\n");

					const trimmed = line.replace(/\r$/, "");
					stderrLines.push(trimmed);
					logger?.stderr(trimmed);
					onStderr?.(trimmed);
				}
			});

			proc.on("error", (err) => {
				const result: PhaseResult = {
					id,
					status: "failed",
					exitCode: -1,
					stdout: stdoutLines.join("\n"),
					stderr: stderrLines.join("\n"),
					durationMs: Date.now() - startTime,
					error: `Failed to start ${shell}: ${err.message}`,
				};
				logger?.phaseEnd(result);
				resolve(result);
			});

			proc.on("close", (code) => {
				// Flush remaining buffers
				if (stdoutBuffer.trim()) {
					stdoutLines.push(stdoutBuffer.trim());
					logger?.stdout(stdoutBuffer.trim());
					onStdout?.(stdoutBuffer.trim());
				}
				if (stderrBuffer.trim()) {
					stderrLines.push(stderrBuffer.trim());
					logger?.stderr(stderrBuffer.trim());
					onStderr?.(stderrBuffer.trim());
				}

				const exitCode = code ?? -1;
				const result: PhaseResult = {
					id,
					status: exitCode === 0 ? "done" : "failed",
					exitCode,
					stdout: stdoutLines.join("\n"),
					stderr: stderrLines.join("\n"),
					durationMs: Date.now() - startTime,
					error:
						exitCode !== 0
							? `Phase exited with code ${exitCode}`
							: undefined,
				};
				logger?.phaseEnd(result);
				resolve(result);
			});
		});

		return result;
	} finally {
		// Clean up temp file
		try {
			fs.unlinkSync(tmpFile);
		} catch {
			// Not critical
		}
	}
}

// ── Utility: Open URL ───────────────────────────────────────────────

export function openURL(url: string): void {
	const platform = process.platform;

	try {
		if (platform === "win32") {
			spawn("cmd", ["/c", "start", "", url], { stdio: "ignore" });
		} else if (platform === "darwin") {
			spawn("open", [url], { stdio: "ignore" });
		} else {
			spawn("xdg-open", [url], { stdio: "ignore" });
		}
	} catch {
		// Silently fail - user can open manually
	}
}

// ── Utility: Run command in foreground ──────────────────────────────

export function runCommandDetached(command: string, args: string[]): void {
	try {
		spawn(command, args, {
			stdio: "ignore",
			detached: true,
		}).unref();
	} catch {
		// Silently fail
	}
}
