// ── Node.js PhaseExecutor — child_process.spawn() wrapper ────────────

import { spawn as cpSpawn } from "node:child_process";
import type { PhaseExecutor, SpawnResult, SpawnOptions } from "../engine/wizard/phase-executor.js";

// Line splitter that normalises child-process output for Ink.
// Any of these acts as a line boundary and is stripped:
//   • \n or \r (progress tickers from curl, git, etc.)
//   • Any CSI control sequence that isn't SGR (cursor moves,
//     erase-line, erase-display) — winget/MSBuild use these
//     to redraw in place, which would otherwise scramble Ink.
// SGR colour codes (ESC [ ... m) are preserved so coloured
// output still renders. State is buffered across chunks so
// partial sequences at chunk boundaries aren't misparsed.
//
// Each emitted line carries `transient: true` when it was flushed
// because of a bare \r or a non-SGR CSI sequence (i.e. the producer
// intended an in-place redraw). Callers may render transient lines as
// a single self-updating slot instead of appending.
export function makeLineSplitter() {
	let pending = "";  // Unprocessed tail (incomplete sequences)
	let current = "";  // In-progress line built from processed bytes
	return (text: string) => {
		const buf = pending + text;
		const lines: Array<{ line: string; transient: boolean }> = [];
		const flush = (transient: boolean) => {
			if (current.length > 0) {
				lines.push({ line: current, transient });
				current = "";
			}
		};
		let i = 0;
		while (i < buf.length) {
			const c = buf[i];
			if (c === "\n" || c === "\r") {
				// \r\n or \n = real line boundary (not transient).
				// Bare \r = in-place redraw intent (transient).
				const crLf = c === "\r" && buf[i + 1] === "\n";
				const transient = c === "\r" && !crLf;
				flush(transient);
				if (crLf) i++;
				i++;
				continue;
			}
			if (c === "\x1b") {
				if (i + 1 >= buf.length) break;  // Incomplete — keep for next chunk
				if (buf[i + 1] === "[") {
					// CSI: find the final byte (0x40–0x7E)
					let j = i + 2;
					while (j < buf.length) {
						const code = buf.charCodeAt(j);
						if (code >= 0x40 && code <= 0x7E) break;
						j++;
					}
					if (j >= buf.length) break;  // Incomplete
					if (buf[j] === "m") {
						// SGR colour — preserve in line
						current += buf.slice(i, j + 1);
					} else {
						// Cursor / erase / scroll — mid-line redraw intent
						flush(true);
					}
					i = j + 1;
					continue;
				}
				// ESC followed by non-[: 2-byte escape, drop
				i += 2;
				continue;
			}
			current += c;
			i++;
		}
		pending = buf.slice(i);
		return lines;
	};
}

export function createNodePhaseExecutor(): PhaseExecutor {
	return {
		async spawn(command: string, args: string[], options: SpawnOptions): Promise<SpawnResult> {
			return new Promise((resolve) => {
				// On Windows, only route through cmd.exe for bare command names
				// (so git / winget / .cmd resolution works). When the command
				// has a path separator it's a direct executable — invoking it
				// without a shell avoids cmd.exe mis-quoting args with spaces.
				const useShell = process.platform === "win32" && !/[\/\\]/.test(command);
				const proc = cpSpawn(command, args, {
					cwd: options.cwd,
					env: options.env ? { ...process.env, ...options.env } : undefined,
					signal: options.signal,
					stdio: ["ignore", "pipe", "pipe"],
					shell: useShell,
				});

				const stdoutChunks: string[] = [];
				const stderrChunks: string[] = [];

				const splitOut = makeLineSplitter();
				const splitErr = makeLineSplitter();

				proc.stdout?.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stdoutChunks.push(text);
					if (options.onLog) {
						for (const item of splitOut(text)) options.onLog(item.line, item.transient);
					}
				});

				proc.stderr?.on("data", (chunk: Buffer) => {
					const text = chunk.toString();
					stderrChunks.push(text);
					if (options.onLog) {
						for (const item of splitErr(text)) options.onLog(item.line, item.transient);
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
