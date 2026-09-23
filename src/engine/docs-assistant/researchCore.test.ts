import { describe, expect, it, vi } from "vitest";
import {
	buildRerankPrompt,
	buildResearchSynthesisRequest,
	collectResearchCandidates,
	createResearchSynthesisPrompt,
	parseResearchQueries,
	parseResearchSelection,
} from "./researchCore.mjs";

function textResult(text: string): object {
	return { content: [{ type: "text", text }] };
}

describe("shared documentation research core", () => {
	it("preserves semantic result titles and descriptions for reranking", async () => {
		const call = vi.fn(async (tool: string) => {
			if (tool === "explore_hise") return textResult([
				"Widget.attachListener  (0.9) [event]",
				"  /v2/scripting-api/widget#attachlistener",
				"  Adds an event listener without replacing default behaviour.",
			].join("\n"));
			return textResult('{"results":[]}');
		});
		const candidates = await collectResearchCandidates(["widget events"], { call });
		const prompt = buildRerankPrompt("widget events", candidates);
		expect(prompt).toContain("/v2/scripting-api/widget#attachlistener | Widget.attachListener");
		expect(prompt).toContain("Adds an event listener without replacing default behaviour");
	});

	it("separates strict HiseScript grounding from portable language knowledge", () => {
		const prompt = createResearchSynthesisPrompt();
		expect(prompt).toContain("JavaScript-looking code in a HISE context is HiseScript");
		expect(prompt).toContain("GLSL, Faust, CSS, regular expressions");
		expect(prompt).toContain("do not withhold a useful portable example");
		expect(prompt).toContain("Do not invent HISE setup code or API calls");
	});

	it("builds one host-neutral synthesis request", () => {
		const prompt = buildResearchSynthesisRequest("Draw a circle", "[E1] Shader integration", { requireDiagnosableHiseScript: true });
		expect(prompt).toContain("QUESTION\nDraw a circle");
		expect(prompt).toContain("MCP evidence retrieved for this request:\n[E1] Shader integration");
		expect(prompt).toContain("policy in the system prompt");
		expect(prompt).toContain("standalone code that HISE can diagnose");
		expect(prompt).not.toContain("generic knowledge");
	});

	it("uses the same bounded query and selection parsing for every host", () => {
		expect(parseResearchQueries('{"queries":["one","two","three","four"]}', "literal"))
			.toEqual(["literal", "one", "two", "three"]);
		expect(parseResearchSelection('{"documentKeys":["/valid","/invented"],"exampleIds":["example:valid"]}', ["/valid"], ["example:valid"]))
			.toEqual({ documentKeys: ["/valid"], exampleIds: ["example:valid"] });
	});

	it("supplements an explicit scope without replacing global retrieval", async () => {
		const call = vi.fn(async (_tool: string, _args: Record<string, unknown>) => textResult('{"results":[]}'));
		await collectResearchCandidates(["question"], {
			resolveScope: () => ({ exploreDomain: "ui", searchDomain: "ui", supplementGlobal: true }),
			call,
		});
		const exploreCalls = call.mock.calls.filter(([tool]) => tool === "explore_hise");
		expect(exploreCalls.map(([, args]) => args)).toEqual([
			{ query: "question", domain: "ui", source: "docs" },
			{ query: "question", source: "docs" },
		]);
	});
});
