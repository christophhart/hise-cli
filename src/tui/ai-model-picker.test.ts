import { describe, expect, it } from "vitest";
import { createInitialFormState } from "./wizard-render.js";
import { createModelPicker, refreshWizardModelField } from "./InlineApp.js";

describe("AI model picker", () => {
	it("opens on the active provider and model immediately", () => {
		const definition = createModelPicker(
			["anthropic/claude", "openai/gpt"],
			["off", "low", "high"],
			"openai/gpt",
			"high",
		);
		const state = createInitialFormState(definition, {});
		expect(state.answers).toMatchObject({
			provider: "openai",
			modelId: "openai/gpt",
			thinkingLevel: "high",
		});
		expect(definition.tabs[0]!.fields.find((field) => field.id === "modelId")?.items).toEqual(["openai/gpt"]);
	});

	it("updates reasoning choices as soon as a different model is selected", () => {
		const definition = createModelPicker(
			["local/basic", "openai/reasoning"],
			["off"],
			"local/basic",
			"off",
		);
		const state = createInitialFormState(definition, {
			provider: "openai",
			modelId: "openai/reasoning",
		});
		const refreshed = refreshWizardModelField(state, (modelId) => modelId === "openai/reasoning" ? ["off", "low", "high"] : ["off"]);
		expect(refreshed.definition.tabs[0]!.fields.find((field) => field.id === "modelId")?.items).toEqual(["openai/reasoning"]);
		expect(refreshed.definition.tabs[0]!.fields.find((field) => field.id === "thinkingLevel")?.items).toEqual(["off", "low", "high"]);
	});
});
