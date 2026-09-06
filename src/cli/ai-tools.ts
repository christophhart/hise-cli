import { Type } from "typebox";
import { createTwoFilesPatch } from "diff";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { renderDiff } from "@earendil-works/pi-coding-agent";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { createContext, runInContext } from "node:vm";
import * as vm from "node:vm";
import type { HiseConnection } from "../engine/hise.js";
import { diagnoseHiseScriptCode, type HiseScriptDiagnostic } from "../engine/hise-script-diagnostics.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { buildAgentContext } from "./agentContext.js";
import { renderCliHelp } from "./help.js";
import type { McpClient, McpJsonValue } from "../engine/mcp/types.js";
import { HISESCRIPT_CHEAT_SHEET } from "./ai-guidance.js";
import { registerPiOAuthFlows } from "./pi-runtime.js";
import type { Api, Model } from "@earendil-works/pi-ai";

const MAX_RESULT_CHARS = 24_000;
const JS_DEFAULT_TIMEOUT_MS = 10_000;

function truncate(text: string): string {
	return text.length <= MAX_RESULT_CHARS
		? text
		: `${text.slice(0, MAX_RESULT_CHARS)}\n… [truncated ${text.length - MAX_RESULT_CHARS} chars]`;
}

export interface HiseCliResult {
	ok: boolean;
	text: string;
	error?: string;
}

export interface HiseCliRunner {
	run(argv: string[], stdin?: string): Promise<HiseCliResult>;
}

export interface HiseScriptToolOptions {
	connection: HiseConnection;
	projectDir: string;
}

export interface JsToolOptions {
	projectDir: string;
	allowWrites: boolean;
}

function safeProjectPath(projectDir: string, input: string): string {
	const path = resolve(projectDir, input);
	const rel = relative(resolve(projectDir), path);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path escapes the project directory: ${input}`);
	if (rel === "Scripts" || rel.startsWith(`Scripts${sep}`) || rel.startsWith("Scripts/")) {
		throw new Error(`js cannot write under Scripts/. Use hise_script for HISE script mutations: ${input}`);
	}
	return path;
}

function safeReadPath(projectDir: string, input: string): string {
	const path = resolve(projectDir, input);
	const rel = relative(resolve(projectDir), path);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`Path escapes the project directory: ${input}`);
	return path;
}

function formatJsValue(value: unknown): string {
	if (typeof value === "string") return value;
	try { return JSON.stringify(value, null, 2) ?? String(value); } catch { return String(value); }
}

async function inspectWav(projectDir: string, input: string): Promise<Record<string, unknown>> {
	const bytes = await readFile(safeReadPath(projectDir, input));
	if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error(`${input} is not a RIFF/WAVE file`);
	let offset = 12;
	let channels: number | undefined;
	let sampleRate: number | undefined;
	let bitsPerSample: number | undefined;
	let dataBytes = 0;
	while (offset + 8 <= bytes.length) {
		const id = bytes.toString("ascii", offset, offset + 4);
		const size = bytes.readUInt32LE(offset + 4);
		if (id === "fmt " && size >= 16) {
			channels = bytes.readUInt16LE(offset + 10);
			sampleRate = bytes.readUInt32LE(offset + 12);
			bitsPerSample = bytes.readUInt16LE(offset + 26);
		}
		if (id === "data") dataBytes = size;
		offset += 8 + size + (size % 2);
	}
	return { format: "wav", channels, sampleRate, bitsPerSample, dataBytes, durationSeconds: channels && sampleRate && bitsPerSample ? dataBytes / (sampleRate * channels * bitsPerSample / 8) : undefined };
}

async function inspectImage(projectDir: string, input: string): Promise<Record<string, unknown>> {
	const bytes = await readFile(safeReadPath(projectDir, input));
	if (bytes.length >= 24 && bytes.toString("ascii", 1, 4) === "PNG") return { format: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), byteLength: bytes.length };
	if (bytes[0] === 0xff && bytes[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < bytes.length) {
			if (bytes[offset] !== 0xff) { offset++; continue; }
			const marker = bytes[offset + 1];
			const size = bytes.readUInt16BE(offset + 2);
			if (marker >= 0xc0 && marker <= 0xc3) return { format: "jpeg", width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), byteLength: bytes.length };
			offset += 2 + size;
		}
	}
	throw new Error(`${input} is not a supported PNG or JPEG image`);
}

export function createJsTool(options: JsToolOptions) {
	return defineTool({
		name: "js",
		label: "js",
		promptSnippet: "Run a one-off JavaScript snippet for data processing, file manipulation, or analysis.",
		description: "Execute one-off Node-compatible JavaScript with top-level await in the project directory. Use Bun.file, Bun.write, fs, path, and Buffer for analysis. Writes under Scripts/ are blocked; use hise_script for HISE source.",
		parameters: Type.Object({
			code: Type.String({ description: "JavaScript code to execute" }),
			timeoutMs: Type.Optional(Type.Number({ description: "Execution timeout in milliseconds (maximum 10000)" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, signal) {
			const timeoutMs = Math.min(Math.max(params.timeoutMs ?? JS_DEFAULT_TIMEOUT_MS, 1), JS_DEFAULT_TIMEOUT_MS);
			const stdout: string[] = [];
			const stderr: string[] = [];
			const changedFiles = new Set<string>();
			const read = (input: string) => readFile(safeReadPath(options.projectDir, input));
			const write = async (input: string, data: string | Uint8Array) => {
				if (!options.allowWrites) throw new Error("js file writes require --apply in CLI mode");
				const path = safeProjectPath(options.projectDir, input);
				await writeFile(path, data);
				changedFiles.add(relative(options.projectDir, path));
			};
			const bunFile = (input: string) => ({
				text: async () => (await read(input)).toString("utf8"),
				json: async () => JSON.parse((await read(input)).toString("utf8")),
				arrayBuffer: async () => { const value = await read(input); return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); },
			});
			const globFiles = async function* (pattern: string, input = "."): AsyncGenerator<string> {
				const root = safeReadPath(options.projectDir, input);
				const walk = async function* (directory: string): AsyncGenerator<string> {
					for (const entry of await readdir(directory, { withFileTypes: true })) {
						const full = join(directory, entry.name);
						if (entry.isDirectory()) yield* walk(full);
						else {
							const value = relative(root, full).replaceAll(sep, "/");
							const suffix = pattern.replaceAll("**/", "");
							if (pattern === "**/*" || value === pattern || value.endsWith(suffix)) yield value;
						}
					}
				};
				yield* walk(root);
			};
			const bun = { file: bunFile, write, Glob: class { constructor(private readonly pattern: string) {} scan(input = ".") { return globFiles(this.pattern, input); } } };
			const media = {
				inspectWav: (input: string) => inspectWav(options.projectDir, input),
				inspectImage: (input: string) => inspectImage(options.projectDir, input),
			};
			const fs = {
				readFile: async (input: string, encoding?: string) => { const value = await read(input); return encoding ? value.toString(encoding as BufferEncoding) : value; },
				readFileSync: (input: string, encoding?: string) => { const value = readFileSync(safeReadPath(options.projectDir, input)); return encoding ? value.toString(encoding as BufferEncoding) : value; },
				writeFile: write,
				writeFileSync: (input: string, data: string | Uint8Array) => { if (!options.allowWrites) throw new Error("js file writes require --apply in CLI mode"); const path = safeProjectPath(options.projectDir, input); writeFileSync(path, data); changedFiles.add(relative(options.projectDir, path)); },
				readdir: async (input = ".") => readdir(safeReadPath(options.projectDir, input)),
				readdirSync: (input = ".") => readdirSync(safeReadPath(options.projectDir, input)),
				stat: async (input: string) => stat(safeReadPath(options.projectDir, input)),
				statSync: (input: string) => statSync(safeReadPath(options.projectDir, input)),
				exists: async (input: string) => readFile(safeReadPath(options.projectDir, input)).then(() => true).catch(() => false),
				existsSync: (input: string) => { try { statSync(safeReadPath(options.projectDir, input)); return true; } catch { return false; } },
			};
			const nodeModules: Record<string, unknown> = { "node:fs/promises": fs, "fs/promises": fs, "node:fs": fs, fs, "node:path": { join, resolve, normalize, relative }, path: { join, resolve, normalize, relative } };
			const requireModule = (specifier: string) => {
				const value = nodeModules[specifier];
				if (!value) throw new Error(`Module not available in js tool: ${specifier}`);
				return value;
			};
			const importModule = async (specifier: string) => {
				const value = requireModule(specifier);
				const names = Object.keys(value as object);
				const module = new vm.SyntheticModule(["default", ...names], function() {
					this.setExport("default", value);
					for (const name of names) this.setExport(name, (value as Record<string, unknown>)[name]);
				}, { context });
				await module.evaluate();
				return module;
			};
			const context = createContext({
				Bun: bun,
				require: requireModule,
				media,
				Buffer,
				fs,
				path: { join, resolve, normalize, relative },
				console: {
					log: (...values: unknown[]) => stdout.push(values.map(formatJsValue).join(" ")),
					info: (...values: unknown[]) => stdout.push(values.map(formatJsValue).join(" ")),
					warn: (...values: unknown[]) => stderr.push(values.map(formatJsValue).join(" ")),
					error: (...values: unknown[]) => stderr.push(values.map(formatJsValue).join(" ")),
				},
				setTimeout,
				clearTimeout,
			});
			if (signal?.aborted) throw new Error("Operation aborted");
			// VM contexts cannot perform native dynamic imports, so translate the common
			// `await import("node:...")` form to the injected, capability-limited require.
			const executableCode = params.code.replace(/await\s+import\s*\(\s*(["'])(node:[^"']+|fs[^"']*|path)\1\s*\)/g, "require(\"$2\")");
			const source = `(async () => {\n${executableCode}\n})()`;
			const result = await Promise.race([
				Promise.resolve().then(() => new vm.Script(source, { importModuleDynamically: importModule }).runInContext(context, { timeout: timeoutMs })),
				new Promise((_, reject) => setTimeout(() => reject(new Error(`JavaScript execution timed out after ${timeoutMs}ms`)), timeoutMs)),
			]);
			if (signal?.aborted) throw new Error("Operation aborted");
			const output = [
				stdout.length > 0 ? `stdout:\n${stdout.join("\n")}` : "",
				stderr.length > 0 ? `stderr:\n${stderr.join("\n")}` : "",
				result === undefined ? "" : `result:\n${formatJsValue(result)}`,
				changedFiles.size > 0 ? `changed files:\n${[...changedFiles].join("\n")}` : "",
			].filter(Boolean).join("\n\n") || "JavaScript completed successfully.";
			return { content: [{ type: "text", text: truncate(output) }], details: { stdout, stderr, result, changedFiles: [...changedFiles] } };
		},
	});
}


interface ScriptTarget {
	kind: "callback" | "file";
	moduleId: string;
	name: string;
	filePath?: string;
}

function parseScriptUri(uri: string, projectDir: string): ScriptTarget {
	if (!uri.startsWith("hise://script/")) throw new Error("URI must use hise://script/<moduleId>/<callback-or-relative-file>");
	const parts = uri.slice("hise://script/".length).split("/").filter(Boolean).map(decodeURIComponent);
	if (parts.length < 2) throw new Error("Script URI requires a moduleId and callback or relative file path");
	const moduleId = parts.shift()!;
	const name = parts.join("/").replace(/^Scripts\//i, "");
	if (!name) throw new Error("Script URI target is empty");
	if (!name.includes("/") && !/\.(?:js|hsc)$/i.test(name)) return { kind: "callback", moduleId, name };
	const filePath = resolve(projectDir, "Scripts", name);
	const scriptsRoot = resolve(projectDir, "Scripts");
	const rel = relative(scriptsRoot, filePath);
	if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("External script path must remain inside the project's Scripts folder");
	return { kind: "file", moduleId, name, filePath };
}

async function applyScriptEdits(source: string, edits: Array<{ oldText: string; newText: string }>): Promise<{ source: string; diff: string }> {
	if (edits.length === 0) throw new Error("edits must contain at least one replacement");
	const matches = edits.map((edit, index) => {
		if (!edit.oldText) throw new Error(`edits[${index}].oldText must not be empty`);
		const first = source.indexOf(edit.oldText);
		if (first < 0) throw new Error(`Could not find edits[${index}] in the script. oldText must match exactly.`);
		if (source.indexOf(edit.oldText, first + edit.oldText.length) >= 0) throw new Error(`edits[${index}].oldText is ambiguous. Add more context.`);
		return { ...edit, start: first, end: first + edit.oldText.length, index };
	}).sort((a, b) => a.start - b.start);
	for (let i = 1; i < matches.length; i++) if (matches[i - 1].end > matches[i].start) throw new Error(`edits[${matches[i - 1].index}] and edits[${matches[i].index}] overlap`);
	let result = source;
	for (let i = matches.length - 1; i >= 0; i--) result = result.slice(0, matches[i].start) + matches[i].newText + result.slice(matches[i].end);
	if (result === source) throw new Error("The replacement produced no changes");
	const patch = createTwoFilesPatch("script", "script", source, result, "", "", { context: 4 });
	return { source: result, diff: patch };
}

export function createHiseScriptTool(options: HiseScriptToolOptions) {
	return defineTool({
		name: "hise_script",
		label: "hise script",
		promptSnippet: "Edit a HISE callback or included external script and diagnose it.",
		description: "Edit HISE script using hise://script/<moduleId>/<callback-or-relative-file> URIs. External paths are relative to Scripts/; an optional leading Scripts/ is normalized. Verifies external files are included before editing and refuses unsafe module guesses. Default verification is diagnose; recompile is explicit.",
		parameters: Type.Object({
			uri: Type.String({ description: "hise://script/<moduleId>/<callback> or hise://script/<moduleId>/<relative-file>" }),
			edits: Type.Array(Type.Object({ oldText: Type.String(), newText: Type.String() })),
			verify: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("diagnose"), Type.Literal("recompile")])),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const verify = params.verify ?? "diagnose";
			const target = parseScriptUri(params.uri, options.projectDir);
			let source: string;
			if (target.kind === "callback") {
				const response = await options.connection.get(`/api/get_script?moduleId=${encodeURIComponent(target.moduleId)}&callback=${encodeURIComponent(target.name)}`) as unknown as Record<string, unknown>;
				const callbacks = response.callbacks as Record<string, unknown> | undefined;
				if (!callbacks || typeof callbacks[target.name] !== "string") throw new Error(`Callback ${target.name} was not returned by HISE for module ${target.moduleId}`);
				source = callbacks[target.name] as string;
			} else {
				const params = new URLSearchParams({ moduleId: target.moduleId });
				const response = await options.connection.get(`/api/get_included_files?${params}`) as unknown as Record<string, unknown>;
				const files = Array.isArray(response.files) ? response.files : [];
				const fileValue = (entry: unknown): { path: string; processor?: string } => {
					if (typeof entry === "string") return { path: entry };
					if (entry && typeof entry === "object") return { path: "path" in entry ? String(entry.path) : "", processor: "processor" in entry ? String(entry.processor) : undefined };
					return { path: "" };
				};
				const comparable = (value: string) => normalize(value).replaceAll("\\\\", "/").toLowerCase();
				const included = files.map(fileValue).some((entry) => comparable(entry.path) === comparable(target.filePath!));
				if (!included) {
					const globalResponse = await options.connection.get("/api/get_included_files") as unknown as Record<string, unknown>;
					const globalFiles = (Array.isArray(globalResponse.files) ? globalResponse.files : []).map(fileValue);
					const otherOwner = globalFiles.find((entry) => comparable(entry.path) === comparable(target.filePath!))?.processor;
					if (otherOwner) throw new Error(`${target.name} is included by ${otherOwner}, not ${target.moduleId}. Use hise://script/${otherOwner}/${target.name}.`);
					const exists = await readFile(target.filePath!, "utf8").then(() => true).catch(() => false);
					if (exists) throw new Error(`${target.name} exists but is not included by ${target.moduleId}. Add include(\"${target.name}\"); to ${target.moduleId}/onInit, recompile, then retry. Do not use script add-file for an existing file.`);
					throw new Error(`${target.name} does not exist. To create it and add the include, run hise-cli script add-file ${target.name} --module-id ${target.moduleId} --agent.`);
				}
				source = await readFile(target.filePath!, "utf8");
			}
			const edited = await applyScriptEdits(source, params.edits);
			if (target.kind === "callback") {
				const response = await options.connection.post("/api/set_script", { moduleId: target.moduleId, callbacks: { [target.name]: edited.source }, compile: verify === "recompile" });
				if (!(response as unknown as Record<string, unknown>).success) throw new Error(JSON.stringify(response));
			} else await writeFile(target.filePath!, edited.source, "utf8");
			let verification: unknown = undefined;
			let diagnosticErrors: string[] = [];
			if (verify === "recompile" && target.kind === "file") verification = await options.connection.post("/api/recompile", { moduleId: target.moduleId });
			if (verify !== "none") {
				const body: Record<string, unknown> = { moduleId: target.moduleId, async: false };
				if (target.filePath) body.filePath = target.filePath;
				verification = await options.connection.post("/api/diagnose_script", body);
				const diagnosticResponse = verification as Record<string, unknown>;
				const diagnostics = Array.isArray(diagnosticResponse.diagnostics) ? diagnosticResponse.diagnostics : [];
				const errors = diagnostics.filter((item) => item && typeof item === "object" && "severity" in item && item.severity === "error");
				diagnosticErrors = errors.map((item) => {
					const diagnostic = item as Record<string, unknown>;
					return `line ${diagnostic.line ?? "?"}, column ${diagnostic.column ?? "?"}: ${diagnostic.message ?? "script diagnostic error"}`;
				});
			}
			const diagnosticSummary = diagnosticErrors.length > 0
				? `\nDiagnostics found errors (edit was applied):\n${diagnosticErrors.map((error) => `- ${error}`).join("\n")}`
				: "";
			return { content: [{ type: "text", text: `${edited.diff}\nVerification: ${verify}${diagnosticSummary}` }], details: { uri: params.uri, verify, target, verification, diff: edited.diff, diagnosticErrors } };
		},
		renderResult(result, _options, theme) {
			const details = result.details as { diff?: string; uri?: string } | undefined;
			const component = new Container();
			if (details?.diff) {
				component.addChild(new Spacer(1));
				component.addChild(new Text(renderDiff(details.diff, { filePath: details.uri ?? "script" }), 1, 0));
			}
			const summary = result.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").split("\n").slice(-1)[0];
			if (summary) component.addChild(new Text(theme.fg("muted", summary), 1, 0));
			return component;
		},
	});
}

export function createHiseCommandTool(runner: HiseCliRunner) {
	return defineTool({
		name: "hise_command",
		label: "hise command",
		promptSnippet: "Execute canonical hise-cli argv after consulting hise_help.",
		description:
			"Execute one canonical hise-cli command directly. Pass argv as an array without the executable, " +
			"for example [\"script\", \"get\", \"--module-id\", \"Interface\", \"--callback\", \"onInit\"]. " +
			"Use stdin for script set --stdin. Do not use REPL syntax or a separate mode field. " +
			"CLI mutations require --apply; TUI mutations follow the optimistic TUI policy.",
		parameters: Type.Object({
			argv: Type.Array(Type.String({ description: "One canonical hise-cli argument" })),
			stdin: Type.Optional(Type.String({ description: "Content supplied to a --stdin command" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const result = await runner.run(params.argv, params.stdin);
			if (!result.ok) throw new Error(result.error ?? result.text);
			return {
				content: [{ type: "text", text: truncate(result.text) }],
				details: { argv: params.argv, ok: true },
			};
		},
	});
}

const MCP_REACHABILITY_TIMEOUT_MS = 5_000;

export async function assertHiseMcpReachable(mcpClient: McpClient): Promise<void> {
	let result: McpJsonValue;
	try {
		result = await mcpClient.call(
			{ method: "tools/list", params: {} },
			{ timeoutMs: MCP_REACHABILITY_TIMEOUT_MS },
		);
	} catch (error) {
		throw new Error(`hise_research unavailable: HISE MCP server is not reachable: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (isMcpFailure(result)) {
		throw new Error(`hise_research unavailable: HISE MCP server readiness check failed: ${JSON.stringify(result)}`);
	}
}

export interface HiseResearchProgress {
	type: "start" | "end" | "diagnostics";
	label: string;
	detail?: string;
	elapsedMs?: number;
	ok?: boolean;
	issues?: string[];
}

export interface HiseResearchOptions {
	mcpClient: McpClient;
	connection: HiseConnection;
	cwd: string;
	agentDir: string;
	/** Resolve the parent agent model at invocation time. */
	model?: Model<Api>;
	getModel?: () => Model<Api> | undefined;
	thinkingLevel?: string;
	getThinkingLevel?: () => string | undefined;
	onProgress?: (progress: HiseResearchProgress) => void;
}

async function runResearchStep<T>(
	options: HiseResearchOptions,
	label: string,
	detail: string | undefined,
	fn: () => Promise<T>,
): Promise<T> {
	const startedAt = Date.now();
	options.onProgress?.({ type: "start", label, detail });
	try {
		const result = await fn();
		options.onProgress?.({ type: "end", label, detail, elapsedMs: Date.now() - startedAt, ok: true });
		return result;
	} catch (error) {
		options.onProgress?.({ type: "end", label, detail, elapsedMs: Date.now() - startedAt, ok: false });
		throw error;
	}
}

async function runOptionalResearchStep(
	options: HiseResearchOptions,
	label: string,
	detail: string,
	fn: () => Promise<McpJsonValue>,
): Promise<McpJsonValue> {
	try {
		return await runResearchStep(options, label, detail, fn);
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function extractHiseScriptBlocks(markdown: string): string[] {
	const blocks: string[] = [];
	const pattern = /```(?:hisescript|javascript|js)\s*\n([\s\S]*?)```/gi;
	for (const match of markdown.matchAll(pattern)) {
		const code = match[1]?.trim();
		if (code) blocks.push(code);
	}
	return blocks;
}

function assistantText(messages: readonly unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const value = messages[i];
		if (!value || typeof value !== "object" || !("role" in value) || value.role !== "assistant" || !("content" in value) || !Array.isArray(value.content)) continue;
		const text = value.content
			.filter((part): part is { type: "text"; text: string } => Boolean(part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string"))
			.map((part) => part.text)
			.join("\n");
		if (text) return text;
	}
	return "";
}

class HiseScriptValidationIssues extends Error {
	readonly issues: string[];

	constructor(issues: string[]) {
		super("Synthesized HiseScript did not pass diagnosis");
		this.issues = issues;
	}
}

export function filterResearchDiagnostics(diagnostics: HiseScriptDiagnostic[]): HiseScriptDiagnostic[] {
	return diagnostics.filter((diagnostic) => !(
		diagnostic.source === "api-validation" &&
		/\bmodule not found:/i.test(diagnostic.message)
	));
}

function formatDiagnostics(blockIndex: number, diagnostics: HiseScriptDiagnostic[]): string {
	return diagnostics.map((diagnostic) => {
		const suggestions = diagnostic.suggestions.length > 0 ? ` Suggestions: ${diagnostic.suggestions.join(", ")}.` : "";
		return `Block ${blockIndex + 1}, line ${diagnostic.line}, column ${diagnostic.column} [${diagnostic.severity}/${diagnostic.source}]: ${diagnostic.message}.${suggestions}`;
	}).join("\n");
}

/** Run an isolated, documentation-only Pi research session. */
export async function runHiseResearch(query: string, options: HiseResearchOptions): Promise<string> {
	await runResearchStep(options, "MCP readiness", "tools/list", () => assertHiseMcpReachable(options.mcpClient));
	registerPiOAuthFlows();
	const pi = await import("@earendil-works/pi-coding-agent");
	const docsTool = defineTool({
		name: "hise_docs",
		label: "HISE docs MCP",
		promptSnippet: "Search and retrieve HISE documentation and examples.",
		description: "Call a HISE documentation MCP tool. Allowed tools include explore_hise, search_hise, get_doc_content, search_examples, and get_example. This tool is read-only.",
		parameters: Type.Object({
			tool: Type.String(),
			arguments: Type.Optional(Type.Any()),
		}),
		async execute(_toolCallId, params) {
			const allowed = new Set(["explore_hise", "search_hise", "get_doc_content", "search_examples", "get_example"]);
			if (!allowed.has(params.tool)) throw new Error(`MCP research tool not allowed: ${params.tool}`);
			const result = await options.mcpClient.callTool({ name: params.tool, arguments: (params.arguments ?? {}) as McpJsonValue });
			return { content: [{ type: "text", text: JSON.stringify(result) }], details: { tool: params.tool } };
		},
	});
	const settingsManager = pi.SettingsManager.create(options.cwd, options.agentDir);
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd: options.cwd,
		agentDir: options.agentDir,
		settingsManager,
		systemPrompt: HISE_RESEARCH_PROMPT,
	});
	await resourceLoader.reload();
	const created = await pi.createAgentSession({
		cwd: options.cwd,
		agentDir: options.agentDir,
		resourceLoader,
		settingsManager,
		sessionManager: pi.SessionManager.inMemory(options.cwd),
		// The parent has already performed bounded MCP retrieval. Keeping the
		// child synthesis-only prevents repeated searches from consuming context.
		model: options.model ?? options.getModel?.(),
		thinkingLevel: (options.thinkingLevel ?? options.getThinkingLevel?.()) as "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | undefined,
		tools: [],
		customTools: [docsTool],
	});
	const session = created.session;
	const promptChild = async (target: typeof session, prompt: string): Promise<void> => {
		let resolveSettled!: () => void;
		const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
		const unsubscribe = target.subscribe((event) => {
			if (event.type === "agent_settled") resolveSettled();
		});
		try {
			await target.prompt(prompt);
			await settled;
		} finally {
			unsubscribe();
		}
	};
	let preparationUsage = { input: 0, output: 0, total: 0 };
	try {
		if (!session.model || session.model.provider === "unknown") throw new Error("No model available for HISE documentation research.");
		const modelLabel = `${session.model.provider}/${session.model.id} (${session.thinkingLevel})`;
		const expansionLoader = new pi.DefaultResourceLoader({
			cwd: options.cwd,
			agentDir: options.agentDir,
			settingsManager,
			systemPrompt: HISE_RESEARCH_EXPANSION_PROMPT,
		});
		await expansionLoader.reload();
		const expansionCreated = await pi.createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			resourceLoader: expansionLoader,
			settingsManager,
			sessionManager: pi.SessionManager.inMemory(options.cwd),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			tools: [],
			customTools: [],
		});
		let expandedQueries: string[];
		try {
			await runResearchStep(options, "Query expansion", modelLabel, () =>
				promptChild(expansionCreated.session, query));
			expandedQueries = parseResearchQueries(assistantText(expansionCreated.session.messages), query);
			options.onProgress?.({
				type: "end",
				label: "Expanded queries",
				detail: expandedQueries.slice(1).join(" | ") || "no additional queries",
				elapsedMs: 0,
				ok: true,
			});
			const tokens = expansionCreated.session.getSessionStats().tokens;
			preparationUsage = { input: tokens.input, output: tokens.output, total: tokens.total };
		} finally {
			expansionCreated.session.dispose();
		}
		const candidates = await collectResearchCandidates(expandedQueries, options);
		const rerankerLoader = new pi.DefaultResourceLoader({
			cwd: options.cwd,
			agentDir: options.agentDir,
			settingsManager,
			systemPrompt: HISE_RESEARCH_RERANK_PROMPT,
		});
		await rerankerLoader.reload();
		const rerankerCreated = await pi.createAgentSession({
			cwd: options.cwd,
			agentDir: options.agentDir,
			resourceLoader: rerankerLoader,
			settingsManager,
			sessionManager: pi.SessionManager.inMemory(options.cwd),
			model: session.model,
			thinkingLevel: session.thinkingLevel,
			tools: [],
			customTools: [],
		});
		let selection: ResearchSelection;
		try {
			await runResearchStep(options, "Evidence reranking", `${candidates.documentKeys.length} docs · ${candidates.exampleIds.length} examples`, () =>
				promptChild(rerankerCreated.session, buildRerankPrompt(query, candidates)));
			selection = parseResearchSelection(
				assistantText(rerankerCreated.session.messages),
				candidates.documentKeys,
				candidates.exampleIds,
			);
			const tokens = rerankerCreated.session.getSessionStats().tokens;
			preparationUsage.input += tokens.input;
			preparationUsage.output += tokens.output;
			preparationUsage.total += tokens.total;
		} finally {
			rerankerCreated.session.dispose();
		}
		const evidence = cleanResearchEvidence(
			await fetchResearchEvidence(selection, candidates, options),
		);
		await runResearchStep(options, "Synthesis", modelLabel, () =>
			promptChild(session, `${query}\n\nMCP evidence retrieved for this request:\n${evidence}\n\nSynthesize the answer strictly from this evidence; never substitute generic knowledge. For code, use HiseScript (not Python or C++), copy documented API names exactly, and do not invent functions, overloads, paths, or lifecycle callbacks that are absent from the evidence. Prefer adapting a retrieved example over writing a new one. Every fenced HiseScript, JavaScript, or JS example must be standalone code that HISE can diagnose. If the sources conflict or evidence is insufficient, say so instead of guessing.`));
		let answer = assistantText(session.messages) || "The HISE documentation researcher returned no summary.";
		const initiallyHadCode = extractHiseScriptBlocks(answer).length > 0;
		let lastAnswerWithCode = initiallyHadCode ? answer : "";
		let validatedBlocks = 0;
		let repairPasses = 0;
		let lastValidationIssues: string[] = [];
		let unverifiedIssues: string[] = [];
		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			const blocks = extractHiseScriptBlocks(answer);
			if (blocks.length === 0) {
				if (initiallyHadCode) {
					unverifiedIssues = [...lastValidationIssues, "The correction pass removed the code example, so the last example could not be verified."];
					answer = lastAnswerWithCode;
					options.onProgress?.({ type: "diagnostics", label: "Script diagnostics", detail: `attempt ${attempt}/${maxAttempts}`, issues: unverifiedIssues });
				}
				break;
			}
			lastAnswerWithCode = answer;
			let diagnostics: string[] = [];
			try {
				await runResearchStep(options, "Script validation", `attempt ${attempt}/${maxAttempts} · ${blocks.length} block${blocks.length === 1 ? "" : "s"}`, async () => {
					const issues: string[] = [];
					for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
						const result = filterResearchDiagnostics(
							await diagnoseHiseScriptCode(options.connection, blocks[blockIndex]!),
						);
						if (result.length > 0) issues.push(formatDiagnostics(blockIndex, result));
					}
					if (issues.length > 0) throw new HiseScriptValidationIssues(issues);
				});
			} catch (error) {
				diagnostics = error instanceof HiseScriptValidationIssues
					? error.issues
					: [`The diagnose endpoint could not verify the example: ${error instanceof Error ? error.message : String(error)}`];
				lastValidationIssues = diagnostics;
				options.onProgress?.({
					type: "diagnostics",
					label: "Script diagnostics",
					detail: `attempt ${attempt}/${maxAttempts}`,
					issues: diagnostics,
				});
			}
			if (diagnostics.length === 0) {
				validatedBlocks = blocks.length;
				break;
			}
			if (attempt === maxAttempts || diagnostics.some((issue) => issue.startsWith("The diagnose endpoint could not verify"))) {
				unverifiedIssues = diagnostics;
				break;
			}
			repairPasses++;
			await runResearchStep(options, "Script correction", `pass ${repairPasses} · ${modelLabel}`, () =>
				promptChild(session, `The HISE headless diagnose endpoint rejected code in your previous answer. Return a complete replacement answer, preserving sourced facts and citations, but fix every listed issue. Do not remove the code example and do not explain the correction process.\n\n${diagnostics.join("\n")}`));
			answer = assistantText(session.messages) || answer;
		}
		const synthesisUsage = session.getSessionStats().tokens;
		const usage = {
			input: synthesisUsage.input + preparationUsage.input,
			output: synthesisUsage.output + preparationUsage.output,
			total: synthesisUsage.total + preparationUsage.total,
		};
		const validation = validatedBlocks > 0
			? `Script validation: passed (${validatedBlocks} block${validatedBlocks === 1 ? "" : "s"}, ${repairPasses} repair pass${repairPasses === 1 ? "" : "es"})`
			: unverifiedIssues.length > 0
				? `Script validation: example could not be verified.\n${unverifiedIssues.map((issue) => `- ${issue}`).join("\n")}`
				: "";
		const usageLine = `Research model: ${modelLabel}\nResearch usage: ${formatTokenCount(usage.input)} input · ${formatTokenCount(usage.output)} output · ${formatTokenCount(usage.total)} total tokens`;
		return truncate(`${answer}\n\n---\n${usageLine}${validation ? `\n${validation}` : ""}`);
	} finally {
		session.dispose();
	}
}

export function createHiseResearchTool(options: HiseResearchOptions) {
	return defineTool({
		name: "hise_research",
		label: "hise research",
		promptSnippet: "Escalate an unfamiliar HISE API or semantic question to sourced documentation research.",
		description: "Use this read-only research agent only when hise_help and minimal live inspection are insufficient for an unfamiliar HISE API or semantic question, or when the user explicitly requests documentation or examples. Do not call it for CLI syntax, project discovery, node/component lookup, or routine builder/UI/DSP add, set, connect, remove, save, or verification tasks. It searches HISE documentation and examples and returns a concise sourced answer; it never inspects or modifies the current project.",
		parameters: Type.Object({ query: Type.String({ description: "HISE documentation or code-example question" }) }),
		async execute(_toolCallId, params) {
			const text = await runHiseResearch(params.query, options);
			return { content: [{ type: "text", text }], details: { query: params.query } };
		},
	});
}

function mcpResultText(value: McpJsonValue): string {
	if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
	const content = Array.isArray(value.content) ? value.content : [];
	const text = content
		.map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.text === "string" ? item.text : "")
		.filter(Boolean)
		.join("\n");
	return text || JSON.stringify(value);
}

export function extractResearchReferences(primary: McpJsonValue, examples: McpJsonValue): { urls: string[]; ids: string[] } {
	// Search the decoded MCP text instead of JSON.stringify output. The latter
	// escapes nested JSON quotes, leaving a trailing backslash on matched IDs.
	const primaryText = mcpResultText(primary);
	const exampleText = mcpResultText(examples);
	return {
		urls: [...new Set(primaryText.match(/\/v2\/[^"\\\s]+/g) ?? [])].slice(0, 3),
		ids: [...new Set(exampleText.match(/example:[A-Za-z0-9._:-]+/g) ?? [])].slice(0, 3),
	};
}

interface ResearchCandidates {
	primary: McpJsonValue;
	broad: McpJsonValue;
	examples: McpJsonValue;
	documentKeys: string[];
	exampleIds: string[];
}

interface ResearchSelection {
	documentKeys: string[];
	exampleIds: string[];
}

async function collectResearchCandidates(queries: string[], options: HiseResearchOptions): Promise<ResearchCandidates> {
	const { mcpClient } = options;
	const primaryResults: McpJsonValue[] = [];
	const broadResults: SearchResultSummary[] = [];
	const exampleResults: SearchResultSummary[] = [];
	const semanticDocumentLists: string[][] = [];
	const broadDocumentLists: string[][] = [];
	const exampleLists: string[][] = [];
	for (let index = 0; index < queries.length; index++) {
		const query = queries[index]!;
		// The literal query is mandatory. Expanded variants improve recall but may
		// fail independently without discarding otherwise useful evidence.
		const primary = index === 0
			? await runResearchStep(options, "Documentation search", `explore_hise · ${index + 1}/${queries.length}`, () =>
				mcpClient.callTool({ name: "explore_hise", arguments: { query } }))
			: await runOptionalResearchStep(options, "Expanded documentation search", `explore_hise · ${index + 1}/${queries.length}`, () =>
				mcpClient.callTool({ name: "explore_hise", arguments: { query } }));
		const broad = await runOptionalResearchStep(options, "Broad candidate search", `search_hise · ${index + 1}/${queries.length}`, () =>
			mcpClient.callTool({ name: "search_hise", arguments: { query, limit: 20 } }));
		const examples = await runOptionalResearchStep(options, "Example search", `search_examples · ${index + 1}/${queries.length}`, () =>
			mcpClient.callTool({ name: "search_examples", arguments: { query, limit: 20 } }));
		primaryResults.push(primary);
		const broadItems = extractSearchResults(broad);
		const exampleItems = extractSearchResults(examples);
		broadResults.push(...broadItems);
		exampleResults.push(...exampleItems);
		const urls = [...new Set(mcpResultText(primary).match(/\/v2\/scripting-api\/[^"\\\s]+/g) ?? [])];
		semanticDocumentLists.push(urls);
		broadDocumentLists.push(broadItems.map((item) => `id:${item.id}`));
		exampleLists.push(exampleItems.map((item) => item.id));
	}
	const semanticDocuments = fuseRankedCandidates(semanticDocumentLists, 40);
	const broadDocuments = fuseRankedCandidates(broadDocumentLists, 40)
		.filter((key) => !semanticDocuments.includes(key));
	return {
		primary: textMcpResult(primaryResults.map(mcpResultText).join("\n\n--- EXPANDED QUERY ---\n\n")),
		broad: textMcpResult(JSON.stringify({ results: dedupeSearchResults(broadResults) })),
		examples: textMcpResult(JSON.stringify({ results: dedupeSearchResults(exampleResults) })),
		documentKeys: [...semanticDocuments, ...broadDocuments],
		exampleIds: fuseRankedCandidates(exampleLists, 40),
	};
}

function textMcpResult(text: string): McpJsonValue {
	return { content: [{ type: "text", text }] };
}

function dedupeSearchResults(results: SearchResultSummary[]): SearchResultSummary[] {
	const seen = new Set<string>();
	return results.filter((result) => !seen.has(result.id) && Boolean(seen.add(result.id)));
}

function fuseRankedCandidates(lists: string[][], limit: number): string[] {
	const scores = new Map<string, number>();
	const order = new Map<string, number>();
	let nextOrder = 0;
	for (const list of lists) {
		list.forEach((key, index) => {
			scores.set(key, (scores.get(key) ?? 0) + 1 / (60 + index));
			if (!order.has(key)) order.set(key, nextOrder++);
		});
	}
	return [...scores.keys()]
		.sort((a, b) => (scores.get(b)! - scores.get(a)!) || (order.get(a)! - order.get(b)!))
		.slice(0, limit);
}

interface SearchResultSummary {
	id: string;
	name: string;
	description: string;
}

function extractSearchResults(value: McpJsonValue): SearchResultSummary[] {
	try {
		const parsed = JSON.parse(mcpResultText(value)) as {
			results?: Array<{ id?: unknown; name?: unknown; title?: unknown; description?: unknown }>;
		};
		return (parsed.results ?? []).flatMap((result) => typeof result.id === "string" ? [{
			id: result.id,
			name: typeof result.name === "string" ? result.name : typeof result.title === "string" ? result.title : result.id,
			description: typeof result.description === "string" ? result.description : "",
		}] : []);
	} catch {
		return [];
	}
}

function extractSearchResultIds(value: McpJsonValue): string[] {
	return extractSearchResults(value).map((result) => result.id);
}

function primaryCandidateSummary(text: string, key: string): string {
	const lines = text.split("\n");
	const index = lines.findIndex((line) => line.trim() === key);
	if (index < 0) return key;
	const name = index > 0 ? lines[index - 1]!.trim() : key;
	const description = index + 1 < lines.length ? lines[index + 1]!.trim() : "";
	return `${key} | ${name} | ${description}`;
}

function compactDescription(text: string): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= 240 ? oneLine : `${oneLine.slice(0, 240)}...`;
}

function buildRerankPrompt(query: string, candidates: ResearchCandidates): string {
	const primaryText = mcpResultText(candidates.primary);
	const broad = new Map(extractSearchResults(candidates.broad).map((result) => [`id:${result.id}`, result]));
	const examples = new Map(extractSearchResults(candidates.examples).map((result) => [result.id, result]));
	const documentLines = candidates.documentKeys.map((key) => {
		if (!key.startsWith("id:")) return primaryCandidateSummary(primaryText, key);
		const result = broad.get(key);
		return result ? `${key} | ${result.name} | ${compactDescription(result.description)}` : key;
	});
	const exampleLines = candidates.exampleIds.map((id) => {
		const result = examples.get(id);
		return result ? `${id} | ${result.name} | ${compactDescription(result.description)}` : id;
	});
	return `QUESTION\n${query}\n\nDOCUMENT CANDIDATES\n${documentLines.join("\n")}\n\nEXAMPLE CANDIDATES\n${exampleLines.join("\n")}\n\nReturn only the selection JSON.`;
}

export function parseResearchQueries(text: string, originalQuery: string): string[] {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	try {
		const parsed = JSON.parse(candidate) as { queries?: unknown };
		const expanded = Array.isArray(parsed.queries)
			? parsed.queries
				.filter((value): value is string => typeof value === "string")
				.map((value) => value.replace(/\s+/g, " ").trim())
				.filter((value) => value.length > 0 && value.length <= 300)
			: [];
		return [...new Set([originalQuery, ...expanded])].slice(0, 4);
	} catch {
		return [originalQuery];
	}
}

export function parseResearchSelection(
	text: string,
	availableDocumentKeys: string[],
	availableExampleIds: string[],
): ResearchSelection {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	try {
		const parsed = JSON.parse(candidate) as { documentKeys?: unknown; exampleIds?: unknown };
		const documents = new Set(availableDocumentKeys);
		const examples = new Set(availableExampleIds);
		const documentKeys = Array.isArray(parsed.documentKeys)
			? parsed.documentKeys.filter((value): value is string => typeof value === "string" && documents.has(value)).slice(0, 4)
			: [];
		const exampleIds = Array.isArray(parsed.exampleIds)
			? parsed.exampleIds.filter((value): value is string => typeof value === "string" && examples.has(value)).slice(0, 2)
			: [];
		if (documentKeys.length > 0) return { documentKeys, exampleIds };
	} catch { /* fall through to bounded retrieval-order fallback */ }
	return {
		documentKeys: availableDocumentKeys.slice(0, 3),
		exampleIds: availableExampleIds.slice(0, 2),
	};
}

async function fetchResearchEvidence(
	selection: ResearchSelection,
	candidates: ResearchCandidates,
	options: HiseResearchOptions,
): Promise<string> {
	const fullDocs: Array<{ key: string; result: McpJsonValue }> = [];
	for (const key of selection.documentKeys) {
		const args: McpJsonValue = key.startsWith("id:") ? { id: key.slice(3) } : { url: key };
		const result = await runOptionalResearchStep(options, "Document lookup", key, () =>
			options.mcpClient.callTool({ name: "get_doc_content", arguments: args }));
		if (!isMcpFailure(result)) fullDocs.push({ key, result });
	}
	const fullExamples: Array<{ id: string; result: McpJsonValue }> = [];
	for (const id of selection.exampleIds) {
		const result = await runOptionalResearchStep(options, "Example lookup", id, () =>
			options.mcpClient.callTool({ name: "get_example", arguments: { id } }));
		if (!isMcpFailure(result)) fullExamples.push({ id, result });
	}
	const sections = [
		`SELECTED SOURCES\n${selection.documentKeys.join("\n")}${selection.exampleIds.length > 0 ? `\n${selection.exampleIds.join("\n")}` : ""}`,
		...fullDocs.map((item) => `DOCUMENT ${item.key}\n${clipEvidence(mcpResultText(item.result), 5000)}`),
		...fullExamples.map((item) => `EXAMPLE ${item.id}\n${clipEvidence(mcpResultText(item.result), 5000)}`),
	];
	if (sections.length === 1) {
		return `SEARCH RESULTS\n${clipEvidence(mcpResultText(candidates.primary), 5000)}`;
	}
	return sections.join("\n\n");
}

export function cleanResearchEvidence(evidence: string): string {
	const output: string[] = [];
	let skipInternalSection = false;
	for (const line of evidence.split("\n")) {
		if (/^(?:Source|Dispatch\/mechanics):\s*$/.test(line.trim())) {
			skipInternalSection = true;
			continue;
		}
		if (skipInternalSection) {
			if (line.trim() === "") skipInternalSection = false;
			continue;
		}
		const trimmed = line.trim();
		if (/^Thread safety:/i.test(trimmed)) continue;
		if (/^[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*\(.*\)\s*->/.test(trimmed)) continue;
		if (/^\*\*Common pitfalls:\*\*\s*(?:\[object Object\],?)*\s*$/.test(trimmed)) continue;
		if (/\b(?:WARN_IF_AUDIO_THREAD|USE_BACKEND|HISE_[A-Z0-9_]+|JUCE_[A-Z0-9_]+)\b/.test(line)) continue;
		if (/\.(?:cpp|cc|cxx|h|hpp):\d+\b/.test(line)) continue;
		if (trimmed === "" && output.at(-1)?.trim() === "") continue;
		output.push(line);
	}
	return output.join("\n").trim();
}

function clipEvidence(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[remaining evidence omitted]`;
}

function formatTokenCount(value: number): string {
	return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

function isMcpFailure(value: McpJsonValue): boolean {
	return Boolean(value && typeof value === "object" && !Array.isArray(value) && "error" in value);
}

const HISE_RESEARCH_EXPANSION_PROMPT = `You rewrite HISE documentation questions for semantic retrieval. Do not answer the question. Return exactly one JSON object with a queries array containing two or three short alternative searches. Preserve explicit identifiers. Add precise HISE vocabulary, expand ambiguous user terms, and describe both acquisition and follow-up operations when the task is a workflow. Preserve every relationship constraint from the original question in each rewrite, such as one processor owning an object that another script must access. Include plausible alternative interpretations rather than committing to an uncertain one. In HISE, "module" usually means a processor; "node" may mean a ScriptNode Node in a DspNetwork, a child processor in the module tree, or a UI child component; and the Interface script accessing another module is a cross-processor operation. Cover these distinct meanings when the wording is ambiguous. Do not include the original query; the caller preserves it automatically.

Example output:
{"queries":["cross-processor ScriptNode DspNetwork access from an Interface script","retrieve an existing DSP network owned by another script processor then get a Node by ID","reference a child HISE processor from the Interface script"]}`;

const HISE_RESEARCH_RERANK_PROMPT = `You select evidence for a HISE documentation answer. Given a user question and shallow MCP search results, choose only the documents and examples that contain facts needed to answer the question. Select complete workflows, including acquisition and follow-up methods when separate candidates cover separate steps. Exclude merely similar classes, methods, and examples. Do not answer the question or invent identifiers.

Return exactly one JSON object:
{"documentKeys":["exact candidate URL or id:key"],"exampleIds":["exact candidate ID"]}

Select at most 4 documents and 2 examples. Every value must be copied exactly from the candidates. Examples are optional; omit them when they do not directly demonstrate the requested workflow.`;

const HISE_RESEARCH_PROMPT = `You are a research-only HISE documentation specialist. The parent has retrieved a bounded evidence pack from HISE documentation and the code-example database. For code-oriented questions, use the retrieved full API documentation and examples before synthesizing. Return a concise Markdown answer with documented facts, a focused example when useful, caveats, and source URLs or example IDs. Never claim to inspect or modify the user's project. Flag contradictions in the sources.

Output style:
- Write for HISEScript developers, not C++ developers. Lead with the recommended pattern, when to use it, and any practical default.
- Use concise British English and ASCII punctuation. Avoid filler, marketing language, and restating headings.
- Include code only when it demonstrates a useful pattern, non-obvious behaviour, or realistic mistake. Keep it focused and executable in its stated context, with essential setup and every referenced variable declared.
- Do not invent setup code or API calls. Prefer retrieved, validated patterns and state clearly when evidence is incomplete.
- Comments should explain why or show expected output, not narrate obvious statements.
- Include only non-obvious caveats and common mistakes. Explain the consequence and the correct alternative.
- Do not expose C++ class names, source locations, preprocessor symbols, or internal implementation mechanisms.
- Use lists or compact tables for three or more options, modes, fields, or steps.

${HISESCRIPT_CHEAT_SHEET}`;

export function createHiseHelpTool() {
	return defineTool({
		name: "hise_help",
		label: "hise help",
		promptSnippet: "Retrieve authoritative hise-cli help before acting.",
		description:
			"Retrieve authoritative hise-cli help. Pass mode to get that mode's help text, or omit mode " +
			"for the full command context. This describes how to use hise-cli; it does not inspect live HISE state. " +
			"Use this before constructing command argv.",
		parameters: Type.Object({
			mode: Type.Optional(Type.String({ description: "Mode whose canonical CLI help should be returned" })),
		}),
		async execute(_toolCallId, params) {
			const text = params.mode
				? renderCliHelp([], params.mode)
				: JSON.stringify(buildAgentContext(), null, 1);
			if (text.startsWith("Unknown help topic:")) throw new Error(text);
			return {
				content: [{ type: "text", text: truncate(text) }],
				details: { mode: params.mode ?? null },
			};
		},
	});
}
