import { describe, it, expect } from "vitest";
import { validateAnswers, isFieldSatisfied, isTabComplete, isFieldVisible } from "./validator.js";
import type { WizardDefinition, WizardField, WizardTab } from "./types.js";

function makeDef(tabs: WizardTab[]): WizardDefinition {
	return {
		id: "test",
		header: "Test",
		tabs,
		tasks: [],
		postActions: [],
		globalDefaults: {},
	};
}

function makeField(overrides: Partial<WizardField> & { id: string }): WizardField {
	return {
		type: "text",
		label: overrides.id,
		required: false,
		...overrides,
	};
}

describe("validateAnswers", () => {
	it("passes when all required fields are filled", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [
				makeField({ id: "name", required: true }),
				makeField({ id: "desc", required: false }),
			],
		}]);
		const result = validateAnswers(def, { name: "MyProject" });
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("fails when a required field is empty", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [makeField({ id: "name", required: true })],
		}]);
		const result = validateAnswers(def, {});
		expect(result.valid).toBe(false);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]!.fieldId).toBe("name");
	});

	it("fails when a required field is whitespace only", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [makeField({ id: "name", required: true })],
		}]);
		const result = validateAnswers(def, { name: "   " });
		expect(result.valid).toBe(false);
	});

	it("validates choice field values against items", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [makeField({
				id: "format",
				type: "choice",
				items: ["VST", "AU", "AAX"],
				valueMode: "text",
			})],
		}]);
		expect(validateAnswers(def, { format: "VST" }).valid).toBe(true);
		expect(validateAnswers(def, { format: "LADSPA" }).valid).toBe(false);
	});

	it("validates choice index mode", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [makeField({
				id: "template",
				type: "choice",
				items: ["Empty", "Import", "Rhapsody"],
				valueMode: "index",
			})],
		}]);
		expect(validateAnswers(def, { template: "0" }).valid).toBe(true);
		expect(validateAnswers(def, { template: "2" }).valid).toBe(true);
		expect(validateAnswers(def, { template: "5" }).valid).toBe(false);
		expect(validateAnswers(def, { template: "-1" }).valid).toBe(false);
	});

	it("skips fields in conditional tabs whose condition is not met", () => {
		const def = makeDef([
			{
				label: "Main",
				fields: [makeField({ id: "mode", type: "choice", items: ["A", "B"], valueMode: "index" })],
			},
			{
				label: "Branch A",
				fields: [makeField({ id: "a_field", required: true })],
				condition: { fieldId: "mode", value: "0" },
			},
			{
				label: "Branch B",
				fields: [makeField({ id: "b_field", required: true })],
				condition: { fieldId: "mode", value: "1" },
			},
		]);
		// mode=0, so Branch A is active (a_field required), Branch B is skipped
		const result = validateAnswers(def, { mode: "0", a_field: "filled" });
		expect(result.valid).toBe(true);
	});

	it("reports errors from active conditional tab", () => {
		const def = makeDef([
			{
				label: "Main",
				fields: [makeField({ id: "mode", type: "choice", items: ["A", "B"], valueMode: "index" })],
			},
			{
				label: "Branch A",
				fields: [makeField({ id: "a_field", required: true })],
				condition: { fieldId: "mode", value: "0" },
			},
		]);
		const result = validateAnswers(def, { mode: "0" });
		expect(result.valid).toBe(false);
		expect(result.errors[0]!.fieldId).toBe("a_field");
	});

	it("allows empty optional choice fields", () => {
		const def = makeDef([{
			label: "Settings",
			fields: [makeField({
				id: "format",
				type: "choice",
				items: ["VST", "AU"],
				valueMode: "text",
			})],
		}]);
		expect(validateAnswers(def, {}).valid).toBe(true);
		expect(validateAnswers(def, { format: "" }).valid).toBe(true);
	});
});

describe("isFieldSatisfied", () => {
	it("returns true for optional fields", () => {
		expect(isFieldSatisfied(makeField({ id: "x" }), undefined)).toBe(true);
	});

	it("returns false for required empty fields", () => {
		expect(isFieldSatisfied(makeField({ id: "x", required: true }), undefined)).toBe(false);
		expect(isFieldSatisfied(makeField({ id: "x", required: true }), "")).toBe(false);
	});

	it("returns true for required filled fields", () => {
		expect(isFieldSatisfied(makeField({ id: "x", required: true }), "val")).toBe(true);
	});
});

describe("isTabComplete", () => {
	it("returns true when all required fields are filled", () => {
		const tab = {
			label: "Tab",
			fields: [
				makeField({ id: "a", required: true }),
				makeField({ id: "b", required: false }),
			],
		};
		expect(isTabComplete(tab, { a: "filled" })).toBe(true);
	});

	it("returns false when a required field is missing", () => {
		const tab = {
			label: "Tab",
			fields: [
				makeField({ id: "a", required: true }),
				makeField({ id: "b", required: true }),
			],
		};
		expect(isTabComplete(tab, { a: "filled" })).toBe(false);
	});
});

describe("isFieldVisible", () => {
	it("returns true when no visibleIf is set", () => {
		const f = makeField({ id: "x" });
		expect(isFieldVisible(f, {})).toBe(true);
	});

	it("single condition: equals match (default)", () => {
		const f = makeField({
			id: "x",
			visibleIf: { fieldId: "platform", value: "macOS" },
		});
		expect(isFieldVisible(f, { platform: "macOS" })).toBe(true);
		expect(isFieldVisible(f, { platform: "Windows" })).toBe(false);
		expect(isFieldVisible(f, {})).toBe(false);
	});

	it("single condition: contains match against CSV", () => {
		const f = makeField({
			id: "x",
			visibleIf: { fieldId: "payload", value: "AAX", match: "contains" },
		});
		expect(isFieldVisible(f, { payload: "VST3, AAX, AU" })).toBe(true);
		expect(isFieldVisible(f, { payload: "AAX" })).toBe(true);
		expect(isFieldVisible(f, { payload: "VST3, AU" })).toBe(false);
		expect(isFieldVisible(f, { payload: "" })).toBe(false);
		expect(isFieldVisible(f, {})).toBe(false);
	});

	it("contains does not partial-match within a single token", () => {
		const f = makeField({
			id: "x",
			visibleIf: { fieldId: "payload", value: "AA", match: "contains" },
		});
		expect(isFieldVisible(f, { payload: "VST3, AAX" })).toBe(false);
	});

	it("array of conditions is treated as AND", () => {
		const f = makeField({
			id: "x",
			visibleIf: [
				{ fieldId: "platform", value: "Windows" },
				{ fieldId: "payload", value: "AAX", match: "contains" },
			],
		});
		expect(isFieldVisible(f, { platform: "Windows", payload: "AAX, VST3" })).toBe(true);
		expect(isFieldVisible(f, { platform: "macOS", payload: "AAX, VST3" })).toBe(false);
		expect(isFieldVisible(f, { platform: "Windows", payload: "VST3" })).toBe(false);
		expect(isFieldVisible(f, {})).toBe(false);
	});
});
