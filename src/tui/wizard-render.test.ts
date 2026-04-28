import { describe, it, expect } from "vitest";
import { renderWizardBlock, createInitialFormState } from "./wizard-render.js";
import { defaultScheme } from "./theme.js";
import type { WizardDefinition } from "../engine/wizard/types.js";

// Strip ANSI for content assertions
function strip(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

const DEF: WizardDefinition = {
	id: "test",
	header: "Test Wizard",
	description: "A test wizard",
	tabs: [
		{
			label: "Settings",
			fields: [
				{ id: "name", type: "text", label: "Project Name", required: true, help: "Enter the name", emptyText: "type here..." },
				{ id: "location", type: "file", label: "Location", required: true, help: "Choose folder", directory: true },
				{ id: "useDefault", type: "toggle", label: "Use Default", required: false, defaultValue: "true" },
				{ id: "template", type: "choice", label: "Template", required: false, items: ["Empty", "Import", "Rhapsody"], itemDescriptions: ["Blank project", "Import archive", "Player template"], valueMode: "text", defaultValue: "Empty" },
			],
		},
		{
			label: "Advanced",
			fields: [
				{ id: "tags", type: "multiselect", label: "File Types", required: false, items: ["Audio", "Images", "Scripts"], itemDescriptions: ["Audio samples", "UI images", "Script files"] },
			],
		},
	],
	tasks: [],
	postActions: [],
	globalDefaults: { useDefault: "true", template: "Empty" },
};

function render(overrides: Partial<ReturnType<typeof createInitialFormState>> = {}) {
	const state = { ...createInitialFormState(DEF, {}), ...overrides };
	const block = renderWizardBlock(state, defaultScheme, 80);
	return {
		block,
		text: block.lines.map(strip).join("\n"),
		lines: block.lines.map(strip),
	};
}

describe("renderWizardBlock", () => {
	it("renders header and description", () => {
		const { text } = render();
		expect(text).toContain("Test Wizard");
		expect(text).toContain("A test wizard");
	});

	it("renders tab labels", () => {
		const { text } = render();
		expect(text).toContain("Settings");
		expect(text).toContain("Advanced");
	});

	it("renders all four fields on Settings tab", () => {
		const { text } = render();
		expect(text).toContain("Project Name");
		expect(text).toContain("Location");
		expect(text).toContain("Use Default");
		expect(text).toContain("Template");
	});

	it("renders submit button", () => {
		const { text } = render();
		expect(text).toContain("[ Submit ]");
	});

	it("renders help text for focused field", () => {
		const { text } = render();
		expect(text).toContain("Enter the name");
	});

	it("renders hint bar", () => {
		const { text } = render();
		expect(text).toContain("tab:");
	});

	it("shows focus indicator on first field", () => {
		const { text } = render();
		expect(text).toContain("\u25B8");
	});

	it("shows default values", () => {
		const { text } = render();
		expect(text).toContain("Empty"); // template
		expect(text).toContain("[\u2713]"); // useDefault toggle
	});

	it("shows prefilled values", () => {
		const state = createInitialFormState(DEF, { name: "MyProject" });
		const block = renderWizardBlock(state, defaultScheme, 80);
		const text = block.lines.map(strip).join("\n");
		expect(text).toContain("MyProject");
	});

	it("renders second tab when switched", () => {
		const { text } = render({ activeTab: 1, activeField: 0 });
		expect(text).toContain("File Types");
	});

	it("all lines are padded to width", () => {
		const { lines } = render();
		for (const line of lines) {
			expect(line.length).toBeGreaterThanOrEqual(80);
		}
	});

	it("shows expanded choice options when editing", () => {
		const { text } = render({ activeField: 3, editing: true, choiceIndex: 0 });
		expect(text).toContain("Empty");
		expect(text).toContain("Import");
		expect(text).toContain("Rhapsody");
	});

	it("shows tooltip on focused choice option", () => {
		const { text } = render({ activeField: 3, editing: true, choiceIndex: 0 });
		expect(text).toContain("Blank project"); // description for "Empty"
	});

	it("shows tooltip on focused multiselect option", () => {
		const state = createInitialFormState(DEF, {});
		state.activeTab = 1;
		state.activeField = 0;
		state.editing = true;
		state.choiceIndex = 1;
		state.checkedIndices = new Set();
		const block = renderWizardBlock(state, defaultScheme, 80);
		const text = block.lines.map(strip).join("\n");
		expect(text).toContain("UI images"); // description for "Images" at index 1
	});

	it("shows multiselect checkboxes when editing", () => {
		const state = createInitialFormState(DEF, {});
		state.activeTab = 1;
		state.activeField = 0;
		state.editing = true;
		state.checkedIndices = new Set([0, 2]);
		const block = renderWizardBlock(state, defaultScheme, 80);
		const text = block.lines.map(strip).join("\n");
		expect(text).toContain("Audio");
		expect(text).toContain("Images");
		expect(text).toContain("Scripts");
	});
});
