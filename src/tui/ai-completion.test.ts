import { describe, expect, it } from "vitest";
import { completeAiSlash } from "./ai-completion.js";

describe("AI slash completion", () => {
	it("completes Pi commands", () => {
		const result = completeAiSlash("/se");
		expect(result.items.map((item) => item.label)).toEqual(["/sessions"]);
	});

	it("completes the model configuration reset", () => {
		expect(completeAiSlash("/nu").items.map((item) => item.label)).toEqual(["/nuke"]);
	});

	it("opens selectors without command arguments", () => {
		expect(completeAiSlash("/model q", 8, ["qwen-docker/qwen3"]).items).toEqual([]);
		expect(completeAiSlash("/provider").items).toEqual([]);
	});

	it("completes persisted session IDs", () => {
		const result = completeAiSlash("/sessions 2", 11, [], [
			{ id: "1", label: "one" },
			{ id: "2", label: "two", detail: "two · 4 messages" },
		]);
		expect(result.items).toEqual([{ label: "2", detail: "two · 4 messages" }]);
	});
});
