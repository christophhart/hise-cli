import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { enforceCitations, extractHiseScriptBlocks } from "./citations.mjs";
import { FixtureDocumentationHost } from "./fixture.mjs";
import { RestDocumentationHost } from "./documentation.mjs";
import { domainsFor, repairResearch, runResearch } from "./research.mjs";

const documents = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));

function fakeModels(responses) {
	const calls = [];
	return {
		calls,
		async beginRequest() {
			return {
				async complete(role) {
					calls.push(role);
					const text = responses.shift() ?? "";
					return { text, model: `${role}/fake`, thinkingLevel: "off", usage: { input: 10, output: 5, cacheRead: 0, total: 15, cost: 0 } };
				},
			};
		},
	};
}

describe("documentation research server", () => {
	it("maps coarse topics to documentation service domains", () => {
		expect(domainsFor("ui", "ignored")).toEqual({ exploreDomain: "ui", searchDomain: "ui", supplementGlobal: true });
		expect(domainsFor("modules", "ignored")).toEqual({ exploreDomain: "audio", searchDomain: "modules", supplementGlobal: true });
		expect(domainsFor("scriptnode", "ignored")).toEqual({ exploreDomain: "scriptnode", searchDomain: "scriptnode", exampleSource: "scriptnode", scriptnode: true, supplementGlobal: true });
		expect(domainsFor("scripting", "ignored")).toEqual({ exploreDomain: "scripting", searchDomain: "api", supplementGlobal: true });
		expect(domainsFor("auto", "How do I use a DspNetwork node?").scriptnode).toBe(true);
	});

	it("keeps worker expansion/reranking separate from thinker synthesis", async () => {
		const models = fakeModels([
			'{"queries":["Content get existing component"]}',
			'{"documentKeys":[],"exampleIds":[]}',
			'Use `Content.getComponent()` to retrieve it. [E1]\n\n```hisescript\nconst var Knob1 = Content.getComponent("Knob1");\n```',
		]);
		const result = await runResearch({ question: "How do I get an existing component?", validation: "disabled" }, {
			docs: new FixtureDocumentationHost(documents),
			modelHost: models,
		});
		expect(models.calls).toEqual(["worker", "worker", "thinker"]);
		expect(result.citations[0].id).toBe("E1");
		expect(result.markdown).toContain("Not validated");
		expect(result.validationStatus).toBe("disabled");
	});

	it("supports source-only search without synthesis or validation", async () => {
		const models = fakeModels([
			'{"queries":["Content component lookup"]}',
			'{"documentKeys":[],"exampleIds":[]}',
		]);
		const result = await runResearch({ question: "find component documentation", output: "sources", validation: "enabled" }, {
			docs: new FixtureDocumentationHost(documents),
			modelHost: models,
		});
		expect(models.calls).toEqual(["worker", "worker"]);
		expect(result.validationStatus).toBe("not-applicable");
		expect(result.evidence.length).toBeGreaterThan(0);
		expect(result.evidence[0]).toEqual(expect.objectContaining({ title: expect.any(String), description: expect.any(String) }));
	});

	it("returns a validation request when enabled code is present", async () => {
		const models = fakeModels([
			'{"queries":[]}',
			'{"documentKeys":[],"exampleIds":[]}',
			'Example [E1]\n```hisescript\nConsole.print("ok");\n```',
		]);
		const result = await runResearch({ question: "component example", validation: "enabled" }, {
			docs: new FixtureDocumentationHost(documents),
			modelHost: models,
		});
		expect(result.validationStatus).toBe("pending");
		expect(result.validationRequest.blocks).toEqual(['Console.print("ok");']);
	});

	it("uses the thinker for bounded correction", async () => {
		const models = fakeModels([
			'{"queries":[]}',
			'{"documentKeys":[],"exampleIds":[]}',
			'Example [E1]\n```hisescript\nConsole.prnt("bad");\n```',
			'Example [E1]\n```hisescript\nConsole.print("fixed");\n```',
		]);
		const run = await runResearch({ question: "component example", validation: "enabled" }, {
			docs: new FixtureDocumentationHost(documents),
			modelHost: models,
		});
		const repaired = await repairResearch(run, [{ index: 0, diagnostics: [{ line: 1, column: 1, severity: "error", message: "Unknown function" }] }]);
		expect(models.calls).toEqual(["worker", "worker", "thinker", "thinker"]);
		expect(repaired.validationStatus).toBe("pending");
		expect(repaired.validationRequest.blocks[0]).toContain("Console.print");
	});

	it("removes unknown citations and links", () => {
		const checked = enforceCitations("Known [E1], unknown [E9], [bad](https://example.com).", [{ citationId: "E1", id: "doc", title: "Doc", kind: "document", url: "/v2/doc" }]);
		expect(checked.markdown).toBe("Known [E1](/v2/doc), unknown , bad.");
		expect(checked.citations).toHaveLength(1);
	});

	it("extracts only supported HiseScript fences", () => {
		expect(extractHiseScriptBlocks("```cpp\nint x;\n```\n```js\nConsole.print(1);\n```")).toEqual(["Console.print(1);"]);
	});

	it("refuses unsupported documentation operations", async () => {
		const host = new RestDocumentationHost({ fetchImpl: async () => new Response("{}") });
		await expect(host.callTool("delete_everything", {})).rejects.toThrow("Unsupported documentation operation");
	});
});
