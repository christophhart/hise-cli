// ── Mode interface — domain-specific input parsing ──────────────────

import type { CommandResult } from "../result.js";
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
	import: "#2de0a5",
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
	| "import";

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
}

export interface Mode {
	readonly id: ModeId;
	readonly name: string;
	readonly accent: string;
	readonly prompt: string;
	/** Dynamic context path (e.g. "SineGenerator.pitch" in builder mode) */
	readonly contextLabel?: string;
	parse(input: string, session: SessionContext): Promise<CommandResult>;
	complete?(input: string, cursor: number): CompletionResult;
	/** Tokenize input for syntax highlighting. Returns spans with token types. */
	tokenizeInput?(value: string): TokenSpan[];
}
