import { describe, expect, it } from "vitest";
import type { DataLoader } from "../engine/data.js";
import type { McpClient } from "../engine/mcp/types.js";
import { MockHiseConnection } from "../engine/hise.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import { createSession } from "../session-bootstrap.js";
import { listCliCommands } from "./commands.js";
import { assertHiseMcpReachable, cleanResearchEvidence, createHiseCommandTool, createHiseHelpTool, extractResearchReferences, extractHiseScriptBlocks, filterResearchDiagnostics, parseResearchQueries, parseResearchSelection } from "./ai-tools.js";
import { isMutatingCliCommand, runCanonical } from "./ai.js";

const dataLoader: DataLoader = {
	async loadModuleList() { return { version: "test", categories: {}, modules: [] }; },
	async loadScriptnodeList() { return {}; },
	async loadScriptingApi() { return { version: "test", generated: "test", enrichedClasses: [], classes: {} }; },
	async loadComponentProperties() { return {}; },
	async loadPreprocessorDefinitions() { return { preprocessors: {} }; },
	async loadWizardDefinitions() { return []; },
};

function commands() {
	return listCliCommands(createSession({ connection: null }).session.allCommands());
}

function text(result: { content: Array<{ type: string; text?: string }> }) {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("embedded HISE agent contract", () => {
	it("extracts only explicitly tagged HiseScript code blocks for validation", () => {
		const markdown = [
			"```hisescript",
			'Console.print("one");',
			"```",
			"```javascript",
			'Console.print("two");',
			"```",
			"```cpp",
			"Console::print();",
			"```",
		].join("\n");
		expect(extractHiseScriptBlocks(markdown)).toEqual([
			'Console.print("one");',
			'Console.print("two");',
		]);
	});

	it("strips internal implementation metadata before research synthesis", () => {
		const evidence = [
			"DOCUMENT /v2/scripting-api/sampler#getsamplemaplist",
			"Sampler::getSampleMapList() -> Array",
			"Thread safety: UNSAFE -- WARN_IF_AUDIO_THREAD",
			"Returns the available sample-map reference strings.",
			"Source:",
			"  ScriptingApi.cpp:100 Sampler::getSampleMapList()",
			"    -> internalCall()",
			"",
			"Use the returned strings with `loadSampleMap()`.",
			"**Common pitfalls:** [object Object],[object Object]",
		].join("\n");
		expect(cleanResearchEvidence(evidence)).toBe([
			"DOCUMENT /v2/scripting-api/sampler#getsamplemaplist",
			"Returns the available sample-map reference strings.",
			"Use the returned strings with `loadSampleMap()`.",
		].join("\n"));
	});

	it("filters live module-tree misses from standalone research examples", () => {
		const diagnostic = (message: string, source = "api-validation") => ({
			line: 1,
			column: 1,
			severity: "error",
			source,
			message,
			suggestions: [],
		});
		expect(filterResearchDiagnostics([
			diagnostic("Synth.getSampler - module not found: Sampler1"),
			diagnostic("Function / constant not found: Console.prnt"),
			diagnostic("module not found: syntax fixture", "syntax"),
		])).toEqual([
			diagnostic("Function / constant not found: Console.prnt"),
			diagnostic("module not found: syntax fixture", "syntax"),
		]);
	});

	it("extracts decoded MCP references without JSON escape backslashes", () => {
		const references = extractResearchReferences(
			{ content: [{ type: "text", text: '{"url":"/v2/scripting-api/engine#setkeycolour"}' }] },
			{ content: [{ type: "text", text: '{"id":"example:Engine.setKeyColour:colour-coded-keyboard-zones"}' }] },
		);
		expect(references).toEqual({
			urls: ["/v2/scripting-api/engine#setkeycolour"],
			ids: ["example:Engine.setKeyColour:colour-coded-keyboard-zones"],
		});
	});

	it("keeps the literal query and bounds validated expansion variants", () => {
		expect(parseResearchQueries(
			'{"queries":["cross-processor DSP network access", "get a Node by ID", "get a Node by ID", 42]}',
			"reference a node from the interface",
		)).toEqual([
			"reference a node from the interface",
			"cross-processor DSP network access",
			"get a Node by ID",
		]);
		expect(parseResearchQueries("not json", "literal")).toEqual(["literal"]);
	});

	it("accepts only reranker selections present in the candidate lists", () => {
		expect(parseResearchSelection(
			'```json\n{"documentKeys":["/v2/api/a","invented"],"exampleIds":["example:a","invented"]}\n```',
			["/v2/api/a", "/v2/api/b"],
			["example:a", "example:b"],
		)).toEqual({ documentKeys: ["/v2/api/a"], exampleIds: ["example:a"] });
	});

	it("falls back to a bounded retrieval-order selection for invalid reranker output", () => {
		expect(parseResearchSelection(
			"not json",
			["a", "b", "c", "d"],
			["e1", "e2", "e3"],
		)).toEqual({ documentKeys: ["a", "b", "c"], exampleIds: ["e1", "e2"] });
	});

	it("fails hise_research readiness when the MCP server is unreachable", async () => {
		const client: McpClient = {
			async call(_request, options) {
				expect(options?.timeoutMs).toBe(5_000);
				throw new Error("connect ECONNREFUSED");
			},
			async callTool() { return {}; },
		};
		await expect(assertHiseMcpReachable(client)).rejects.toThrow(
			"hise_research unavailable: HISE MCP server is not reachable: connect ECONNREFUSED",
		);
	});

	it("accepts a successful MCP tools/list readiness response", async () => {
		const client: McpClient = {
			async call() { return { tools: [] }; },
			async callTool() { return {}; },
		};
		await expect(assertHiseMcpReachable(client)).resolves.toBeUndefined();
	});

	it("classifies mutations and permits dry-run validation", () => {
		expect(isMutatingCliCommand(["ui", "add", "--type", "ScriptButton"])).toBe(true);
		expect(isMutatingCliCommand(["script", "set", "--stdin"])).toBe(true);
		expect(isMutatingCliCommand(["script", "compile", "--module-id", "Interface"])).toBe(true);
		expect(isMutatingCliCommand(["ui", "tree", "--agent"])).toBe(false);
		expect(isMutatingCliCommand(["-status"])).toBe(false);
		expect(isMutatingCliCommand(["ui", "add", "--type", "ScriptButton", "--dry-run"])).toBe(false);
		expect(isMutatingCliCommand(["unknown", "command"])).toBe(true);
	});
	it("passes canonical argv and stdin without translation", async () => {
		let received: { argv: string[]; stdin?: string } | undefined;
		const tool = createHiseCommandTool({
			run: async (argv, stdin) => {
				received = { argv, stdin };
				return { ok: true, text: "ok" };
			},
		});
		expect(tool.name).toBe("hise_command");
		expect(tool.description).toContain("canonical hise-cli command");
		await tool.execute("test", { argv: ["script", "set", "--stdin"], stdin: "function onInit() {}" }, undefined, undefined, {} as never);
		expect(received).toEqual({ argv: ["script", "set", "--stdin"], stdin: "function onInit() {}" });
	});

	it("throws on a failed CLI result", async () => {
		const tool = createHiseCommandTool({
			run: async () => ({ ok: false, text: "bad command", error: "usage_error" }),
		});
		await expect(tool.execute("test", { argv: ["ui", "bad"] }, undefined, undefined, {} as never)).rejects.toThrow("usage_error");
	});

	it("returns authoritative mode help", async () => {
		const tool = createHiseHelpTool();
		expect(tool.name).toBe("hise_help");
		const result = await tool.execute("test", { mode: "ui" }, undefined, undefined, {} as never);
		expect(text(result)).toContain("hise-cli ui");
		expect(text(result)).toContain("ui add --type");
	});

	it("executes script get through canonical argv", async () => {
		const runtime = createDefaultMockRuntime();
		(runtime.connection as MockHiseConnection).onGet("/api/get_script?moduleId=Interface&callback=onInit", () => ({
			success: true,
			result: { moduleId: "Interface", callbacks: { onInit: "Content.makeFrontInterface(600, 600);" } },
			logs: [],
			errors: [],
		}));
		const result = await runCanonical(
			["script", "get", "--module-id", "Interface", "--callback", "onInit"],
			undefined,
			runtime.connection,
			dataLoader,
			commands(),
		);
		expect(result.ok).toBe(true);
		expect(result.text).toContain("onInit");
	});

	it("executes script set through canonical argv and stdin", async () => {
		const runtime = createDefaultMockRuntime();
		const result = await runCanonical(
			["script", "set", "--module-id", "Interface", "--callback", "onInit", "--stdin"],
			"Console.print(\"test\");",
			runtime.connection,
			dataLoader,
			commands(),
		);
		expect(result.ok).toBe(true);
		expect(result.text).toContain("Compiled OK");
	});
});
