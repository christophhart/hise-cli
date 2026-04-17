// ── Wizard block renderer — pure ANSI string output ─────────────────
//
// Produces a PrerenderedBlock from wizard form state using chalk.
// No React, no Ink — just strings. Displayed in the Output viewport.

import chalk from "chalk";
import type { ColorScheme } from "../theme.js";
import { brand, lightenHex } from "../theme.js";
import type { PrerenderedBlock } from "./prerender.js";
import { renderMarkdown } from "./Markdown.js";
import type { WizardDefinition, WizardField, WizardTab, WizardAnswers } from "../../engine/wizard/types.js";
import { isTabComplete } from "../../engine/wizard/validator.js";

// ── Form state (shared with wizard-keys.ts) ─────────────────────────

export interface WizardFormState {
	definition: WizardDefinition;
	answers: WizardAnswers;
	activeTab: number;
	activeField: number;    // fieldCount = submit button
	editing: boolean;
	/** When false, no field is highlighted with signal color (form dismissed). */
	active: boolean;
	// Text edit
	cursor: number;
	selectionAnchor: number | null;
	// Choice/multiselect edit
	choiceIndex: number;
	checkedIndices: Set<number>;
	// File completion
	completions: string[];
	completionIndex: number;
	// Escape
	escTimestamp: number;
}

export function createInitialFormState(def: WizardDefinition, prefill: WizardAnswers): WizardFormState {
	const answers: WizardAnswers = {};
	// Layer 1: field-level defaults from YAML
	for (const tab of def.tabs) {
		for (const field of tab.fields) {
			if (field.defaultValue !== undefined) answers[field.id] = field.defaultValue;
		}
	}
	// Layer 2: globalDefaults (includes init-fetched values) override field defaults
	for (const [k, v] of Object.entries(def.globalDefaults)) answers[k] = v;
	// Layer 3: explicit prefill from command args wins
	for (const [k, v] of Object.entries(prefill)) answers[k] = v;
	return {
		definition: def,
		answers,
		activeTab: 0,
		activeField: 0,
		editing: false,
		active: true,
		cursor: 0,
		completions: [],
		completionIndex: 0,
		selectionAnchor: null,
		choiceIndex: 0,
		checkedIndices: new Set(),
		escTimestamp: 0,
	};
}

export function isTabEnabled(tab: WizardTab, answers: WizardAnswers): boolean {
	if (!tab.condition) return true;
	return answers[tab.condition.fieldId] === tab.condition.value;
}

export function getVisibleTabIndices(def: WizardDefinition, answers: WizardAnswers): number[] {
	return def.tabs.map((_, i) => i).filter((i) => isTabEnabled(def.tabs[i]!, answers));
}

// ── Renderer ────────────────────────────────────────────────────────

export function renderWizardBlock(
	state: WizardFormState,
	scheme: ColorScheme,
	width: number,
): PrerenderedBlock {
	const def = state.definition;
	const bg = chalk.bgHex(scheme.backgrounds.raised);
	const accent = "#e8a060";
	const signal = brand.signal;
	const padLen = 2;
	const pad = " ".repeat(padLen);
	const innerWidth = Math.max(20, width - padLen * 2);

	const c = {
		accent: chalk.hex(accent),
		accentBold: chalk.hex(accent).bold,
		signal: chalk.hex(signal),
		signalBold: chalk.hex(signal).bold,
		muted: chalk.hex(scheme.foreground.muted),
		default: chalk.hex(scheme.foreground.default),
		bright: chalk.hex(scheme.foreground.bright),
		cursorBg: chalk.bgHex(lightenHex(scheme.backgrounds.raised, 0.3)),
		selBg: chalk.bgHex(lightenHex(scheme.backgrounds.raised, 0.5)),
	};

	/** Pad a line to exactly `width` chars with the bg color. */
	const line = (content: string): string => {
		const stripped = stripAnsi(content);
		const rightPad = Math.max(0, width - stripped.length);
		return bg(content + " ".repeat(rightPad));
	};

	const emptyLine = (): string => line("");

	const lines: string[] = [];
	const tab = def.tabs[state.activeTab];
	if (!tab) return { lines: [emptyLine()], height: 1 };

	const fields = tab.fields;
	const fieldCount = fields.length;
	const isOnSubmit = state.active && state.activeField === fieldCount;

	// ── Header ──────────────────────────────────────────────
	lines.push(emptyLine());
	const desc = def.description ? `  ${c.muted(def.description)}` : "";
	lines.push(line(`${pad}${c.accent("\u2726")} ${c.accentBold(def.header)}${desc}`));
	lines.push(emptyLine());

	// ── Body (markdown) ─────────────────────────────────────
	if (def.body) {
		const rendered = renderMarkdown(def.body, { scheme, accent, width: innerWidth - 2 });
		const bodyLines = rendered.split("\n");
		for (const bl of bodyLines) {
			lines.push(line(`${pad}  ${bl}`));
		}
	}
	lines.push(emptyLine());

	// ── Tab bar ─────────────────────────────────────────────
	let tabStr = pad;
	for (let i = 0; i < def.tabs.length; i++) {
		const t = def.tabs[i]!;
		const enabled = isTabEnabled(t, state.answers);
		const active = i === state.activeTab;
		const complete = isTabComplete(t, state.answers);
		const check = complete ? " \u2713" : " \u25CB";
		const label = ` ${t.label}${check} `;
		if (!enabled) {
			tabStr += c.muted(label);
		} else if (active) {
			tabStr += c.accentBold(label);
		} else {
			tabStr += c.default(label);
		}
		if (i < def.tabs.length - 1) {
			tabStr += c.muted("\u2502");
		}
	}
	lines.push(line(tabStr));
	lines.push(line(`${pad}${c.muted("\u2500".repeat(innerWidth))}`));

	// ── Help text ───────────────────────────────────────────
	const currentField = fields[state.activeField];
	const helpText = currentField?.help ?? "";
	lines.push(line(`${pad}${c.muted(helpText.slice(0, innerWidth))}`));
	lines.push(emptyLine());

	// ── Fields ──────────────────────────────────────────────
	const maxLabelLen = Math.max(...fields.map((f) => f.label.length), 4);
	const valueCol = padLen + 2 + maxLabelLen + 3; // pad + indicator + label + " : "

	for (let i = 0; i < fieldCount; i++) {
		const field = fields[i]!;
		const focused = state.active && i === state.activeField && !isOnSubmit;
		const isEditing = focused && state.editing;
		const value = state.answers[field.id] ?? "";

		const needsValue = field.required && (!value || value.trim().length === 0);
		const indicator = focused ? c.signal("\u25B8 ") : needsValue ? c.accent("* ") : "  ";
		const labelPad = " ".repeat(maxLabelLen - field.label.length);
		const labelText = field.disabled
			? c.muted(field.label)
			: focused
				? (isEditing ? c.accentBold(field.label) : c.signalBold(field.label))
				: c.default(field.label);
		const prefix = `${pad}${indicator}${labelText}${labelPad}${c.muted(" : ")}`;

		if (isEditing && (field.type === "choice" || field.type === "multiselect")) {
			// Expanded options with tooltip on focused item
			const items = field.items ?? [];
			const descs = field.itemDescriptions ?? [];
			const valuePad = " ".repeat(valueCol);

			for (let j = 0; j < items.length; j++) {
				const item = items[j]!;
				const isFocused = j === state.choiceIndex;
				const tooltip = descs[j] ? `  ${c.muted(descs[j])}` : "";

				if (field.type === "multiselect") {
					const checked = state.checkedIndices.has(j);
					const checkbox = checked ? c.signal("[\u2713]") : c.muted("[ ]");
					const label = isFocused ? c.signalBold(item) : c.default(item);
					const cursor = isFocused ? c.signal("\u25B8 ") : "  ";
					if (j === 0) {
						lines.push(line(`${prefix}${cursor}${checkbox} ${label}${tooltip}`));
					} else {
						lines.push(line(`${valuePad}${cursor}${checkbox} ${label}${tooltip}`));
					}
				} else {
					const indicator = isFocused ? c.signal("\u25B8 ") : "  ";
					const label = isFocused ? c.signalBold(item) : c.default(item);
					if (j === 0) {
						lines.push(line(`${prefix}${indicator}${label}${tooltip}`));
					} else {
						lines.push(line(`${valuePad}${indicator}${label}${tooltip}`));
					}
				}
			}
		} else if (isEditing && field.type === "file" && state.completions.length > 0) {
			// File field with completion suggestions — render value + suggestions below
			const valueStr = renderValue(field, value, focused, isEditing, state, c, scheme);
			lines.push(line(`${prefix}${valueStr}`));

			const completionPad = " ".repeat(valueCol);
			const maxShow = Math.min(state.completions.length, 8);
			for (let j = 0; j < maxShow; j++) {
				const comp = state.completions[j]!;
				const isFocused = j === state.completionIndex;
				const indicator = isFocused ? c.signal("\u25B8 ") : "  ";
				const label = isFocused ? c.signalBold(comp) : c.muted(comp);
				lines.push(line(`${completionPad}${indicator}${label}`));
			}
			if (state.completions.length > maxShow) {
				lines.push(line(`${completionPad}  ${c.muted(`... ${state.completions.length - maxShow} more`)}`));
			}
		} else {
			// Single-line field value
			const valueStr = renderValue(field, value, focused, isEditing, state, c, scheme);
			lines.push(line(`${prefix}${valueStr}`));
		}
	}

	// ── Submit button ───────────────────────────────────────
	lines.push(emptyLine());
	const allComplete = def.tabs
		.filter((t) => isTabEnabled(t, state.answers))
		.every((t) => isTabComplete(t, state.answers));
	const submitIndicator = isOnSubmit ? c.signal("\u25B8 ") : "  ";
	const submitColor = isOnSubmit ? c.signalBold : allComplete ? c.default : c.muted;
	const submitTooltip = def.submitLabel ? `  ${c.muted(def.submitLabel)}` : "";
	lines.push(line(`${pad}${submitIndicator}${submitColor("[ Submit ]")}${submitTooltip}`));

	// ── Hint bar ────────────────────────────────────────────
	lines.push(emptyLine());
	let hint: string;
	if (state.escTimestamp > 0) {
		hint = "press esc again to cancel";
	} else if (state.editing) {
		const ft = currentField?.type;
		if (ft === "choice") hint = "\u2191\u2193: navigate  enter: select  esc: cancel";
		else if (ft === "multiselect") hint = "\u2191\u2193: navigate  space: toggle  enter: confirm  esc: cancel";
		else hint = "type to edit  enter: done  esc: cancel";
	} else {
		hint = "\u2190\u2192/tab: pages  \u2191\u2193: select  enter/space: edit  esc\u00D72: cancel";
	}
	lines.push(line(`${pad}${c.muted(hint)}`));
	lines.push(emptyLine());

	return { lines, height: lines.length };
}

// ── Value renderers ─────────────────────────────────────────────────

type ChalkFn = (text: string) => string;

interface Colors {
	accent: ChalkFn;
	signal: ChalkFn;
	signalBold: ChalkFn;
	muted: ChalkFn;
	default: ChalkFn;
	bright: ChalkFn;
	cursorBg: ChalkFn;
	selBg: ChalkFn;
}

function renderValue(
	field: WizardField,
	value: string,
	focused: boolean,
	editing: boolean,
	state: WizardFormState,
	c: Colors,
	scheme: ColorScheme,
): string {
	const color = field.disabled ? c.muted : editing ? c.accent : focused ? c.signal : c.default;

	if (field.type === "toggle") {
		const checked = value === "true" || value === "1";
		return color(checked ? "[\u2713]" : "[ ]");
	}

	if (field.type === "choice") {
		const items = field.items ?? [];
		if (field.valueMode === "index") {
			const idx = parseInt(value, 10);
			return color(items[idx] ?? value ?? "(none)");
		}
		return color(value || items[0] || "(none)");
	}

	if (field.type === "multiselect") {
		return value ? color(value) : c.muted("(none selected)");
	}

	// Text / File
	const isEmpty = !value || value.length === 0;

	if (!editing) {
		if (isEmpty) return c.muted(field.emptyText ?? "");
		return color(value);
	}

	// Editing with cursor
	if (isEmpty) {
		const ph = field.emptyText ?? " ";
		return c.cursorBg(c.muted(ph[0]!)) + c.muted(ph.slice(1));
	}

	const hasSelection = state.selectionAnchor !== null && state.selectionAnchor !== state.cursor;
	if (hasSelection) {
		const selStart = Math.min(state.selectionAnchor!, state.cursor);
		const selEnd = Math.max(state.selectionAnchor!, state.cursor);
		const before = value.slice(0, selStart);
		const selected = value.slice(selStart, selEnd);
		const after = value.slice(selEnd);
		return c.accent(before) + c.selBg(c.accent(selected)) + c.accent(after);
	}

	const before = value.slice(0, state.cursor);
	const cursorChar = state.cursor < value.length ? value[state.cursor]! : " ";
	const after = state.cursor < value.length ? value.slice(state.cursor + 1) : "";
	return c.accent(before) + c.cursorBg(c.accent(cursorChar)) + c.accent(after);
}

// ── ANSI strip ──────────────────────────────────────────────────────

function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}
