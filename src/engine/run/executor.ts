// ── Script executor — runtime serial execution ─────────────────────

import type { CommandResult } from "../result.js";
import { textResult, errorResult } from "../result.js";
import type { Session } from "../session.js";
import type { Mode } from "../modes/mode.js";
import type {
	ParsedScript,
	RunResult,
	ExpectResult,
	ScriptLine,
	ScriptProgressEvent,
} from "./types.js";
import { parseExpect, parseWait, compareValues } from "./parser.js";
import { optimizeScript } from "./optimizer.js";
import { buildModeMap } from "./mode-map.js";
import { isEnvelopeResponse } from "../hise.js";

/**
 * Execute a parsed .hsc script against a live session.
 *
 * - Optimizes consecutive builder commands into batched requests
 * - Saves/restores the session mode stack around execution
 * - Fail-fast on runtime errors (non-expect)
 * - /expect assertions continue on failure (unless "or abort")
 * - Returns a RunResult with test report data
 */
export async function executeScript(
	script: ParsedScript,
	session: Session,
	onProgress?: (event: ScriptProgressEvent) => void,
): Promise<RunResult> {
	// Optimize: batch consecutive builder commands
	script = optimizeScript(script);
	const savedStack = saveModeStack(session);
	const expects: ExpectResult[] = [];
	const results: import("./types.js").CommandOutput[] = [];
	let linesExecuted = 0;
	let abortError: { line: number; message: string } | undefined;

	// Check if already in a plan group before execution (for unclosed detection)
	let wasInPlan = false;
	if (session.connection) {
		try {
			const resp = await session.connection.get("/api/undo/diff?scope=group");
			if (isEnvelopeResponse(resp) && resp.success) {
				const r = resp.result as Record<string, unknown> | null;
				wasInPlan = typeof r?.groupName === "string" && r.groupName !== "root";
			}
		} catch { /* no connection — skip check */ }
	}

	try {
		for (const line of script.lines) {
			// Handle special /expect and /wait commands directly
			if (line.kind === "slash") {
				const cmd = extractSlashCommand(line.content);

				if (cmd.name === "wait") {
					const parsed = parseWait(cmd.args);
					if (typeof parsed === "string") {
						abortError = { line: line.lineNumber, message: parsed };
						break;
					}
					await sleep(parsed.ms);
					linesExecuted++;
					continue;
				}

				if (cmd.name === "expect") {
					const parsed = parseExpect(cmd.args);
					if (typeof parsed === "string") {
						abortError = { line: line.lineNumber, message: parsed };
						break;
					}

					const expectResult = await executeExpect(
						parsed,
						line,
						session,
					);
					expects.push(expectResult);
					onProgress?.({ type: "expect", result: expectResult });
					linesExecuted++;

					if (!expectResult.passed && parsed.abortOnFail) {
						abortError = {
							line: line.lineNumber,
							message: `Assertion failed (abort): expected ${parsed.expected}, got ${expectResult.actual}`,
						};
						onProgress?.({ type: "error", line: line.lineNumber, message: abortError.message });
						break;
					}
					continue;
				}
			}

			// Normal command: dispatch through session
			const result = await session.handleInput(line.content);
			linesExecuted++;

			// Flatten nested /run results into this report
			if (result.type === "run-report") {
				const inner = result.runResult;
				const fileName = line.content.replace(/^\/run\s+/, "").replace(/^["']|["']$/g, "");
				// Section header
				const labelEntry = { line: line.lineNumber, content: line.content, result: textResult(fileName), label: fileName };
				results.push(labelEntry);
				onProgress?.({ type: "command", output: labelEntry });
				// Build mode map from inner source to filter mode entries and tag accents
				const innerLines = result.source.split("\n").map(l => l.trim());
				const innerModeMap = buildModeMap(innerLines);
				// Inline inner results (skip mode entry/exit, tag with accent)
				for (const cmd of inner.results) {
					const entry = cmd.line > 0 && cmd.line <= innerModeMap.length
						? innerModeMap[cmd.line - 1]
						: undefined;
					// Skip mode entry/exit (but keep one-shots)
					if (entry && entry.isModeEntry && !entry.isOneShot) continue;
					if (entry && entry.isModeExit) continue;
					// Tag with mode accent (propagate if not already set)
					const accent = cmd.accent ?? entry?.accent;
					const tagged = accent ? { ...cmd, accent } : cmd;
					results.push(tagged);
					onProgress?.({ type: "command", output: tagged });
				}
				for (const exp of inner.expects) {
					expects.push(exp);
					onProgress?.({ type: "expect", result: exp });
				}
				linesExecuted += inner.linesExecuted;
				// Propagate abort
				if (inner.error) {
					abortError = { line: line.lineNumber, message: `${fileName}: ${inner.error.message}` };
					onProgress?.({ type: "error", line: line.lineNumber, message: abortError.message });
					break;
				}
				continue;
			}

			const output = { line: line.lineNumber, content: line.content, result };
			results.push(output);
			onProgress?.({ type: "command", output });

			if (result.type === "error") {
				abortError = {
					line: line.lineNumber,
					message: result.message,
				};
				onProgress?.({ type: "error", line: line.lineNumber, message: result.message });
				break;
			}
		}
	} finally {
		restoreModeStack(session, savedStack);
	}

	// Detect unclosed plan group opened during script execution
	if (!abortError && session.connection) {
		try {
			const resp = await session.connection.get("/api/undo/diff?scope=group");
			if (isEnvelopeResponse(resp) && resp.success) {
				const r = resp.result as Record<string, unknown> | null;
				const nowInPlan = typeof r?.groupName === "string" && r.groupName !== "root";
				if (!wasInPlan && nowInPlan) {
					abortError = {
						line: script.lines[script.lines.length - 1]?.lineNumber ?? 0,
						message: `Unclosed plan group "${r!.groupName}" \u2014 add /undo apply or /undo discard`,
					};
					onProgress?.({ type: "error", line: abortError.line, message: abortError.message });
				}
			}
		} catch { /* no connection — skip check */ }
	}

	const allPassed = expects.every((e) => e.passed);
	return {
		ok: !abortError && allPassed,
		linesExecuted,
		expects,
		results,
		error: abortError,
	};
}

// ── /expect execution ───────────────────────────────────────────────

async function executeExpect(
	parsed: import("./types.js").ParsedExpect,
	line: ScriptLine,
	session: Session,
): Promise<ExpectResult> {
	const result = await session.handleInput(parsed.command);
	const actual = extractResultValue(result);

	const passed = compareValues(actual, parsed.expected, parsed.tolerance);

	return {
		line: line.lineNumber,
		command: parsed.command,
		expected: parsed.expected,
		actual,
		passed,
		tolerance: parsed.tolerance,
	};
}

/**
 * Extract a comparable string value from a CommandResult.
 * - text: content directly
 * - markdown: last non-blockquoted section (the return value)
 * - error: the error message (prefixed with "ERROR: ")
 * - other: type name as fallback
 */
export function extractResultValue(result: CommandResult): string {
	switch (result.type) {
		case "text":
			return result.content.trim();
		case "markdown": {
			// Script mode returns markdown with optional blockquoted logs
			// followed by the plain return value. Extract the last non-quoted section.
			const sections = result.content.split("\n\n");
			for (let i = sections.length - 1; i >= 0; i--) {
				const section = sections[i]!.trim();
				if (!section.startsWith(">")) {
					return section;
				}
			}
			return result.content.trim();
		}
		case "error": {
			// Strip noisy REPL callstack lines (e.g. "eval() at Interface.js:1:1")
			const msg = result.message.split("\n")
				.filter(l => !l.trim().startsWith("eval()") && !l.trim().match(/^at\s/))
				.join("\n")
				.trim();
			return `ERROR: ${msg}`;
		}
		case "code":
			return result.content.trim();
		case "empty":
			return "";
		default:
			return `[${result.type}]`;
	}
}

// ── Run log formatting ──────────────────────────────────────────────
//
// Formats a CommandResult for the run log output. Separate from
// extractResultValue() which is used for /expect comparisons and needs
// raw values. This pipeline produces human-friendly one-line summaries
// and applies noise filters.

/** Filters applied to log output lines. Add new filters here. */
const LOG_LINE_FILTERS: Array<(line: string) => boolean> = [
	// Strip REPL callstack noise
	(l) => !l.trim().startsWith("eval()"),
	(l) => !l.trim().match(/^at\s/),
];

/** Filter noise from a multi-line string. */
export function filterLogNoise(text: string): string {
	return text.split("\n")
		.filter(l => LOG_LINE_FILTERS.every(f => f(l)))
		.join("\n")
		.trim();
}

/**
 * Format a CommandResult for the run log.
 * Returns null if the result should be suppressed (empty, meta, etc.).
 */
export function formatResultForLog(result: CommandResult): string | null {
	switch (result.type) {
		case "empty":
			return null;
		case "text":
			return filterLogNoise(result.content);
		case "markdown": {
			// Extract plain text: strip blockquotes (logs), keep return value
			const sections = result.content.split("\n\n");
			const parts: string[] = [];
			for (const section of sections) {
				const trimmed = section.trim();
				if (trimmed.startsWith(">")) {
					// Blockquoted log lines — strip > prefix
					const logLines = trimmed.split("\n").map(l => l.replace(/^>\s?/, "")).join("\n");
					parts.push(logLines);
				} else if (trimmed) {
					parts.push(trimmed);
				}
			}
			return filterLogNoise(parts.join("\n")) || null;
		}
		case "error": {
			const msg = filterLogNoise(result.message);
			return msg ? `ERROR: ${msg}` : null;
		}
		case "code":
			return filterLogNoise(result.content) || null;
		case "table": {
			// Summarize table as compact rows
			if (result.rows.length === 0) return null;
			const lines = result.rows.map(row => row.join("  "));
			return lines.join("\n");
		}
		case "tree":
			return null; // Trees are too complex for single-line log
		case "wizard":
			return null; // Wizard results don't belong in run log
		default:
			return null;
	}
}

// ── Mode stack save/restore ─────────────────────────────────────────

function saveModeStack(session: Session): Mode[] {
	return [...session.modeStack];
}

function restoreModeStack(session: Session, saved: Mode[]): void {
	session.modeStack.length = 0;
	for (const mode of saved) {
		session.modeStack.push(mode);
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractSlashCommand(content: string): { name: string; args: string } {
	const withoutSlash = content.slice(1);
	const spaceIdx = withoutSlash.indexOf(" ");
	if (spaceIdx === -1) {
		return { name: withoutSlash, args: "" };
	}
	return {
		name: withoutSlash.slice(0, spaceIdx),
		args: withoutSlash.slice(spaceIdx + 1).trim(),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Test report formatting ──────────────────────────────────────────

/**
 * Format a RunResult as a human-readable test report string.
 */
export function formatRunReport(result: RunResult): string {
	const lines: string[] = [];

	// Per-command results
	for (const cmd of result.results) {
		const val = formatResultForLog(cmd.result);
		if (val) {
			for (const line of val.split("\n")) {
				lines.push(line);
			}
		}
	}

	// Expect results
	for (const expect of result.expects) {
		const icon = expect.passed ? "\u2713" : "\u2717";
		const line = ` ${icon} line ${expect.line}: ${expect.command} is ${expect.expected}`;
		if (!expect.passed) {
			lines.push(`${line} \u2014 got ${expect.actual}`);
		} else {
			lines.push(line);
		}
	}

	if (result.error) {
		lines.push("");
		lines.push(`ABORTED at line ${result.error.line}: ${result.error.message}`);
	}

	// Summary footer
	const parts: string[] = [];
	if (result.linesExecuted > 0) parts.push(`${result.linesExecuted} commands executed`);
	if (result.expects.length > 0) {
		const passed = result.expects.filter((e) => e.passed).length;
		const total = result.expects.length;
		parts.push(result.ok ? `PASSED ${passed}/${total}` : `FAILED ${passed}/${total}`);
	}
	if (parts.length > 0) {
		lines.push("");
		const icon = result.ok ? "\u2713" : "\u2717";
		lines.push(`${icon} ${parts.join(", ")}`);
	}

	return lines.join("\n");
}
