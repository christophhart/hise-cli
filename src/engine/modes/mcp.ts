import type { McpClient, McpJsonValue, McpToolInputSchema } from "../mcp/types.js";
import { errorResult, markdownResult, type CommandResult } from "../result.js";
import { renderMcpReferenceResult } from "../reference/mcpReference.js";
import type { TokenSpan } from "../highlight/tokens.js";
import type { CompletionItem, CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";

const COMMON_TOOLS = [
	"search_hise",
	"explore_hise",
	"query_scripting_api",
	"query_ui",
	"query_module",
	"query_scriptnode",
	"search_examples",
	"get_example",
	"get_tutorial",
	"get_doc_content",
	"get_resource",
	"server_status",
	"list_ui_components",
	"list_scripting_namespaces",
	"list_module_types",
	"list_scriptnode_nodes",
	"list_laf_functions",
	"query_laf_function",
	"search_forum",
	"tools/list",
	"resources/list",
	"resources/read",
	"prompts/list",
	"prompts/get",
];

/** Tools whose single free-text argument maps to a fixed input property. */
const SINGLE_ARG_TOOLS: Record<string, string> = {
	explore_hise: "query",
	search_hise: "query",
	search_examples: "query",
	query_scripting_api: "apiCall",
	query_ui: "query",
	query_module: "query",
	query_scriptnode: "query",
	get_example: "id",
	get_tutorial: "id",
	get_resource: "id",
	list_scriptnode_nodes: "factory",
	list_laf_functions: "componentType",
	query_laf_function: "functionName",
	search_forum: "term",
};

export class McpMode implements Mode {
	readonly id = "mcp" as const;
	readonly name = "MCP";
	readonly accent = MODE_ACCENTS.mcp;
	readonly prompt = "[mcp] > ";
	private readonly client: McpClient | null;
	private completions: CompletionItem[] = COMMON_TOOLS.map((label) => ({ label, insertText: label }));

	private schemaLookup: Promise<Record<string, McpToolInputSchema> | null> | null = null;

	constructor(client: McpClient | null) {
		this.client = client;
	}

	async onEnter(_session: SessionContext): Promise<void> {
		// Keep mode entry side-effect free. Dynamic MCP discovery is available via
		// tools/list and resources/list, but background HTTP calls can keep TUI
		// shutdown alive after /quit.
	}

	async parse(input: string, _session: SessionContext): Promise<CommandResult> {
		if (!this.client) return errorResult("MCP client is not available in this frontend.");
		const parsed = parseMcpModeInput(input);
		if (!parsed) return markdownResult(MCP_MODE_HELP);
		let args: McpJsonValue;
		try {
			args = resolveMcpModeArgs(parsed.target, parsed.rest, await this.toolSchemas());
		} catch (err) {
			return errorResult("Invalid MCP arguments", err instanceof Error ? err.message : String(err));
		}
		try {
			const result = parsed.kind === "tool"
				? await this.client.callTool({ name: parsed.target, arguments: args })
				: await this.client.call({ method: parsed.target, params: args });
			return renderMcpReferenceResult(result);
		} catch (err) {
			return errorResult("MCP request failed", err instanceof Error ? err.message : String(err));
		}
	}

	/** Lazily fetch tool input schemas once per mode instance. Fails soft: a
	 *  client without tools/list support only loses schema-driven inference. */
	private toolSchemas(): Promise<Record<string, McpToolInputSchema> | null> {
		if (!this.schemaLookup) {
			const client = this.client;
			this.schemaLookup = (async () => {
				if (!client) return null;
				try {
					const value = await client.call({ method: "tools/list" });
					if (!value || typeof value !== "object" || Array.isArray(value)) return null;
					const tools = (value as { tools?: unknown }).tools;
					if (!Array.isArray(tools)) return null;
					const out: Record<string, McpToolInputSchema> = {};
					for (const tool of tools) {
						if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
						const { name, inputSchema } = tool as { name?: unknown; inputSchema?: unknown };
						if (typeof name !== "string" || !inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) continue;
						out[name] = inputSchema as McpToolInputSchema;
					}
					return out;
				} catch {
					return null;
				}
			})();
		}
		return this.schemaLookup;
	}

	complete(input: string, cursor: number): CompletionResult {
		const beforeCursor = input.slice(0, cursor);
		if (/\s/.test(beforeCursor)) return { items: [], from: cursor, to: cursor };
		const trimmed = input.trimStart();
		const leading = input.length - trimmed.length;
		const prefix = trimmed.slice(0, cursor - leading).toLowerCase();
		const items = this.completions
			.filter((item) => item.label.toLowerCase().startsWith(prefix))
			.sort((a, b) => a.label.localeCompare(b.label));
		return { items, from: leading, to: cursor, label: "MCP tools" };
	}

	tokenizeInput(value: string): TokenSpan[] {
		if (!value) return [];
		const match = value.match(/^(\s*)(\S+)([\s\S]*)$/);
		if (!match) return [{ text: value, token: "plain" }];
		const spans: TokenSpan[] = [];
		if (match[1]) spans.push({ text: match[1], token: "plain" });
		spans.push({ text: match[2]!, token: "mcp", bold: true });
		if (match[3]) spans.push({ text: match[3]!, token: "plain" });
		return spans;
	}
}

export interface ParsedMcpInput {
	kind: "tool" | "method";
	target: string;
	rest: string;
}

export function parseMcpModeInput(input: string): ParsedMcpInput | null {
	const trimmed = input.trim();
	if (!trimmed || trimmed === "help") return null;
	const [target] = trimmed.split(/\s+/);
	const rest = trimmed.slice(target!.length).trim();
	return { kind: target!.includes("/") ? "method" : "tool", target: target!, rest };
}

export function resolveMcpModeArgs(
	target: string,
	rest: string,
	schemas: Record<string, McpToolInputSchema> | null = null,
): McpJsonValue {
	if (!rest) return {};
	if (rest.startsWith("{") || rest.startsWith("[")) {
		try {
			return JSON.parse(rest) as McpJsonValue;
		} catch (err) {
			throw new Error(`Invalid JSON arguments: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	if (target === "resources/read") return { uri: rest };
	const fixed = SINGLE_ARG_TOOLS[target];
	if (fixed) return { [fixed]: rest };
	if (target === "get_doc_content") return rest.startsWith("/") ? { url: rest } : { id: rest };
	const inferred = inferSingleStringArg(schemas?.[target]);
	if (inferred) return { [inferred]: rest };
	throw new Error(describeArgError(target, schemas?.[target]));
}

/** When a tool exposes exactly one string input, map the free-text value to it. */
function inferSingleStringArg(schema: McpToolInputSchema | null | undefined): string | null {
	if (!schema || schema.type !== "object") return null;
	const props = schema.properties ?? {};
	const names = Object.keys(props);
	const stringNames = names.filter((name) => props[name]?.type === "string");
	if (stringNames.length !== 1) return null;
	const name = stringNames[0]!;
	const required = schema.required ?? [];
	if (required.length > 0) return required.length === 1 && required[0] === name ? name : null;
	return names.length === 1 ? name : null;
}

function describeArgError(target: string, schema: McpToolInputSchema | null | undefined): string {
	if (!schema || schema.type !== "object" || Object.keys(schema.properties ?? {}).length === 0) {
		return `Pass JSON arguments for ${target}, e.g. ${target} {"arg":"value"}`;
	}
	const props = schema.properties ?? {};
	const required = schema.required ?? [];
	const list = Object.keys(props)
		.map((name) => `${name}${required.includes(name) ? "" : "?"} (${props[name]?.type ?? "any"})`)
		.join(", ");
	const example: Record<string, McpJsonValue> = {};
	for (const name of required.length > 0 ? required : Object.keys(props)) {
		const type = props[name]?.type;
		example[name] = type === "array" ? ["..."] : type === "number" ? 0 : type === "boolean" ? true : "...";
	}
	return `${target} takes: ${list}. Pass JSON arguments, e.g. ${target} ${JSON.stringify(example)}`;
}

const MCP_MODE_HELP = `# MCP Mode

Type an MCP tool or method as the first token. Everything after the first space is passed as arguments.

Single-value tools accept a plain value. Tools with multiple or array arguments require a JSON object.

Examples:

\`\`\`text
explore_hise sampler
search_hise Content.addKnob
query_scripting_api ScriptSlider.setControlCallback
query_laf_function drawToggleButton
list_laf_functions ScriptButton
resources/read hise://style-guides/hisescript-style
get_laf_functions_for_components {"componentTypes":["ScriptButton"]}
explore_hise {"query":"sampler","source":"docs"}
\`\`\``;
