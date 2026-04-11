// ── Parse-phase validation — multi-recovery error collection ────────
//
// Walks ScriptLine[] simulating mode transitions to validate each line
// in context. Collects all errors rather than failing on the first one.

import type { ModeId } from "../modes/mode.js";
import type { Session } from "../session.js";
import type { ParsedScript, ParseError, ValidationResult } from "./types.js";
import { parseExpect, parseWait } from "./parser.js";

/** Set of mode IDs that can be entered via slash command. */
const MODE_IDS = new Set<string>([
	"builder", "script", "dsp", "sampler", "inspect",
	"project", "compile", "undo", "ui",
]);

/** Slash commands that are valid tool commands (no mode needed). */
const TOOL_COMMANDS = new Set<string>([
	"wait", "expect", "run", "parse",
]);

/** Slash commands that are always valid. */
const BUILTIN_COMMANDS = new Set<string>([
	"exit", "quit", "help", "clear", "modes", "connect",
	"wizard", "density", "expand", "collapse", "compact",
]);

/**
 * Validate a parsed script without executing it.
 *
 * Simulates mode transitions and validates:
 * - Mode commands are not issued in root mode
 * - /expect and /wait have valid syntax
 * - Slash commands reference known commands
 * - Builder commands parse correctly (via Chevrotain, if in builder mode)
 *
 * Some modes (script REPL) can't validate without execution —
 * for those, validation is limited to "we're in the right mode".
 */
export function validateScript(
	script: ParsedScript,
	session: Session,
): ValidationResult {
	const errors: ParseError[] = [];
	let currentModeId: ModeId = "root";
	const modeStack: ModeId[] = ["root"];

	for (const line of script.lines) {
		if (line.kind === "slash") {
			const cmd = extractSlashName(line.content);

			// Mode entry
			if (MODE_IDS.has(cmd.name)) {
				const modeId = cmd.name as ModeId;
				if (cmd.args) {
					// One-shot: validate the command in that mode's context
					validateModeCommand(cmd.args, modeId, line.lineNumber, session, errors);
				} else {
					// Enter mode
					modeStack.push(modeId);
					currentModeId = modeId;
				}
				continue;
			}

			// /exit
			if (cmd.name === "exit") {
				if (modeStack.length <= 1) {
					errors.push({ line: line.lineNumber, message: "/exit at root level — nothing to exit" });
				} else {
					modeStack.pop();
					currentModeId = modeStack[modeStack.length - 1]!;
				}
				continue;
			}

			// Tool commands
			if (cmd.name === "wait") {
				const parsed = parseWait(cmd.args);
				if (typeof parsed === "string") {
					errors.push({ line: line.lineNumber, message: parsed });
				}
				continue;
			}

			if (cmd.name === "expect") {
				const parsed = parseExpect(cmd.args);
				if (typeof parsed === "string") {
					errors.push({ line: line.lineNumber, message: parsed });
				}
				continue;
			}

			// Known builtins and tool commands — always valid
			if (BUILTIN_COMMANDS.has(cmd.name) || TOOL_COMMANDS.has(cmd.name)) {
				continue;
			}

			// Check if it's a registered command (wizard aliases, etc.)
			if (session.registry.has(cmd.name)) {
				continue;
			}

			errors.push({
				line: line.lineNumber,
				message: `Unknown command: /${cmd.name}`,
			});
			continue;
		}

		// Mode-specific command (no slash)
		if (currentModeId === "root") {
			errors.push({
				line: line.lineNumber,
				message: `Command "${line.content}" requires a mode — enter a mode first (e.g., /builder, /script)`,
			});
			continue;
		}

		// Validate in the context of the current mode
		validateModeCommand(line.content, currentModeId, line.lineNumber, session, errors);
	}

	return {
		ok: errors.length === 0,
		errors,
	};
}

/**
 * Validate a single command in the context of a specific mode.
 * Uses the mode's parser for syntax validation where possible.
 */
function validateModeCommand(
	input: string,
	modeId: ModeId,
	lineNumber: number,
	session: Session,
	errors: ParseError[],
): void {
	// For builder mode, we can do syntax validation via Chevrotain
	if (modeId === "builder") {
		try {
			const mode = session.getOrCreateMode(modeId);
			// Try tokenization only — some modes expose tokenizeInput
			if (mode.tokenizeInput) {
				// If tokenization succeeds, syntax is at least lexically valid
				mode.tokenizeInput(input);
			}
		} catch (err) {
			errors.push({
				line: lineNumber,
				message: `Builder parse error: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
		return;
	}

	// For script, undo, dsp, etc. — we can't validate without execution.
	// Just check that we're in a mode (already handled above).
}

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format validation errors into a human-readable report.
 */
export function formatValidationReport(result: ValidationResult): string {
	if (result.ok) {
		return "Validation passed — no errors found.";
	}

	const lines = result.errors.map(
		(e) => `  line ${e.line}: ${e.message}`,
	);
	return `Validation found ${result.errors.length} error(s):\n${lines.join("\n")}`;
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractSlashName(content: string): { name: string; args: string } {
	const withoutSlash = content.slice(1);
	// Handle dot-notation: /builder.context → name="builder"
	const dotIdx = withoutSlash.indexOf(".");
	const spaceIdx = withoutSlash.indexOf(" ");

	let nameEnd: number;
	if (dotIdx !== -1 && (spaceIdx === -1 || dotIdx < spaceIdx)) {
		nameEnd = dotIdx;
	} else if (spaceIdx !== -1) {
		nameEnd = spaceIdx;
	} else {
		nameEnd = withoutSlash.length;
	}

	const name = withoutSlash.slice(0, nameEnd);
	const args = withoutSlash.slice(nameEnd).trim();

	// If args starts with a dot, it's dot-notation context — still part of args
	return { name, args };
}
