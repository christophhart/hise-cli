// ── Mode interface — domain-specific input parsing ──────────────────

import type { CommandResult, TreeNode } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";

// Mode accent colors from TUI_STYLE.md — Layer 2 (hardcoded)
export const MODE_ACCENTS = {
	root: "", // uses foreground.default
	builder: "#fd971f",
	script: "#C65638",
	dsp: "#3a6666",
	sampler: "#a6e22e",
	inspect: "#ae81ff",
	project: "#e6db74",
	compile: "#f92672",
	undo: "#66d9ef",
	wizard: "#e8a060",
	ui: "#66d9ef",
	sequence: "#56b6c2",
} as const;

export type ModeId =
	| "root"
	| "builder"
	| "script"
	| "dsp"
	| "sampler"
	| "inspect"
	| "project"
	| "compile"
	| "undo"
	| "wizard"
	| "ui"
	| "sequence";

export interface CompletionItem {
	label: string;
	detail?: string;
	insertText?: string;
}

export interface CompletionResult {
	items: CompletionItem[];
	from: number;
	to: number;
	/** Displayed as a header row in the completion popup (e.g. "Slash commands") */
	label?: string;
}

// Minimal session interface that modes depend on.
// The full Session class implements this. Avoids circular imports.
export interface SessionContext {
	readonly connection: import("../hise.js").HiseConnection | null;
	/** Exit the current mode (pops the mode stack). At root, signals quit. */
	popMode(): import("../result.js").CommandResult;
	/** Invalidate all cached mode trees — call after undo/redo operations. */
	invalidateAllTrees?(): void;
	/** Reset the undo mode's local plan tracking state (HISE discards groups on reset). */
	resetPlanState?(): void;
}

export interface Mode {
	readonly id: ModeId;
	readonly name: string;
	readonly accent: string;
	readonly prompt: string;
	/** Dynamic context path (e.g. "SineGenerator.pitch" in builder mode) */
	readonly contextLabel?: string;
	/** Label describing the tree sidebar content, shown in the TopBar
	 *  (e.g. "Module Tree", "Variable Tree"). Omit for modes with no tree. */
	readonly treeLabel?: string;
	parse(input: string, session: SessionContext): Promise<CommandResult>;
	complete?(input: string, cursor: number): CompletionResult;
	/** Tokenize input for syntax highlighting. Returns spans with token types. */
	tokenizeInput?(value: string): TokenSpan[];

	// ── Context entry (Phase 3.5.3) ─────────────────────────────
	/** Set the mode's context path (e.g., builder's currentPath, script's processor ID).
	 *  Called by dot-notation mode entry (/builder.SineGenerator.pitch) to navigate
	 *  to a specific location before entering the mode or executing a one-shot command. */
	setContext?(path: string): void;

	// ── Tree sidebar support ────────────────────────────────────
	/** Return the mode's navigable tree hierarchy, or null if the mode has no tree. */
	getTree?(): TreeNode | null;
	/** Return the currently selected path in the tree (array of node ids). */
	getSelectedPath?(): string[];
	/** Navigate to a node by path (called when the user selects a tree node). */
	selectNode?(path: string[]): void;

	/** Mark the mode's cached tree as stale so it re-fetches on next use.
	 *  Called by the session after one-shot undo commands change shared state. */
	invalidateTree?(): void;

	/** Called when the mode is entered (pushed onto stack). Async to allow data fetching. */
	onEnter?(session: SessionContext): Promise<void>;
}
