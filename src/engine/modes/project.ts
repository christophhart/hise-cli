// ── /project mode — lifecycle, settings, files, snippets ───────────
//
// Single-file mode following the InspectMode template, with explicit
// handlers per verb. Uses normalized contracts from src/mock/contracts/project.ts
// + parsers from project-parse.ts + formatters from project-format.ts.

import { isEnvelopeResponse, isErrorResponse, isSuccessResponse, type HiseSuccessResponse } from "../hise.js";
import type { CommandResult, TreeNode } from "../result.js";
import { errorResult, markdownResult, preformattedResult, textResult, wizardResult } from "../result.js";
import { renderTreeBox } from "./builder-ops.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeProject } from "../highlight/project.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";
import type { PreprocessorList } from "../data.js";
import {
	normalizePreprocessorList,
	normalizeProjectFiles,
	normalizeProjectList,
	normalizeProjectSave,
	normalizeProjectSettings,
	normalizeProjectSnippet,
	normalizeProjectTree,
	type ProjectListPayload,
	type ProjectSettingsPayload,
	type ProjectTreePayload,
} from "../../mock/contracts/project.js";
import { extractStatusPayload } from "./inspect.js";
import {
	buildTreeNode,
	formatDescribeSetting,
	formatFiles,
	formatInfo,
	formatPreprocessors,
	formatProjects,
	formatSaveResult,
	formatSettings,
} from "./project-format.js";
import {
	extractScopeClauses,
	parseBoolToken,
	parseSaveCommand,
	tokenize,
} from "./project-parse.js";

const PROJECT_VERBS = new Map<string, string>([
	["info", "Show name + folder + scripts folder"],
	["show", "show projects | settings | files | preprocessors [for <target>] [on <os>]"],
	["describe", "describe <key> — full setting description"],
	["switch", "switch <name|path> — switch active project"],
	["save", "save xml | hip [as <filename>]"],
	["load", "load <relative-path>"],
	["set", "set <key> <value> | set preprocessor <name> <value> [on <os>] [for <target>]"],
	["clear", "clear preprocessor <name> [on <os>] [for <target>]"],
	["snippet", "snippet export | snippet load [<string>]"],
	["create", "create — alias for /wizard new_project"],
	["help", "Show /project commands"],
]);

export class ProjectMode implements Mode {
	readonly id: Mode["id"] = "project";
	readonly name = "Project";
	readonly accent = MODE_ACCENTS.project;
	readonly prompt = "[project] > ";

	private readonly completionEngine: CompletionEngine | null;
	private readonly preprocessorList: PreprocessorList | null;

	private cachedTree: ProjectTreePayload | null = null;
	private cachedSettings: ProjectSettingsPayload | null = null;
	private cachedList: ProjectListPayload | null = null;

	constructor(completionEngine?: CompletionEngine, preprocessorList?: PreprocessorList | null) {
		this.completionEngine = completionEngine ?? null;
		this.preprocessorList = preprocessorList ?? null;
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeProject(value);
	}

	complete(input: string, _cursor: number): CompletionResult {
		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const items = this.completionEngine
			? this.completionEngine.completeProject(trimmed, {
				preprocessorNames: this.preprocessorList
					? Object.keys(this.preprocessorList.preprocessors)
					: [],
				settingKeys: this.cachedSettings ? Object.keys(this.cachedSettings.settings) : [],
				projectNames: this.cachedList?.projects.map((p) => p.name) ?? [],
			})
			: [];
		return { items, from: leadingSpaces, to: input.length, label: "Project commands" };
	}

	async onEnter(session: SessionContext): Promise<void> {
		// Eager load: tree + settings + list so describe/switch completion has data.
		if (!session.connection) return;
		await this.refreshTree(session);
		await this.refreshSettings(session);
		await this.refreshList(session);
	}

	invalidateTree(): void {
		this.cachedTree = null;
	}

	getTree(): TreeNode | null {
		if (!this.cachedTree) return null;
		return buildTreeNode(this.cachedTree.root);
	}

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		const trimmed = input.trim();
		if (!trimmed) return helpResult();

		const spaceIndex = trimmed.indexOf(" ");
		const verb = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
		const rest = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1);

		if (verb === "help") return helpResult();
		if (!PROJECT_VERBS.has(verb)) {
			return errorResult(`Unknown /project command: "${verb}". Type \`help\` for the list.`);
		}

		if (verb === "create") {
			return this.handleCreate(session);
		}

		if (!session.connection) {
			return errorResult("No HISE connection. Connect to HISE before using project mode.");
		}

		switch (verb) {
			case "info":
				return this.handleInfo(session);
			case "show":
				return this.handleShow(rest, session);
			case "describe":
				return this.handleDescribe(rest, session);
			case "switch":
				return this.handleSwitch(rest, session);
			case "save":
				return this.handleSave(rest, session);
			case "load":
				return this.handleLoad(rest, session);
			case "set":
				return this.handleSet(rest, session);
			case "clear":
				return this.handleClear(rest, session);
			case "snippet":
				return this.handleSnippet(rest, session);
		}
		return errorResult(`Unhandled verb: ${verb}`);
	}

	// ── Verb handlers ───────────────────────────────────────────────

	private async handleInfo(session: SessionContext): Promise<CommandResult> {
		const response = await session.connection!.get("/api/status");
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		try {
			const status = extractStatusPayload(errored.envelope as unknown as Record<string, unknown>);
			const activeIsSnippetBrowser = readActiveIsSnippetBrowser(errored.envelope);
			session.playgroundActive = activeIsSnippetBrowser;
			return formatInfo(status, activeIsSnippetBrowser);
		} catch (err) {
			return errorResult(String(err));
		}
	}

	private async handleShow(rest: string, session: SessionContext): Promise<CommandResult> {
		const tokens = tokenize(rest);
		const sub = tokens[0]?.toLowerCase();
		if (!sub) return errorResult("show requires a target: projects | settings | files | preprocessors");
		switch (sub) {
			case "projects": {
				const list = await this.refreshList(session);
				if ("error" in list) return list.error;
				return formatProjects(list.payload);
			}
			case "settings": {
				const settings = await this.refreshSettings(session);
				if ("error" in settings) return settings.error;
				return formatSettings(settings.payload);
			}
			case "files": {
				const response = await session.connection!.get("/api/project/files");
				const errored = errorOrSuccess(response);
				if (errored.kind === "error") return errored.result;
				try {
					return formatFiles(normalizeProjectFiles(errored.envelope));
				} catch (err) {
					return errorResult(String(err));
				}
			}
			case "preprocessors": {
				const scope = extractScopeClauses(tokens.slice(1));
				if ("error" in scope) return errorResult(scope.error);
				const params = new URLSearchParams();
				if (scope.os !== "all") params.set("OS", scope.os);
				if (scope.target !== "all") params.set("target", scope.target);
				const url = `/api/project/preprocessor/list${params.toString() ? `?${params}` : ""}`;
				const response = await session.connection!.get(url);
				const errored = errorOrSuccess(response);
				if (errored.kind === "error") return errored.result;
				try {
					return formatPreprocessors(
						normalizePreprocessorList(errored.envelope),
						scope.os,
						scope.target,
					);
				} catch (err) {
					return errorResult(String(err));
				}
			}
			case "tree": {
				const ok = await this.refreshTree(session);
				if (!ok) return errorResult("Failed to load project tree.");
				return preformattedResult(renderTreeBox(buildTreeNode(this.cachedTree!.root)), undefined, true);
			}
			default:
				return errorResult(`Unknown show target: "${sub}". Use projects | settings | files | preprocessors | tree.`);
		}
	}

	private async handleDescribe(rest: string, session: SessionContext): Promise<CommandResult> {
		const key = rest.trim();
		if (!key) return errorResult("describe requires a setting key.");
		const settings = await this.refreshSettings(session);
		if ("error" in settings) return settings.error;
		return formatDescribeSetting(key, settings.payload);
	}

	private async handleSwitch(rest: string, session: SessionContext): Promise<CommandResult> {
		const arg = rest.trim();
		if (!arg) return errorResult("switch requires a name or absolute path.");
		const list = await this.refreshList(session);
		if ("error" in list) return list.error;
		const target = resolveSwitchTarget(list.payload, arg);
		if (!target) {
			return errorResult(`Unknown project: "${arg}". Use \`show projects\` for the list.`);
		}
		const response = await session.connection!.post("/api/project/switch", { project: target.path });
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		this.markDirtyAfterMutation(session);
		return textResult(`Switched to ${target.name}`);
	}

	private async handleSave(rest: string, session: SessionContext): Promise<CommandResult> {
		const parsed = parseSaveCommand(rest);
		if ("error" in parsed) return errorResult(parsed.error);
		const body: Record<string, unknown> = { format: parsed.format };
		if (parsed.filename) body.filename = parsed.filename;
		const response = await session.connection!.post("/api/project/save", body);
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		try {
			const payload = normalizeProjectSave(errored.envelope);
			this.markDirtyAfterMutation(session);
			return formatSaveResult(payload);
		} catch (err) {
			return errorResult(String(err));
		}
	}

	private async handleLoad(rest: string, session: SessionContext): Promise<CommandResult> {
		const file = rest.trim();
		if (!file) return errorResult("load requires a relative file path.");
		const response = await session.connection!.post("/api/project/load", { file });
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		this.markDirtyAfterMutation(session);
		return textResult(`Loaded ${file}`);
	}

	private async handleSet(rest: string, session: SessionContext): Promise<CommandResult> {
		const tokens = tokenize(rest);
		if (tokens.length === 0) {
			return errorResult("set requires <key> <value> or `preprocessor <name> <value> ...`");
		}
		if (tokens[0]!.toLowerCase() === "preprocessor") {
			return this.handlePreprocessorSet(tokens.slice(1), session, false);
		}
		if (tokens.length < 2) {
			return errorResult(`set ${tokens[0]} requires a value.`);
		}
		const key = tokens[0]!;
		const rawValue = tokens.slice(1).join(" ");
		const settings = await this.refreshSettings(session);
		if ("error" in settings) return settings.error;
		const entry = settings.payload.settings[key];
		if (!entry) {
			return errorResult(`Unknown setting: "${key}". Use \`show settings\`.`);
		}
		const sendValue = normalizeSettingForSend(rawValue, entry.options);
		const response = await session.connection!.post("/api/project/settings/set", {
			key,
			value: sendValue,
		});
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		this.cachedSettings = null;
		this.markDirtyAfterMutation(session);
		return textResult(`Set ${key} = ${sendValue}`);
	}

	private async handleClear(rest: string, session: SessionContext): Promise<CommandResult> {
		const tokens = tokenize(rest);
		if (tokens.length === 0 || tokens[0]!.toLowerCase() !== "preprocessor") {
			return errorResult("clear must be `clear preprocessor <name> [on <os>] [for <target>]`");
		}
		return this.handlePreprocessorSet(tokens.slice(1), session, true);
	}

	private async handlePreprocessorSet(
		args: string[],
		session: SessionContext,
		clear: boolean,
	): Promise<CommandResult> {
		if (args.length === 0) {
			return errorResult("set preprocessor requires a name");
		}
		const scopeResult = extractScopeClauses(args);
		if ("error" in scopeResult) return errorResult(scopeResult.error);
		const remaining = scopeResult.tokens;
		if (remaining.length === 0) {
			return errorResult("set preprocessor requires a name");
		}
		const name = remaining[0]!;
		let value: string;
		if (clear) {
			if (remaining.length > 1) {
				return errorResult("clear preprocessor takes only the macro name (no value).");
			}
			value = "default";
		} else {
			if (remaining.length < 2) {
				return errorResult(`set preprocessor ${name} requires a value (integer or "default").`);
			}
			value = remaining[1]!;
			if (value !== "default" && !/^-?\d+$/.test(value)) {
				return errorResult(`preprocessor value must be an integer or "default", got "${value}".`);
			}
		}
		const response = await session.connection!.post("/api/project/preprocessor/set", {
			OS: scopeResult.os,
			target: scopeResult.target,
			preprocessor: name,
			value,
		});
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		this.markDirtyAfterMutation(session);
		const verb = clear || value === "default" ? "Cleared" : `Set ${name}=${value}`;
		const scopeLabel = `${scopeResult.target}/${scopeResult.os}`;
		return textResult(clear || value === "default"
			? `${verb} ${name} for ${scopeLabel}`
			: `${verb} for ${scopeLabel}`);
	}

	private async handleSnippet(rest: string, session: SessionContext): Promise<CommandResult> {
		const tokens = tokenize(rest);
		const sub = tokens[0]?.toLowerCase();
		if (sub === "export") {
			return this.handleSnippetExport(session);
		}
		if (sub === "load") {
			return this.handleSnippetLoad(rest.slice(rest.toLowerCase().indexOf("load") + 4).trim(), session);
		}
		return errorResult("snippet requires `export` or `load`.");
	}

	private async handleSnippetExport(session: SessionContext): Promise<CommandResult> {
		const response = await session.connection!.get("/api/project/export_snippet");
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		try {
			const payload = normalizeProjectSnippet(errored.envelope);
			session.copyToClipboard?.(payload.snippet);
			const preview = payload.snippet.length > 50
				? `${payload.snippet.slice(0, 50)}…`
				: payload.snippet;
			const lines = [
				"## Snippet exported",
				"",
				"```",
				preview,
				"```",
				"",
				`**${payload.snippet.length}** bytes — copied to clipboard.`,
			];
			return markdownResult(lines.join("\n"));
		} catch (err) {
			return errorResult(String(err));
		}
	}

	private async handleSnippetLoad(arg: string, session: SessionContext): Promise<CommandResult> {
		let snippet = arg.trim();
		if (!snippet) {
			const fromClipboard = session.readClipboard ? await session.readClipboard() : null;
			if (!fromClipboard) {
				return errorResult("No snippet argument provided and clipboard is unavailable.");
			}
			snippet = fromClipboard.trim();
		}
		if (!snippet.startsWith("HiseSnippet ")) {
			return errorResult('Snippet must start with "HiseSnippet ".');
		}
		const response = await session.connection!.post("/api/project/import_snippet", { snippet });
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return errored.result;
		this.markDirtyAfterMutation(session);
		return textResult("Imported snippet");
	}

	private handleCreate(session: SessionContext): CommandResult {
		const registry = session.wizardRegistry;
		if (!registry) {
			return errorResult("Wizard registry not loaded. Use /wizard list to inspect.");
		}
		const def = registry.get("new_project");
		if (!def) {
			return errorResult('Wizard "new_project" is not registered.');
		}
		return wizardResult(def);
	}

	// ── Cache helpers ───────────────────────────────────────────────

	private async refreshList(
		session: SessionContext,
	): Promise<{ payload: ProjectListPayload } | { error: CommandResult }> {
		const response = await session.connection!.get("/api/project/list");
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return { error: errored.result };
		try {
			const payload = normalizeProjectList(errored.envelope);
			this.cachedList = payload;
			return { payload };
		} catch (err) {
			return { error: errorResult(String(err)) };
		}
	}

	private async refreshSettings(
		session: SessionContext,
	): Promise<{ payload: ProjectSettingsPayload } | { error: CommandResult }> {
		const response = await session.connection!.get("/api/project/settings/list");
		const errored = errorOrSuccess(response);
		if (errored.kind === "error") return { error: errored.result };
		try {
			const payload = normalizeProjectSettings(errored.envelope);
			this.cachedSettings = payload;
			return { payload };
		} catch (err) {
			return { error: errorResult(String(err)) };
		}
	}

	private async refreshTree(session: SessionContext): Promise<boolean> {
		const response = await session.connection!.get("/api/project/tree");
		if (isErrorResponse(response) || !isSuccessResponse(response)) return false;
		try {
			this.cachedTree = normalizeProjectTree(response);
			return true;
		} catch {
			return false;
		}
	}

	private markDirtyAfterMutation(session: SessionContext): void {
		this.cachedTree = null;
		session.markProjectTreeDirty?.();
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

function helpResult(): CommandResult {
	const lines = [
		"## /project commands",
		"",
		"| Command | Syntax |",
		"|---------|--------|",
	];
	for (const [verb, desc] of PROJECT_VERBS) {
		lines.push(`| \`${verb}\` | ${desc} |`);
	}
	return markdownResult(lines.join("\n"));
}

interface ErrorOrSuccess {
	kind: "error" | "ok";
	result: CommandResult;
	envelope: HiseSuccessResponse;
}

function errorOrSuccess(
	response: import("../hise.js").HiseResponse,
): ErrorOrSuccess {
	if (isErrorResponse(response)) {
		return {
			kind: "error",
			result: errorResult(response.message),
			envelope: {} as HiseSuccessResponse,
		};
	}
	if (!isEnvelopeResponse(response)) {
		return {
			kind: "error",
			result: errorResult("Unexpected response from HISE"),
			envelope: {} as HiseSuccessResponse,
		};
	}
	if (!response.success) {
		const message = response.errors?.[0]?.errorMessage ?? "Request failed";
		return {
			kind: "error",
			result: errorResult(message),
			envelope: response as unknown as HiseSuccessResponse,
		};
	}
	return { kind: "ok", result: textResult(""), envelope: response as HiseSuccessResponse };
}

function readActiveIsSnippetBrowser(envelope: HiseSuccessResponse): boolean {
	const raw = envelope["activeIsSnippetBrowser"];
	if (typeof raw === "boolean") return raw;
	if (typeof raw === "string") return raw === "true";
	return false;
}

function resolveSwitchTarget(
	payload: ProjectListPayload,
	arg: string,
): { name: string; path: string } | null {
	for (const p of payload.projects) {
		if (p.path === arg) return p;
	}
	for (const p of payload.projects) {
		if (p.name === arg) return p;
	}
	// Allow an absolute path that isn't in the list — server will validate.
	if (arg.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(arg)) {
		return { name: arg, path: arg };
	}
	return null;
}

function normalizeSettingForSend(
	value: string,
	options: Array<string | number | boolean> | undefined,
): string {
	if (!options) return value;
	const hasBool = options.some((o) => typeof o === "boolean");
	if (hasBool) {
		const parsed = parseBoolToken(value);
		if (parsed === true) return "true";
		if (parsed === false) return "false";
	}
	return value;
}
