// ── Run system types — script runner & test framework ────────────────

/** A single parsed line from a .hsc script file. */
export interface ScriptLine {
	/** 1-based line number in the source file */
	lineNumber: number;
	/** Original text (for error messages) */
	raw: string;
	/** Trimmed text, ready to dispatch */
	content: string;
	/** Whether this is a slash command or a mode-specific command */
	kind: "slash" | "command";
}

/** Parsed .hsc script ready for validation/execution. */
export interface ParsedScript {
	lines: ScriptLine[];
}

/** A single parse-phase error (non-fatal, collected). */
export interface ParseError {
	line: number;
	message: string;
}

/** Result of parse-phase validation. */
export interface ValidationResult {
	ok: boolean;
	errors: ParseError[];
}

/** Result of a single /expect assertion. */
export interface ExpectResult {
	line: number;
	/** The command that was executed */
	command: string;
	/** Expected value (string representation) */
	expected: string;
	/** Actual value received */
	actual: string;
	passed: boolean;
	/** Float tolerance used (if numeric comparison) */
	tolerance?: number;
}

/** Per-command output collected during script execution. */
export interface CommandOutput {
	line: number;
	content: string;
	result: import("../result.js").CommandResult;
	/** Section label for grouped results (e.g. filename from nested /run) */
	label?: string;
	/** Mode accent color (set when flattening nested /run results) */
	accent?: string;
}

/** Result of a full script run. */
export interface RunResult {
	ok: boolean;
	linesExecuted: number;
	expects: ExpectResult[];
	/** Per-command results for rendering output */
	results: CommandOutput[];
	/** Set if execution was aborted by a runtime error or "or abort" */
	error?: { line: number; message: string };
}

/** Parsed /expect command. */
export interface ParsedExpect {
	/** The command to execute in the current mode */
	command: string;
	/** Expected value to compare against */
	expected: string;
	/** Float tolerance (default 0.01) */
	tolerance: number;
	/** If true, abort the script on failure */
	abortOnFail: boolean;
}

/** Parsed /wait command. */
export interface ParsedWait {
	/** Duration in milliseconds */
	ms: number;
}

/** Execution segment for the optimizer. */
export type ExecutionSegment =
	| { kind: "single"; line: ScriptLine }
	| { kind: "batch"; lines: ScriptLine[]; mode: "builder" };
