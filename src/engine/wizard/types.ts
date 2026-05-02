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
	/** Read-only: value is displayed but cannot be edited by the user.
	 *  Used for detected/computed state that should not be overridden. */
	readonly disabled?: boolean;
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

	// ── Visibility ──────────────────────────────────────────────
	/** Conditional visibility. A single condition or an array of conditions
	 *  (treated as AND — field visible only when all conditions match).
	 *  Hidden fields are skipped during rendering, navigation, and validation. */
	readonly visibleIf?: WizardVisibilityCondition | readonly WizardVisibilityCondition[];
}

/** One predicate evaluated against the current answers map. */
export interface WizardVisibilityCondition {
	/** ID of the field whose value the condition reads. */
	readonly fieldId: string;
	/** Value to match against. */
	readonly value: string;
	/** Match mode. `equals` (default) does strict string equality; `contains`
	 *  treats the answer as a `, `-joined CSV (multiselect storage format)
	 *  and matches when `value` is one of the tokens. */
	readonly match?: "equals" | "contains";
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

/** Execution type: "http" delegates to HISE, "internal" calls a registered TS function. */
export type WizardTaskType = "internal" | "http";

/** Pre-form initialization — fetches default values before the form renders. */
export interface WizardInit {
	/** Execution type for the init handler. */
	readonly type: WizardTaskType;
	/** Function name (internal registry key or ignored for http). */
	readonly function: string;
}

/** A task to execute when the wizard is submitted. */
export interface WizardTask {
	/** Unique identifier (from LambdaTask "ID"). */
	readonly id: string;
	/** Function name to invoke. */
	readonly function: string;
	/** Execution type. Defaults to "http" for backward compat with HISE wizards. */
	readonly type: WizardTaskType;
	/** Human-readable label shown as phase heading in progress output. */
	readonly label?: string;
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
	/** Pre-form initialization to fetch default values. */
	readonly init?: WizardInit;
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
	/** Slash command aliases (e.g. ["setup", "project create"] → /setup, /project create). */
	readonly aliases?: string[];
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
	// When true, the message is an in-place line update (e.g. from a
	// spinner using \r). Renderers may replace the previously rendered
	// transient line instead of appending a new one.
	readonly transient?: boolean;
}

/** Result returned after wizard execution completes. */
export interface WizardExecResult {
	readonly success: boolean;
	readonly message: string;
	readonly postActions?: WizardPostAction[];
	readonly logs?: string[];
	/** Structured data forwarded to subsequent tasks (e.g. build paths from prepare step). */
	readonly data?: Record<string, string>;
}

/** Init handler result — accepts both the flat map shape (legacy) and the
 *  structured shape that adds dynamic per-field items. */
export type InitDefaultsResult =
	| Record<string, string>
	| {
		defaults: Record<string, string>;
		items?: Record<string, string[]>;
		itemDescriptions?: Record<string, string[]>;
	};

/** Merge init-fetched defaults into a wizard definition's globalDefaults.
 *  When the structured form is supplied, dynamic `items` / `itemDescriptions`
 *  are also injected onto the matching fields. */
export function mergeInitDefaults(
	def: WizardDefinition,
	initResult: InitDefaultsResult,
): WizardDefinition {
	const { defaults, items, itemDescriptions } = normalizeInitResult(initResult);
	const hasItems = items && Object.keys(items).length > 0;
	const hasDescs = itemDescriptions && Object.keys(itemDescriptions).length > 0;
	if (Object.keys(defaults).length === 0 && !hasItems && !hasDescs) return def;

	let nextDef = def;
	if (hasItems || hasDescs) {
		nextDef = {
			...def,
			tabs: def.tabs.map((tab) => ({
				...tab,
				fields: tab.fields.map((f) => {
					const newItems = items?.[f.id];
					const newDescs = itemDescriptions?.[f.id];
					if (!newItems && !newDescs) return f;
					return {
						...f,
						...(newItems ? { items: newItems } : {}),
						...(newDescs ? { itemDescriptions: newDescs } : {}),
					};
				}),
			})),
		};
	}

	return {
		...nextDef,
		globalDefaults: { ...nextDef.globalDefaults, ...defaults },
	};
}

function normalizeInitResult(r: InitDefaultsResult): {
	defaults: Record<string, string>;
	items?: Record<string, string[]>;
	itemDescriptions?: Record<string, string[]>;
} {
	if (
		typeof r === "object"
		&& r !== null
		&& "defaults" in r
		&& typeof (r as { defaults?: unknown }).defaults === "object"
	) {
		const struct = r as {
			defaults: Record<string, string>;
			items?: Record<string, string[]>;
			itemDescriptions?: Record<string, string[]>;
		};
		return { defaults: struct.defaults, items: struct.items, itemDescriptions: struct.itemDescriptions };
	}
	return { defaults: r as Record<string, string> };
}

/** True if a toggle-style answer is enabled. Accepts both `"true"`/`"false"`
 *  (emitted by the form when the user flips a toggle) and `"1"`/`"0"`
 *  (often emitted by init/detection handlers probing the environment).
 *  Use this instead of raw `answer === "true"` in wizard handlers. */
export function isOn(value: string | undefined): boolean {
	return value === "true" || value === "1";
}
