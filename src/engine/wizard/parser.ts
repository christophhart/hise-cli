// ── Wizard JSON parser — converts HISE multipage dialog JSON to WizardDefinition ──

import type {
	WizardDefinition,
	WizardField,
	WizardFieldType,
	WizardTab,
	WizardTask,
	WizardPostAction,
} from "./types.js";

// ── Raw JSON element shape (loose, matching HISE C++ output) ────────

interface RawElement {
	Type?: string;
	ID?: string;
	Text?: string;
	Children?: RawElement[];
	Help?: string;
	Required?: boolean;
	Items?: string;
	InitValue?: string;
	UseInitValue?: boolean | string;
	ValueMode?: string;
	EmptyText?: string;
	Directory?: boolean;
	Wildcard?: string;
	SaveFile?: boolean;
	ParseArray?: boolean;
	Multiline?: boolean;
	Foldable?: boolean;
	Folded?: boolean;
	ButtonType?: string;
	Trigger?: boolean;
	EventTrigger?: string;
	Function?: string;
	CallOnNext?: boolean | string;
	Code?: string;
	Style?: string;
	[key: string]: unknown;
}

interface RawWizardJson {
	Properties?: {
		Header?: string;
		Subtitle?: string;
		[key: string]: unknown;
	};
	GlobalState?: Record<string, unknown>;
	Children?: RawElement[];
	[key: string]: unknown;
}

// ── Field extraction ────────────────────────────────────────────────

/** Extract input fields from a raw element tree, recursing into containers. */
function extractFields(
	elements: RawElement[],
	globalDefaults: Record<string, string>,
): WizardField[] {
	const fields: WizardField[] = [];

	for (const el of elements) {
		const type = el.Type;

		if (type === "TextInput") {
			fields.push(makeTextField(el, globalDefaults));
		} else if (type === "FileSelector") {
			fields.push(makeFileField(el, globalDefaults));
		} else if (type === "Choice") {
			fields.push(makeChoiceField(el, globalDefaults));
		} else if (type === "Button" && isToggleButton(el)) {
			fields.push(makeToggleField(el, globalDefaults));
		} else if (type === "List" || type === "Column") {
			// Recurse into containers
			if (el.Children) {
				fields.push(...extractFields(el.Children, globalDefaults));
			}
		}
		// Skip: MarkdownText, SimpleText, JavascriptFunction, Placeholder,
		//        RelativeFileLoader, TagList, Branch (handled at tab level),
		//        LambdaTask (handled separately), trigger/text buttons
	}

	return fields;
}

function makeTextField(el: RawElement, defaults: Record<string, string>): WizardField {
	return {
		id: el.ID ?? "",
		type: "text",
		label: el.Text ?? el.ID ?? "",
		required: el.Required === true,
		help: el.Help,
		defaultValue: resolveDefault(el, defaults),
		emptyText: el.EmptyText,
		parseArray: el.ParseArray === true ? true : undefined,
	};
}

function makeFileField(el: RawElement, defaults: Record<string, string>): WizardField {
	return {
		id: el.ID ?? "",
		type: "file",
		label: el.Text ?? el.ID ?? "",
		required: el.Required === true,
		help: el.Help,
		defaultValue: resolveDefault(el, defaults),
		directory: el.Directory === true ? true : undefined,
		wildcard: el.Wildcard,
		saveFile: el.SaveFile === true ? true : undefined,
	};
}

function makeChoiceField(el: RawElement, defaults: Record<string, string>): WizardField {
	const items = el.Items
		? el.Items.split("\n").filter((s) => s.length > 0)
		: [];
	const valueMode = el.ValueMode === "Text" ? "text" as const : "index" as const;
	return {
		id: el.ID ?? "",
		type: "choice",
		label: el.Text ?? el.ID ?? "",
		required: false,
		help: el.Help,
		defaultValue: resolveDefault(el, defaults),
		items,
		valueMode,
	};
}

function makeToggleField(el: RawElement, defaults: Record<string, string>): WizardField {
	return {
		id: el.ID ?? "",
		type: "toggle",
		label: el.Text ?? el.ID ?? "",
		required: false,
		help: el.Help,
		defaultValue: resolveDefault(el, defaults),
	};
}

/** Determine whether a Button element is a toggle (vs. a trigger/text button). */
function isToggleButton(el: RawElement): boolean {
	// Trigger buttons and ButtonType:"Text" buttons are actions, not toggles
	if (el.Trigger === true) return false;
	if (el.ButtonType === "Text") return false;
	return true;
}

/** Determine whether a Button on the last page is a post-action trigger. */
function isPostActionButton(el: RawElement): boolean {
	return el.Trigger === true && el.ButtonType === "Text";
}

/** Resolve the default value for a field from InitValue or GlobalState. */
function resolveDefault(el: RawElement, globalDefaults: Record<string, string>): string | undefined {
	// Prefer explicit InitValue when UseInitValue is set
	if (el.UseInitValue && el.InitValue !== undefined) {
		return String(el.InitValue);
	}
	// Fall back to GlobalState
	const id = el.ID;
	if (id && id in globalDefaults) {
		return globalDefaults[id];
	}
	return undefined;
}

// ── Task extraction ─────────────────────────────────────────────────

/** Recursively find all LambdaTask elements. */
function extractTasks(elements: RawElement[]): WizardTask[] {
	const tasks: WizardTask[] = [];
	for (const el of elements) {
		if (el.Type === "LambdaTask") {
			const fn = el.Function ?? el.ID ?? "task";
			tasks.push({ id: el.ID || fn, function: fn });
		}
		if (el.Children) {
			tasks.push(...extractTasks(el.Children));
		}
	}
	return tasks;
}

// ── Post-action extraction ──────────────────────────────────────────

/** Extract post-action buttons from the last page's elements. */
function extractPostActions(elements: RawElement[]): WizardPostAction[] {
	const actions: WizardPostAction[] = [];
	for (const el of elements) {
		if (el.Type === "Button" && isPostActionButton(el)) {
			actions.push({
				id: el.ID ?? "",
				label: el.Text ?? el.ID ?? "",
				help: el.Help,
			});
		}
		if (el.Children) {
			actions.push(...extractPostActions(el.Children));
		}
	}
	return actions;
}

// ── Branch handling ─────────────────────────────────────────────────

/** Extract conditional tabs from Branch elements within a page. */
function extractBranchTabs(
	elements: RawElement[],
	globalDefaults: Record<string, string>,
	parentLabel: string,
): WizardTab[] {
	const tabs: WizardTab[] = [];
	for (const el of elements) {
		if (el.Type === "Branch" && el.ID && el.Children) {
			for (let i = 0; i < el.Children.length; i++) {
				const branch = el.Children[i]!;
				const fields = extractFields(branch.Children ?? [], globalDefaults);
				if (fields.length === 0) continue; // skip empty/Skip branches
				tabs.push({
					label: `${parentLabel} ${i + 1}`,
					fields,
					condition: { fieldId: el.ID, value: String(i) },
				});
			}
		}
		// Recurse into containers to find nested branches
		if ((el.Type === "List" || el.Type === "Column") && el.Children) {
			tabs.push(...extractBranchTabs(el.Children, globalDefaults, parentLabel));
		}
	}
	return tabs;
}

// ── Tab derivation ──────────────────────────────────────────────────

const DEFAULT_TAB_LABELS = ["Settings", "Execution", "Complete", "Options", "Advanced"];

/** Derive a tab label from the page element or fall back to a positional default. */
function deriveTabLabel(page: RawElement, index: number): string {
	if (page.Text && page.Text.trim().length > 0) return page.Text.trim();
	return DEFAULT_TAB_LABELS[index] ?? `Tab ${index + 1}`;
}

// ── Main parser ─────────────────────────────────────────────────────

/**
 * Parse a raw HISE multipage dialog JSON into a WizardDefinition.
 * @param filename - Source filename without extension (becomes the wizard ID)
 * @param raw - The parsed JSON object
 */
export function parseWizardJson(filename: string, raw: unknown): WizardDefinition {
	const data = raw as RawWizardJson;
	const pages = data.Children ?? [];
	const properties = data.Properties ?? {};
	const globalState = data.GlobalState ?? {};

	// Normalize GlobalState values to strings
	const globalDefaults: Record<string, string> = {};
	for (const [key, value] of Object.entries(globalState)) {
		globalDefaults[key] = String(value);
	}

	const tabs: WizardTab[] = [];
	const allTasks: WizardTask[] = [];
	let allPostActions: WizardPostAction[] = [];

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i]!;
		const pageChildren = page.Children ?? [];
		const label = deriveTabLabel(page, i);

		// Extract fields for this page (non-branch)
		const fields = extractFields(pageChildren, globalDefaults);

		// Only create a tab if the page has input fields
		if (fields.length > 0) {
			tabs.push({ label, fields });
		}

		// Extract branch-conditional tabs
		const branchTabs = extractBranchTabs(pageChildren, globalDefaults, label);
		tabs.push(...branchTabs);

		// Collect tasks from all pages
		allTasks.push(...extractTasks(pageChildren));

		// Extract post-actions from the last page
		if (i === pages.length - 1) {
			allPostActions = extractPostActions(pageChildren);
		}
	}

	// Deduplicate toggle fields that share the same ID (radio-group pattern).
	// HISE JSON uses multiple Button elements with the same ID for radio groups
	// (e.g., ExportType: "Plugin" and ExportType: "Standalone App").
	// Merge them into a single choice field.
	for (const tab of tabs) {
		deduplicateRadioGroups(tab);
	}

	return {
		id: filename,
		header: properties.Header ?? filename,
		subtitle: properties.Subtitle || undefined,
		tabs,
		tasks: allTasks,
		postActions: allPostActions,
		globalDefaults,
	};
}

/**
 * Detect toggle fields with duplicate IDs (radio-group pattern) and merge
 * them into a single choice field with items derived from their labels.
 */
function deduplicateRadioGroups(tab: WizardTab): void {
	const idCounts = new Map<string, number>();
	for (const field of tab.fields) {
		idCounts.set(field.id, (idCounts.get(field.id) ?? 0) + 1);
	}

	const duplicateIds = new Set<string>();
	for (const [id, count] of idCounts) {
		if (count > 1) duplicateIds.add(id);
	}

	if (duplicateIds.size === 0) return;

	// For each duplicate ID, collect all fields and merge into a choice
	const mutableFields = tab.fields as WizardField[];
	for (const dupId of duplicateIds) {
		const matching = mutableFields.filter((f) => f.id === dupId);
		if (matching.length < 2) continue;

		const items = matching.map((f) => f.label);
		const firstField = matching[0]!;
		const merged: WizardField = {
			id: dupId,
			type: "choice",
			label: dupId,
			required: false,
			help: firstField.help,
			defaultValue: firstField.defaultValue,
			items,
			valueMode: "text",
		};

		// Replace first occurrence, remove the rest
		const firstIndex = mutableFields.indexOf(firstField);
		mutableFields[firstIndex] = merged;
		for (let i = mutableFields.length - 1; i >= 0; i--) {
			if (mutableFields[i]!.id === dupId && i !== firstIndex) {
				mutableFields.splice(i, 1);
			}
		}
	}
}
