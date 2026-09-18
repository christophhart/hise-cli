import { describe, expect, it } from "vitest";
import type { DataLoader } from "../engine/data.js";
import type { McpClient } from "../engine/mcp/types.js";
import { MockHiseConnection } from "../engine/hise.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import { createSession } from "../session-bootstrap.js";
import { listCliCommands } from "./commands.js";
import { assertHiseMcpReachable, cleanResearchEvidence, createHiseCommandTool, createHiseHelpTool, createHiseWhichTool, extractResearchReferences, extractHiseScriptBlocks, filterResearchDiagnostics, inferResearchDomain, parseResearchQueries, parseResearchSelection, splitResearchDiagnostics } from "./ai-tools.js";
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

	it("lets best-practice warnings through without treating them as validation failures", () => {
		const diagnostic = (severity: string, message: string) => ({
			line: 1,
			column: 1,
			severity,
			source: "api-validation",
			message,
			suggestions: [],
		});
		expect(splitResearchDiagnostics([
			diagnostic("warning", "Best practice: omit initial coordinates"),
			diagnostic("error", "Function / constant not found: Content.makeButton"),
		])).toEqual({
			errors: [diagnostic("error", "Function / constant not found: Content.makeButton")],
			warnings: [diagnostic("warning", "Best practice: omit initial coordinates")],
		});
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

	it("routes internal engine questions to C++ source research", () => {
		expect(inferResearchDomain("How does the threading model for loading user presets work?")).toBe("source");
		expect(inferResearchDomain("Why does the engine crash when loading a preset?")).toBe("source");
		expect(inferResearchDomain("Explain the C++ implementation of tempo sync")).toBe("source");
		expect(inferResearchDomain("How does cpp tempo syncing work internally?")).toBe("source");
		expect(inferResearchDomain("How does C++ scriptnode tempo sync work?")).toBe("source");
	});

	it("keeps ScriptNode research scoped to the ScriptNode documentation domain", () => {
		expect(inferResearchDomain("How do I make a channel splitter in scriptnode?")).toBe("scriptnode");
		expect(inferResearchDomain("How do I access a DspNetwork node?")).toBe("scriptnode");
		expect(inferResearchDomain("How do I set a slider callback?")).toBeUndefined();
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

	it("returns modal TUI syntax for how-to guidance", async () => {
		const tool = createHiseHelpTool({ surface: "tui" });
		const result = await tool.execute("test", { mode: "ui" }, undefined, undefined, {} as never);
		expect(text(result)).toContain("# UI Mode");
		expect(text(result)).toContain("set <target>.<prop> <value>");
		expect(text(result)).not.toContain("--component");
	});

	it("rejects non-canonical TUI topic aliases", async () => {
		const tool = createHiseHelpTool({ surface: "tui" });
		await expect(tool.execute("test", { mode: "interface" }, undefined, undefined, {} as never)).rejects.toThrow("Available: root, builder, ui, dsp");
	});

	it("returns which matches as supporting evidence", async () => {
		const tool = createHiseWhichTool();
		const result = await tool.execute("test", { query: "make a screenshot of the ui" }, undefined, undefined, {} as never);
		expect(text(result)).toContain("ui.screenshot");
	});

	it("returns an empty match list instead of failing", async () => {
		const tool = createHiseWhichTool();
		const result = await tool.execute("test", { query: "flurb blarg nonsense" }, undefined, undefined, {} as never);
		expect(JSON.parse(text(result))).toEqual({ matches: [] });
	});

	it("translates wizard help to its TUI entry point", async () => {
		const tool = createHiseHelpTool({ surface: "tui" });
		const result = await tool.execute("test", { mode: "wizard" }, undefined, undefined, {} as never);
		expect(text(result)).toContain("/wizard run plugin_export");
		expect(text(result)).not.toContain("hise-cli -wizard");
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
