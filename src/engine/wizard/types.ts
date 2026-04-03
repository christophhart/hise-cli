// ── Wizard types — internal representation of wizard definitions ─────
//
// Converted from HISE C++ multipage dialog JSON format by parser.ts.
// These types are the engine-layer contract consumed by TUI and CLI.

/** Field input types that map to HISE multipage dialog element types. */
export type WizardFieldType = "text" | "file" | "choice" | "toggle" | "multiselect";

/** A single input field within a wizard tab. */
export interface WizardField {
	/** Unique identifier (from JSON element "ID"). */
	readonly id: string;
	/** Input type determining the field renderer. */
	readonly type: WizardFieldType;
	/** Human-readable label (from JSON element "Text"). */
	readonly label: string;
	/** Whether the field must have a value before submission. */
	readonly required: boolean;
	/** Markdown help text shown in the help area when focused. */
	readonly help?: string;
	/** Default value (from GlobalState or InitValue). */
	readonly defaultValue?: string;
	/** Placeholder text shown when the field is empty. */
	readonly emptyText?: string;

	// ── Choice-specific ─────────────────────────────────────────
	/** Available options for "choice" and "multiselect" fields. */
	readonly items?: string[];
	/** Per-item descriptions (parallel array to items). Shown as dimmed tooltip on focused item. */
	readonly itemDescriptions?: string[];
	/** How the choice value is stored: "text" (literal) or "index" (numeric). */
	readonly valueMode?: "text" | "index";

	// ── File-specific ───────────────────────────────────────────
	/** Whether the file selector picks a directory (true) or file (false). */
	readonly directory?: boolean;
	/** File extension filter (e.g., "*.wav", "*.hxi,*.lwc"). */
	readonly wildcard?: string;
	/** Whether the file selector is a save dialog (true) or open dialog (false). */
	readonly saveFile?: boolean;

	// ── Text-specific ───────────────────────────────────────────
	/** Whether the value is parsed as a comma-separated array. */
	readonly parseArray?: boolean;
}

/** A tab grouping fields in the wizard form. */
export interface WizardTab {
	/** Tab header text (from List "Text" property or derived). */
	readonly label: string;
	/** Fields displayed within this tab. */
	readonly fields: WizardField[];
	/** Conditional visibility: tab is greyed out unless the condition is met. */
	readonly condition?: {
		/** Field ID whose value determines visibility (Branch ID in JSON). */
		readonly fieldId: string;
		/** The value (or index) that activates this tab. */
		readonly value: string;
	};
}

/** A task to execute when the wizard is submitted. */
export interface WizardTask {
	/** Unique identifier (from LambdaTask "ID"). */
	readonly id: string;
	/** Function name to invoke on the HISE side. */
	readonly function: string;
}

/** An optional follow-up action offered after successful execution. */
export interface WizardPostAction {
	/** Unique identifier (from Button "ID"). */
	readonly id: string;
	/** Display label (from Button "Text"). */
	readonly label: string;
	/** Help text for the action. */
	readonly help?: string;
}

/** Complete wizard definition — the engine-layer representation. */
export interface WizardDefinition {
	/** Wizard identifier derived from the source filename (e.g., "plugin_export"). */
	readonly id: string;
	/** Display title (from Properties.Header). */
	readonly header: string;
	/** Short description shown dimmed next to the header. */
	readonly description?: string;
	/** Markdown body rendered below the header (usage tips, bullet points). */
	readonly body?: string;
	/** Optional subtitle (from Properties.Subtitle). */
	readonly subtitle?: string;
	/** Tab groups containing all input fields. */
	readonly tabs: WizardTab[];
	/** Tasks to execute on submission. */
	readonly tasks: WizardTask[];
	/** Optional follow-up actions after successful execution. */
	readonly postActions: WizardPostAction[];
	/** Description shown next to the Submit button (explains what happens on submit). */
	readonly submitLabel?: string;
	/** Default field values from GlobalState. */
	readonly globalDefaults: Record<string, string>;
}

// ── Runtime types ───────────────────────────────────────────────────

/** Answer map: field ID → value string. */
export type WizardAnswers = Record<string, string>;

/** Validation result from validateAnswers(). */
export interface WizardValidation {
	readonly valid: boolean;
	readonly errors: ReadonlyArray<{ readonly fieldId: string; readonly message: string }>;
}

/** Progress update emitted during wizard execution. */
export interface WizardProgress {
	readonly phase: string;
	readonly percent?: number;
	readonly message?: string;
}

/** Result returned after wizard execution completes. */
export interface WizardExecResult {
	readonly success: boolean;
	readonly message: string;
	readonly postActions?: WizardPostAction[];
	readonly logs?: string[];
}
