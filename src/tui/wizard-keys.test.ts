import { describe, it, expect } from "vitest";
import { handleWizardKey, type KeyInfo } from "./wizard-keys.js";
import { createInitialFormState, type WizardFormState } from "./wizard-render.js";
import type { WizardDefinition } from "../engine/wizard/types.js";

const DEF: WizardDefinition = {
	id: "test",
	header: "Test",
	tabs: [
		{
			label: "Settings",
			fields: [
				{ id: "name", type: "text", label: "Name", required: true, emptyText: "..." },
				{ id: "toggle", type: "toggle", label: "Toggle", required: false, defaultValue: "false" },
				{ id: "choice", type: "choice", label: "Choice", required: false, items: ["A", "B", "C"], valueMode: "text", defaultValue: "A" },
				{ id: "multi", type: "multiselect", label: "Multi", required: false, items: ["X", "Y", "Z"] },
			],
		},
	],
	tasks: [],
	postActions: [],
	globalDefaults: {},
};

const noKey: KeyInfo = {
	upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
	return: false, escape: false, tab: false, backspace: false, delete: false,
	shift: false, meta: false, ctrl: false,
};

function key(overrides: Partial<KeyInfo>): KeyInfo {
	return { ...noKey, ...overrides };
}

function state(overrides: Partial<WizardFormState> = {}): WizardFormState {
	return { ...createInitialFormState(DEF, {}), ...overrides };
}

describe("handleWizardKey — navigation", () => {
	it("down arrow moves to next field", () => {
		const result = handleWizardKey(state(), "", key({ downArrow: true }));
		expect(result?.action).toBe("update");
		if (result?.action === "update") expect(result.state.activeField).toBe(1);
	});

	it("up arrow moves to previous field", () => {
		const result = handleWizardKey(state({ activeField: 2 }), "", key({ upArrow: true }));
		if (result?.action === "update") expect(result.state.activeField).toBe(1);
	});

	it("down arrow reaches submit button", () => {
		const result = handleWizardKey(state({ activeField: 3 }), "", key({ downArrow: true }));
		if (result?.action === "update") expect(result.state.activeField).toBe(4); // fieldCount
	});

	it("up arrow doesn't go below 0", () => {
		const result = handleWizardKey(state({ activeField: 0 }), "", key({ upArrow: true }));
		if (result?.action === "update") expect(result.state.activeField).toBe(0);
	});

	it("enter on toggle toggles value", () => {
		const result = handleWizardKey(state({ activeField: 1 }), "", key({ return: true }));
		if (result?.action === "update") expect(result.state.answers["toggle"]).toBe("true");
	});

	it("space on toggle toggles value", () => {
		const result = handleWizardKey(state({ activeField: 1 }), " ", key({}));
		if (result?.action === "update") expect(result.state.answers["toggle"]).toBe("true");
	});
});

describe("handleWizardKey — text editing", () => {
	it("enter on text field enters edit mode", () => {
		const result = handleWizardKey(state({ activeField: 0 }), "", key({ return: true }));
		if (result?.action === "update") {
			expect(result.state.editing).toBe(true);
			expect(result.state.cursor).toBe(0); // empty field
		}
	});

	it("typing in edit mode inserts character", () => {
		const s = state({ activeField: 0, editing: true, cursor: 0 });
		const r1 = handleWizardKey(s, "a", key({}));
		if (r1?.action === "update") {
			expect(r1.state.answers["name"]).toBe("a");
			expect(r1.state.cursor).toBe(1);
		}
	});

	it("backspace in edit mode deletes", () => {
		const s = state({
			activeField: 0,
			editing: true,
			cursor: 3,
			answers: { name: "abc", toggle: "false", choice: "A" },
		});
		const result = handleWizardKey(s, "", key({ backspace: true }));
		if (result?.action === "update") {
			expect(result.state.answers["name"]).toBe("ab");
			expect(result.state.cursor).toBe(2);
		}
	});

	it("enter in edit mode exits edit", () => {
		const s = state({ activeField: 0, editing: true, cursor: 0 });
		const result = handleWizardKey(s, "", key({ return: true }));
		if (result?.action === "update") expect(result.state.editing).toBe(false);
	});

	it("escape in edit mode exits edit", () => {
		const s = state({ activeField: 0, editing: true, cursor: 0 });
		const result = handleWizardKey(s, "", key({ escape: true }));
		if (result?.action === "update") expect(result.state.editing).toBe(false);
	});
});

describe("handleWizardKey — choice editing", () => {
	it("enter on choice enters edit mode", () => {
		const result = handleWizardKey(state({ activeField: 2 }), "", key({ return: true }));
		if (result?.action === "update") {
			expect(result.state.editing).toBe(true);
			expect(result.state.choiceIndex).toBe(0); // "A" is index 0
		}
	});

	it("down arrow in choice edit cycles options", () => {
		const s = state({ activeField: 2, editing: true, choiceIndex: 0 });
		const result = handleWizardKey(s, "", key({ downArrow: true }));
		if (result?.action === "update") expect(result.state.choiceIndex).toBe(1);
	});

	it("enter in choice edit selects and exits", () => {
		const s = state({ activeField: 2, editing: true, choiceIndex: 1 });
		const result = handleWizardKey(s, "", key({ return: true }));
		if (result?.action === "update") {
			expect(result.state.answers["choice"]).toBe("B");
			expect(result.state.editing).toBe(false);
		}
	});
});

describe("handleWizardKey — multiselect editing", () => {
	it("space toggles item in multiselect", () => {
		const s = state({ activeField: 3, editing: true, choiceIndex: 0, checkedIndices: new Set() });
		const result = handleWizardKey(s, " ", key({}));
		if (result?.action === "update") expect(result.state.checkedIndices.has(0)).toBe(true);
	});

	it("enter in multiselect confirms and exits", () => {
		const s = state({ activeField: 3, editing: true, choiceIndex: 0, checkedIndices: new Set([0, 2]) });
		const result = handleWizardKey(s, "", key({ return: true }));
		if (result?.action === "update") {
			expect(result.state.answers["multi"]).toBe("X, Z");
			expect(result.state.editing).toBe(false);
		}
	});
});

describe("handleWizardKey — escape", () => {
	it("double escape cancels wizard", () => {
		const s = state({ escTimestamp: Date.now() });
		const result = handleWizardKey(s, "", key({ escape: true }));
		expect(result?.action).toBe("cancel");
	});

	it("single escape sets timestamp", () => {
		const result = handleWizardKey(state(), "", key({ escape: true }));
		if (result?.action === "update") expect(result.state.escTimestamp).toBeGreaterThan(0);
	});
});

describe("handleWizardKey — submit", () => {
	it("enter on submit button with all complete submits", () => {
		const s = state({
			activeField: 4, // submit button
			answers: { name: "test", toggle: "false", choice: "A", multi: "" },
		});
		const result = handleWizardKey(s, "", key({ return: true }));
		expect(result?.action).toBe("submit");
	});
});
