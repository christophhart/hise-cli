// ── Wizard key handler — pure state transitions ─────────────────────
//
// Pure function: takes current state + keystroke, returns new state.
// No React, no Ink, no side effects.

import type { WizardFormState } from "./wizard-render.js";
import { isTabEnabled, getVisibleTabIndices } from "./wizard-render.js";
import { isTabComplete, getVisibleFields } from "../../engine/wizard/validator.js";
import { wordBoundaryLeft, wordBoundaryRight } from "./Input.js";

const ESC_TIMEOUT_MS = 500;

export interface KeyInfo {
	upArrow: boolean;
	downArrow: boolean;
	leftArrow: boolean;
	rightArrow: boolean;
	return: boolean;
	escape: boolean;
	tab: boolean;
	backspace: boolean;
	delete: boolean;
	shift: boolean;
	meta: boolean;
	ctrl: boolean;
}

export type WizardKeyResult =
	| { action: "update"; state: WizardFormState; recomputeCompletions?: boolean }
	| { action: "submit"; answers: import("../../engine/wizard/types.js").WizardAnswers }
	| { action: "cancel" }
	| null; // key not consumed

export function handleWizardKey(
	state: WizardFormState,
	input: string,
	key: KeyInfo,
): WizardKeyResult {
	const def = state.definition;
	const tab = def.tabs[state.activeTab];
	if (!tab) return null;

	const visibleFields = getVisibleFields(tab, state.answers);
	const fieldCount = visibleFields.length;
	const isOnSubmit = state.activeField === fieldCount;
	const field = visibleFields[state.activeField];
	const visibleTabs = getVisibleTabIndices(def, state.answers);

	// ── Escape ──────────────────────────────────────────────
	if (key.escape) {
		if (state.editing) {
			return { action: "update", state: { ...state, editing: false, escTimestamp: 0 } };
		}
		const now = Date.now();
		if (state.escTimestamp > 0 && (now - state.escTimestamp) < ESC_TIMEOUT_MS) {
			return { action: "cancel" };
		}
		return { action: "update", state: { ...state, escTimestamp: now } };
	}

	// Clear esc pending on any other key
	const s = state.escTimestamp > 0 ? { ...state, escTimestamp: 0 } : state;

	// ── Edit mode: choice ───────────────────────────────────
	if (s.editing && field?.type === "choice") {
		const items = field.items ?? [];
		if (key.upArrow) {
			const next = (s.choiceIndex - 1 + items.length) % items.length;
			return { action: "update", state: { ...s, choiceIndex: next } };
		}
		if (key.downArrow) {
			const next = (s.choiceIndex + 1) % items.length;
			return { action: "update", state: { ...s, choiceIndex: next } };
		}
		if (key.return) {
			const selected = items[s.choiceIndex];
			if (!selected) return { action: "update", state: { ...s, editing: false } };
			const newValue = field.valueMode === "index" ? String(s.choiceIndex) : selected;
			return { action: "update", state: {
				...s,
				answers: { ...s.answers, [field.id]: newValue },
				editing: false,
			}};
		}
		return { action: "update", state: s }; // consume key
	}

	// ── Edit mode: multiselect ──────────────────────────────
	if (s.editing && field?.type === "multiselect") {
		const items = field.items ?? [];
		if (key.upArrow) {
			const next = (s.choiceIndex - 1 + items.length) % items.length;
			return { action: "update", state: { ...s, choiceIndex: next } };
		}
		if (key.downArrow) {
			const next = (s.choiceIndex + 1) % items.length;
			return { action: "update", state: { ...s, choiceIndex: next } };
		}
		if (input === " ") {
			const checked = new Set(s.checkedIndices);
			if (checked.has(s.choiceIndex)) checked.delete(s.choiceIndex);
			else checked.add(s.choiceIndex);
			return { action: "update", state: { ...s, checkedIndices: checked } };
		}
		if (key.return) {
			const selected = items.filter((_, i) => s.checkedIndices.has(i));
			return { action: "update", state: {
				...s,
				answers: { ...s.answers, [field.id]: selected.join(", ") },
				editing: false,
			}};
		}
		return { action: "update", state: s };
	}

	// ── Edit mode: text / file ──────────────────────────────
	if (s.editing && field && (field.type === "text" || field.type === "file")) {
		const value = s.answers[field.id] ?? "";
		const isFile = field.type === "file";
		const hasCompletions = isFile && s.completions.length > 0;

		// Tab: accept focused completion (file fields only)
		if (key.tab && hasCompletions) {
			const comp = s.completions[s.completionIndex];
			if (comp) {
				return {
					action: "update",
					state: { ...s, answers: { ...s.answers, [field.id]: comp }, cursor: comp.length, selectionAnchor: null, completions: [], completionIndex: 0 },
					recomputeCompletions: true,
				};
			}
		}

		// Enter: exit edit (keep current typed value, ignore completion selection)
		if (key.return) {
			return { action: "update", state: { ...s, editing: false, completions: [], completionIndex: 0 } };
		}

		// Up/Down: navigate completions (file) or do nothing (text)
		if (key.upArrow && hasCompletions) {
			const next = (s.completionIndex - 1 + s.completions.length) % s.completions.length;
			return { action: "update", state: { ...s, completionIndex: next } };
		}
		if (key.downArrow && hasCompletions) {
			const next = (s.completionIndex + 1) % s.completions.length;
			return { action: "update", state: { ...s, completionIndex: next } };
		}

		// Backspace — Ink on macOS reports backspace as key.delete, so treat both the same
		if (key.backspace || key.delete) {
			if (s.selectionAnchor !== null) {
				const start = Math.min(s.selectionAnchor, s.cursor);
				const end = Math.max(s.selectionAnchor, s.cursor);
				const newVal = value.slice(0, start) + value.slice(end);
				return { action: "update", state: { ...s, answers: { ...s.answers, [field.id]: newVal }, cursor: start, selectionAnchor: null }, recomputeCompletions: isFile };
			}
			if (s.cursor <= 0) return { action: "update", state: s };
			const newVal = value.slice(0, s.cursor - 1) + value.slice(s.cursor);
			return { action: "update", state: { ...s, answers: { ...s.answers, [field.id]: newVal }, cursor: s.cursor - 1, selectionAnchor: null }, recomputeCompletions: isFile };
		}

		if (key.leftArrow) {
			const dir = key.meta ? "home" : key.ctrl ? "wordLeft" : "left";
			const dest = moveCursor(value, s.cursor, dir);
			if (key.shift) {
				return { action: "update", state: { ...s, cursor: dest, selectionAnchor: s.selectionAnchor ?? s.cursor } };
			}
			return { action: "update", state: { ...s, cursor: dest, selectionAnchor: null } };
		}

		if (key.rightArrow) {
			const dir = key.meta ? "end" : key.ctrl ? "wordRight" : "right";
			const dest = moveCursor(value, s.cursor, dir);
			if (key.shift) {
				return { action: "update", state: { ...s, cursor: dest, selectionAnchor: s.selectionAnchor ?? s.cursor } };
			}
			return { action: "update", state: { ...s, cursor: dest, selectionAnchor: null } };
		}

		if (key.ctrl && input === "a") {
			if (value.length === 0) return { action: "update", state: s };
			return { action: "update", state: { ...s, selectionAnchor: 0, cursor: value.length } };
		}

		// Printable character
		if (input.length === 1 && !key.ctrl && !key.meta) {
			if (s.selectionAnchor !== null) {
				const start = Math.min(s.selectionAnchor, s.cursor);
				const end = Math.max(s.selectionAnchor, s.cursor);
				const newVal = value.slice(0, start) + input + value.slice(end);
				return { action: "update", state: { ...s, answers: { ...s.answers, [field.id]: newVal }, cursor: start + 1, selectionAnchor: null }, recomputeCompletions: isFile };
			}
			const newVal = value.slice(0, s.cursor) + input + value.slice(s.cursor);
			return { action: "update", state: { ...s, answers: { ...s.answers, [field.id]: newVal }, cursor: s.cursor + 1, selectionAnchor: null }, recomputeCompletions: isFile };
		}

		return { action: "update", state: s };
	}

	// ── Navigate mode ───────────────────────────────────────

	// Tab / Shift+Tab / Left / Right: switch pages
	if (key.tab || key.leftArrow || key.rightArrow) {
		const dir = key.shift || key.leftArrow ? -1 : 1;
		const currentVisIdx = visibleTabs.indexOf(s.activeTab);
		if (currentVisIdx === -1) return { action: "update", state: s };
		let next = currentVisIdx + dir;
		if (next < 0) next = visibleTabs.length - 1;
		if (next >= visibleTabs.length) next = 0;
		return { action: "update", state: { ...s, activeTab: visibleTabs[next]!, activeField: 0, editing: false, cursor: 0, selectionAnchor: null } };
	}

	// Up/Down: select field (including submit button)
	if (key.upArrow) {
		return { action: "update", state: { ...s, activeField: Math.max(0, s.activeField - 1) } };
	}
	if (key.downArrow) {
		return { action: "update", state: { ...s, activeField: Math.min(fieldCount, s.activeField + 1) } };
	}

	// Enter/Space: activate
	if (key.return || input === " ") {
		// Submit button
		if (isOnSubmit && key.return) {
			const allComplete = def.tabs
				.filter((t) => isTabEnabled(t, s.answers))
				.every((t) => isTabComplete(t, s.answers));
			if (allComplete) {
				return { action: "submit", answers: s.answers };
			}
			return { action: "update", state: s }; // stay, could show hint
		}

		if (!field) return { action: "update", state: s };

		// Disabled fields are read-only: swallow Enter/Space silently
		// so the user can still navigate past them with arrow keys.
		if (field.disabled) return { action: "update", state: s };

		// Toggle
		if (field.type === "toggle") {
			const val = s.answers[field.id] ?? "";
			const current = val === "true" || val === "1";
			return { action: "update", state: { ...s, answers: { ...s.answers, [field.id]: current ? "false" : "true" } } };
		}

		// Choice: enter edit with current value pre-selected
		if (field.type === "choice") {
			const items = field.items ?? [];
			const value = s.answers[field.id] ?? "";
			const idx = field.valueMode === "index"
				? parseInt(value, 10) || 0
				: Math.max(0, items.indexOf(value));
			return { action: "update", state: { ...s, editing: true, choiceIndex: idx } };
		}

		// Multiselect: enter edit with current selections
		if (field.type === "multiselect") {
			const items = field.items ?? [];
			const value = s.answers[field.id] ?? "";
			const selected = value ? value.split(",").map((v) => v.trim()).filter(Boolean) : [];
			const checked = new Set<number>();
			for (let i = 0; i < items.length; i++) {
				if (selected.includes(items[i]!)) checked.add(i);
			}
			return { action: "update", state: { ...s, editing: true, choiceIndex: 0, checkedIndices: checked } };
		}

		// Text / File: enter edit with cursor at end
		if (field.type === "text" || field.type === "file") {
			const value = s.answers[field.id] ?? "";
			return {
				action: "update",
				state: { ...s, editing: true, cursor: value.length, selectionAnchor: null, completions: [], completionIndex: 0 },
				recomputeCompletions: field.type === "file",
			};
		}

		return { action: "update", state: s };
	}

	return { action: "update", state: s }; // consume all keys when wizard is active
}

function moveCursor(value: string, pos: number, dir: string): number {
	switch (dir) {
		case "left": return Math.max(0, pos - 1);
		case "right": return Math.min(value.length, pos + 1);
		case "home": return 0;
		case "end": return value.length;
		case "wordLeft": return wordBoundaryLeft(value, pos);
		case "wordRight": return wordBoundaryRight(value, pos);
		default: return pos;
	}
}
