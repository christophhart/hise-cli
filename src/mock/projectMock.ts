// ── Project endpoint mock handlers ──────────────────────────────────
//
// Wires all 12 /api/project/* endpoints to the in-memory MockProjectState
// fixture. Mutations land back on the state object so reads and writes
// stay coherent for the duration of a session.

import type { HiseResponse, MockHiseConnection } from "../engine/hise.js";
import type {
	MockProjectState,
} from "./projectFixtures.js";
import type { StatusPayload } from "./contracts/status.js";
import type { ProjectListEntry } from "./contracts/project.js";

export function installProjectMock(
	connection: MockHiseConnection,
	state: MockProjectState,
	status: StatusPayload,
): void {
	// ── GET /api/project/list ──────────────────────────────────
	connection.onGet("/api/project/list", () => ({
		success: true,
		projects: state.list.projects,
		active: state.list.active,
		logs: [],
		errors: [],
	}));

	// ── GET /api/project/tree ──────────────────────────────────
	connection.onGet("/api/project/tree", () => ({
		success: true,
		projectName: state.tree.projectName,
		root: state.tree.root,
		logs: [],
		errors: [],
	}));

	// ── GET /api/project/files ─────────────────────────────────
	connection.onGet("/api/project/files", () => ({
		success: true,
		files: state.files.files,
		logs: [],
		errors: [],
	}));

	// ── GET /api/project/settings/list ─────────────────────────
	connection.onGet("/api/project/settings/list", () => ({
		success: true,
		settings: state.settings.settings,
		logs: [],
		errors: [],
	}));

	// ── POST /api/project/settings/set ─────────────────────────
	connection.onPost("/api/project/settings/set", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const key = typeof data.key === "string" ? data.key : "";
		const valueRaw = data.value;
		if (!key) {
			return errorEnvelope("settings/set requires `key`");
		}
		const entry = state.settings.settings[key];
		if (!entry) {
			return errorEnvelope(`Unknown setting: ${key}`);
		}
		const normalized = normalizeIncomingSetting(valueRaw, entry.options);
		entry.value = normalized;
		return {
			success: true,
			result: "OK",
			logs: [`Updated ${key} to ${String(normalized)}`],
			errors: [],
		};
	});

	// ── POST /api/project/save ─────────────────────────────────
	connection.onPost("/api/project/save", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const format = typeof data.format === "string" ? data.format : "";
		if (format !== "xml" && format !== "hip") {
			return errorEnvelope(`save requires format="xml" or "hip"`);
		}
		const filename = typeof data.filename === "string" && data.filename
			? data.filename
			: state.chainId;
		const renamed = filename !== state.chainId;
		const ext = format === "xml" ? "xml" : "hip";
		const path = format === "xml"
			? `XmlPresetBackups/${filename}.${ext}`
			: `Presets/${filename}.${ext}`;
		if (renamed) {
			state.chainId = filename;
			state.tree.projectName = filename;
			// Also reflect rename in the active list entry name (matches HISE behaviour
			// where the master chain rename surfaces in the project list).
			const active = state.list.projects.find((p) => p.name === state.list.active);
			if (active) {
				active.name = filename;
				state.list.active = filename;
			}
		}
		// Ensure file is visible in /files response
		const existing = state.files.files.find((f) => f.path === path);
		const now = new Date().toISOString();
		if (existing) {
			existing.modified = now;
		} else {
			state.files.files.unshift({
				name: `${filename}.${ext}`,
				type: ext as "xml" | "hip",
				path,
				modified: now,
			});
		}
		const response: Record<string, unknown> = {
			success: true,
			path,
			logs: [`Saved as ${filename}.${ext}`],
			errors: [],
		};
		if (renamed) {
			response.masterChainRenamed = true;
			response.newName = filename;
			(response.logs as string[]).push(`Renamed master chain to ${filename}`);
		}
		return response as HiseResponse;
	});

	// ── POST /api/project/load ─────────────────────────────────
	connection.onPost("/api/project/load", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const file = typeof data.file === "string" ? data.file : "";
		if (!file) {
			return errorEnvelope("load requires `file`");
		}
		const found = state.files.files.find((f) => f.path === file || f.name === file);
		if (!found) {
			return errorEnvelope(`File not found: ${file}`, 404);
		}
		return {
			success: true,
			result: "OK",
			logs: [`Loaded ${found.name}`],
			errors: [],
		};
	});

	// ── POST /api/project/switch ───────────────────────────────
	connection.onPost("/api/project/switch", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const projectArg = typeof data.project === "string" ? data.project : "";
		if (!projectArg) {
			return errorEnvelope("switch requires `project`");
		}
		const target = resolveSwitchTarget(state.list.projects, projectArg);
		if (!target) {
			return errorEnvelope(`Unknown project: ${projectArg}`);
		}
		state.list.active = target.name;
		state.tree.projectName = target.name;
		state.chainId = target.name;
		// Reflect in /api/status mock as well
		status.project.name = target.name;
		status.project.projectFolder = target.path;
		status.project.scriptsFolder = `${target.path}/Scripts`;
		return {
			success: true,
			result: "OK",
			logs: [`Switched to ${target.name}`],
			errors: [],
		};
	});

	// ── GET /api/project/export_snippet ────────────────────────
	connection.onGet("/api/project/export_snippet", () => ({
		success: true,
		snippet: state.snippet,
		logs: [],
		errors: [],
	}));

	// ── POST /api/project/import_snippet ───────────────────────
	connection.onPost("/api/project/import_snippet", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const snippet = typeof data.snippet === "string" ? data.snippet : "";
		if (!snippet.startsWith("HiseSnippet ")) {
			return errorEnvelope("import_snippet requires snippet string starting with 'HiseSnippet '");
		}
		state.snippet = snippet;
		return {
			success: true,
			result: "OK",
			logs: ["Imported snippet"],
			errors: [],
		};
	});

	// ── GET /api/project/preprocessor/list ─────────────────────
	connection.onGet("/api/project/preprocessor/list", () => ({
		success: true,
		preprocessors: state.preprocessors.preprocessors,
		logs: [],
		errors: [],
	}));

	// ── POST /api/project/preprocessor/set ─────────────────────
	connection.onPost("/api/project/preprocessor/set", (body) => {
		const data = (body ?? {}) as Record<string, unknown>;
		const os = typeof data.OS === "string" ? data.OS : "";
		const target = typeof data.target === "string" ? data.target : "";
		const name = typeof data.preprocessor === "string" ? data.preprocessor : "";
		const value = typeof data.value === "string" ? data.value : "";
		if (!os || !target || !name || !value) {
			return errorEnvelope("preprocessor/set requires OS, target, preprocessor, value");
		}
		const validOS = ["Windows", "macOS", "Linux", "all"].includes(os);
		const validTarget = ["Project", "Dll", "all"].includes(target);
		if (!validOS) return errorEnvelope(`Invalid OS: ${os}`);
		if (!validTarget) return errorEnvelope(`Invalid target: ${target}`);
		applyPreprocessorSet(state, os, target, name, value);
		return {
			success: true,
			result: "OK",
			logs: value === "default"
				? [`Cleared ${name} for ${target}/${os}`]
				: [`Set ${name}=${value} for ${target}/${os}`],
			errors: [],
		};
	});
}

function resolveSwitchTarget(
	projects: ProjectListEntry[],
	arg: string,
): ProjectListEntry | null {
	// Match by exact path first, then by name
	for (const p of projects) {
		if (p.path === arg) return p;
	}
	for (const p of projects) {
		if (p.name === arg) return p;
	}
	return null;
}

function applyPreprocessorSet(
	state: MockProjectState,
	os: string,
	target: string,
	name: string,
	value: string,
): void {
	const targets = target === "all" ? ["Project", "Dll"] : [target];
	const oses = os === "all" ? ["Windows", "macOS", "Linux"] : [os];
	const scopes = state.preprocessors.preprocessors;

	if (value === "default") {
		// Remove from all matching scopes including "*.*" + "target.*"
		for (const scope of Object.keys(scopes)) {
			const [scopeTarget, scopeOS] = scope.split(".") as [string, string];
			const targetMatch = scopeTarget === "*" || (target === "all" || scopeTarget === target);
			const osMatch = scopeOS === "*" || (os === "all" || scopeOS === os);
			if (targetMatch && osMatch && name in scopes[scope]!) {
				delete scopes[scope]![name];
			}
		}
		// Cleanup empty scopes
		for (const scope of Object.keys(scopes)) {
			if (Object.keys(scopes[scope]!).length === 0) {
				delete scopes[scope];
			}
		}
		return;
	}

	for (const t of targets) {
		for (const o of oses) {
			const scope = `${t}.${o}`;
			if (!scopes[scope]) scopes[scope] = {};
			scopes[scope]![name] = value;
		}
	}
}

function normalizeIncomingSetting(
	value: unknown,
	options?: Array<string | number | boolean>,
): string | number | boolean {
	if (typeof value === "boolean" || typeof value === "number") return value;
	if (typeof value !== "string") return String(value);
	// If options exist and contain booleans, normalize string to bool
	if (options?.some((o) => typeof o === "boolean")) {
		const lower = value.toLowerCase();
		if (lower === "true" || lower === "yes" || lower === "1" || lower === "on") return true;
		if (lower === "false" || lower === "no" || lower === "0" || lower === "off") return false;
	}
	return value;
}

function errorEnvelope(message: string, _status = 400): HiseResponse {
	return {
		success: false,
		result: null,
		logs: [],
		errors: [{ errorMessage: message, callstack: [] }],
	};
}
