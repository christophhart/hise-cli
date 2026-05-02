// ── Wizard answer validation ────────────────────────────────────────

import type {
	WizardDefinition,
	WizardAnswers,
	WizardValidation,
	WizardField,
} from "./types.js";

/**
 * Validate wizard answers against the definition.
 * Fields in greyed-out tabs (condition not met) are skipped.
 */
export function validateAnswers(
	def: WizardDefinition,
	answers: WizardAnswers,
): WizardValidation {
	const errors: Array<{ fieldId: string; message: string }> = [];

	for (const tab of def.tabs) {
		// Skip fields in conditional tabs whose condition is not met
		if (tab.condition) {
			const condValue = answers[tab.condition.fieldId];
			if (condValue !== tab.condition.value) continue;
		}

		for (const field of tab.fields) {
			if (!isFieldVisible(field, answers)) continue;
			const value = answers[field.id];
			const fieldErrors = validateField(field, value);
			errors.push(...fieldErrors);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

function validateField(
	field: WizardField,
	value: string | undefined,
): Array<{ fieldId: string; message: string }> {
	const errors: Array<{ fieldId: string; message: string }> = [];

	// Required check
	if (field.required && (!value || value.trim().length === 0)) {
		errors.push({
			fieldId: field.id,
			message: `${field.label} is required`,
		});
		return errors; // no point checking further
	}

	// Choice value check
	if (field.type === "choice" && field.items && value !== undefined && value.length > 0) {
		if (field.valueMode === "index") {
			const idx = parseInt(value, 10);
			if (isNaN(idx) || idx < 0 || idx >= field.items.length) {
				errors.push({
					fieldId: field.id,
					message: `${field.label}: invalid index "${value}" (0-${field.items.length - 1})`,
				});
			}
		} else {
			if (!field.items.includes(value)) {
				errors.push({
					fieldId: field.id,
					message: `${field.label}: "${value}" is not a valid option`,
				});
			}
		}
	}

	return errors;
}

/**
 * Check whether a single field has a valid value (for tab checkmark status).
 * Returns true if the field is satisfied (either optional, or required and filled).
 */
export function isFieldSatisfied(field: WizardField, value: string | undefined): boolean {
	if (!field.required) return true;
	return value !== undefined && value.trim().length > 0;
}

/**
 * Check whether all required fields in a tab are satisfied.
 */
export function isTabComplete(
	tab: { fields: WizardField[] },
	answers: WizardAnswers,
): boolean {
	return tab.fields.every((f) => !isFieldVisible(f, answers) || isFieldSatisfied(f, answers[f.id]));
}

/**
 * Evaluate a field's `visibleIf` condition against current answers.
 * A field with no condition is always visible. An array is AND of all entries.
 */
export function isFieldVisible(field: WizardField, answers: WizardAnswers): boolean {
	if (!field.visibleIf) return true;
	const conditions = Array.isArray(field.visibleIf) ? field.visibleIf : [field.visibleIf];
	return conditions.every((c) => evaluateCondition(c, answers));
}

function evaluateCondition(
	condition: { fieldId: string; value: string; match?: "equals" | "contains" },
	answers: WizardAnswers,
): boolean {
	const actual = answers[condition.fieldId] ?? "";
	if (condition.match === "contains") {
		const tokens = actual.split(/\s*,\s*/).filter((t) => t.length > 0);
		return tokens.includes(condition.value);
	}
	return actual === condition.value;
}

/**
 * Return the subset of tab fields currently visible under the given answers.
 */
export function getVisibleFields(
	tab: { fields: WizardField[] },
	answers: WizardAnswers,
): WizardField[] {
	return tab.fields.filter((f) => isFieldVisible(f, answers));
}
