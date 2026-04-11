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
} from "./types.js";
import { parseExpect, parseWait, compareValues } from "./parser.js";
import { optimizeScript } from "./optimizer.js";

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
): Promise<RunResult> {
	// Optimize: batch consecutive builder commands
	script = optimizeScript(script);
	const savedStack = saveModeStack(session);
	const expects: ExpectResult[] = [];
	let linesExecuted = 0;
	let abortError: { line: number; message: string } | undefined;

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
					linesExecuted++;

					if (!expectResult.passed && parsed.abortOnFail) {
						abortError = {
							line: line.lineNumber,
							message: `Assertion failed (abort): expected ${parsed.expected}, got ${expectResult.actual}`,
						};
						break;
					}
					continue;
				}
			}

			// Normal command: dispatch through session
			const result = await session.handleInput(line.content);
			linesExecuted++;

			if (result.type === "error") {
				abortError = {
					line: line.lineNumber,
					message: result.message,
				};
				break;
			}
		}
	} finally {
		restoreModeStack(session, savedStack);
	}

	const allPassed = expects.every((e) => e.passed);
	return {
		ok: !abortError && allPassed,
		linesExecuted,
		expects,
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
		case "error":
			return `ERROR: ${result.message}`;
		case "code":
			return result.content.trim();
		case "empty":
			return "";
		default:
			return `[${result.type}]`;
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

	if (result.expects.length > 0) {
		const passed = result.expects.filter((e) => e.passed).length;
		const total = result.expects.length;
		lines.push("");
		if (result.ok) {
			lines.push(`PASSED: ${passed}/${total} assertions`);
		} else {
			lines.push(`FAILED: ${passed}/${total} passed`);
		}
	} else if (result.ok) {
		lines.push(`OK: ${result.linesExecuted} commands executed`);
	}

	return lines.join("\n");
}
