import { describe, expect, it } from "vitest";
import { McpMode, parseMcpModeInput, resolveMcpModeArgs } from "./mcp.js";
import type { McpClient, McpToolInputSchema } from "../mcp/types.js";

describe("McpMode", () => {
	it("splits tool target and rest", () => {
		expect(parseMcpModeInput("explore_hise arpeggiator tempo sync")).toEqual({
			kind: "tool",
			target: "explore_hise",
			rest: "arpeggiator tempo sync",
		});
	});

	it("splits method target and rest", () => {
		expect(parseMcpModeInput("resources/read hise://style-guides/hisescript-style")).toEqual({
			kind: "method",
			target: "resources/read",
			rest: "hise://style-guides/hisescript-style",
		});
	});

	it("maps known single-argument tools by name", () => {
		expect(resolveMcpModeArgs("explore_hise", "arpeggiator tempo sync")).toEqual({ query: "arpeggiator tempo sync" });
		expect(resolveMcpModeArgs("query_laf_function", "drawToggleButton")).toEqual({ functionName: "drawToggleButton" });
		expect(resolveMcpModeArgs("list_laf_functions", "ScriptButton")).toEqual({ componentType: "ScriptButton" });
		expect(resolveMcpModeArgs("search_forum", "LAF button")).toEqual({ term: "LAF button" });
		expect(resolveMcpModeArgs("list_scriptnode_nodes", "filters")).toEqual({ factory: "filters" });
	});

	it("passes JSON through unchanged", () => {
		expect(resolveMcpModeArgs("get_laf_functions_for_components", '{"componentTypes":["ScriptButton"]}')).toEqual({
			componentTypes: ["ScriptButton"],
		});
	});

	it("infers single string arguments from tool schemas", () => {
		const schemas: Record<string, McpToolInputSchema> = {
			brand_new_tool: {
				type: "object",
				properties: { label: { type: "string" } },
				required: ["label"],
			},
		};
		expect(resolveMcpModeArgs("brand_new_tool", "hello", schemas)).toEqual({ label: "hello" });
	});

	it("does not infer ambiguous schemas", () => {
		const schemas: Record<string, McpToolInputSchema> = {
			ambiguous: {
				type: "object",
				properties: { a: { type: "string" }, b: { type: "string" } },
				required: ["a", "b"],
			},
		};
		expect(() => resolveMcpModeArgs("ambiguous", "hello", schemas)).toThrow("a (string), b (string)");
	});

	it("reports a clean error for array-argument tools", () => {
		const schemas: Record<string, McpToolInputSchema> = {
			get_laf_functions_for_components: {
				type: "object",
				properties: { componentTypes: { type: "array" } },
				required: ["componentTypes"],
			},
		};
		const fn = () => resolveMcpModeArgs("get_laf_functions_for_components", "ScriptButton", schemas);
		expect(fn).toThrow("componentTypes (array)");
		expect(fn).toThrow('{"componentTypes":["..."]}');
	});

	it("resolves query_laf_function without a schema lookup", async () => {
		const calls: string[] = [];
		const client: McpClient = {
			async call() { calls.push("call"); return { tools: [] }; },
			async callTool(request) { calls.push(`tool:${request.name}:${JSON.stringify(request.arguments)}`); return { content: [{ type: "text", text: "ok" }] }; },
		};
		const mode = new McpMode(client);

		const result = await mode.parse("query_laf_function drawToggleButton", {} as any);

		expect(result).toEqual({ type: "markdown", content: "ok" });
		expect(calls).toContain("tool:query_laf_function:{\"functionName\":\"drawToggleButton\"}");
	});

	it("returns a clean error for unknown free-text tools instead of throwing", async () => {
		const client: McpClient = {
			async call() { return { tools: [] }; },
			async callTool() { throw new Error("should not be called"); },
		};
		const mode = new McpMode(client);

		const result = await mode.parse("mystery_tool something", {} as any);

		expect(result).toMatchObject({ type: "error", message: "Invalid MCP arguments" });
	});

	it("returns a clean error for invalid JSON arguments", async () => {
		const client: McpClient = {
			async call() { return { tools: [] }; },
			async callTool() { throw new Error("should not be called"); },
		};
		const mode = new McpMode(client);

		const result = await mode.parse("explore_hise {broken", {} as any);

		expect(result).toMatchObject({ type: "error", message: "Invalid MCP arguments" });
	});

	it("infers arguments from the tools/list schema when served by the client", async () => {
		const client: McpClient = {
			async call() {
				return {
					tools: [
						{
							name: "brand_new_tool",
							inputSchema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
						},
					],
				};
			},
			async callTool(request) { return { content: [{ type: "text", text: JSON.stringify(request.arguments) }] }; },
		};
		const mode = new McpMode(client);

		const result = await mode.parse("brand_new_tool hello", {} as any);

		expect(result).toEqual({ type: "markdown", content: '{"label":"hello"}' });
	});

	it("only completes the first token", () => {
		const mode = new McpMode(null);

		expect(mode.complete("expl", 4).items.some((item) => item.label === "explore_hise")).toBe(true);
		expect(mode.complete("query_laf", 9).items.some((item) => item.label === "query_laf_function")).toBe(true);
		expect(mode.complete("explore_hise sam", 16).items).toEqual([]);
	});

	it("only highlights the first token", () => {
		const mode = new McpMode(null);

		expect(mode.tokenizeInput("explore_hise sampler")).toEqual([
			{ text: "explore_hise", token: "mcp", bold: true },
			{ text: " sampler", token: "plain" },
		]);
	});

	it("renders text content as markdown", async () => {
		const client: McpClient = {
			async call() { return { tools: [] }; },
			async callTool() { return { content: [{ type: "text", text: "# Result" }] }; },
		};
		const mode = new McpMode(client);

		const result = await mode.parse("explore_hise sampler", {} as any);

		expect(result).toEqual({ type: "markdown", content: "# Result" });
	});

	it("does not call MCP while entering the mode", async () => {
		let calls = 0;
		const client: McpClient = {
			async call() { calls++; return {}; },
			async callTool() { return {}; },
		};
		const mode = new McpMode(client);

		await mode.onEnter?.({} as any);

		expect(calls).toBe(0);
	});
});
