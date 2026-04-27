// ── Project mode response contracts ─────────────────────────────────
//
// Normalizers + canonical types for /api/project/* endpoints.
// Drift between mode_roadmaps/project.md and openapi.json is resolved
// in favour of openapi.json (the C++ implementation):
//   - settings entries carry value/description/options (not flat strings)
//   - preprocessor list is keyed by scope ("*.*", "Project.*", "Project.Windows")
//   - switch takes an absolute path; CLI-side resolves names via /list
//   - save returns masterChainRenamed + newName when filename differs
//
// Contracts are reused by the mock runtime (validates outgoing payloads)
// and the live-parity tests (validates the live HISE response shape).

// ── Project list ────────────────────────────────────────────────────

export interface ProjectListEntry {
	name: string;
	path: string;
}

export interface ProjectListPayload {
	projects: ProjectListEntry[];
	active: string;
}

export function normalizeProjectList(value: unknown): ProjectListPayload {
	const data = asObject(value, "project/list");
	return {
		projects: asArray(data.projects, "project/list.projects").map((entry, i) => {
			const obj = asObject(entry, `project/list.projects[${i}]`);
			return {
				name: asString(obj.name, `project/list.projects[${i}].name`),
				path: asString(obj.path, `project/list.projects[${i}].path`),
			};
		}),
		active: asString(data.active, "project/list.active"),
	};
}

// ── Project tree ────────────────────────────────────────────────────

export interface ProjectTreeFile {
	name: string;
	type: "file";
	referenced: boolean;
}

export interface ProjectTreeFolder {
	name: string;
	type: "folder";
	children: ProjectTreeNode[];
}

export type ProjectTreeNode = ProjectTreeFile | ProjectTreeFolder;

export interface ProjectTreePayload {
	projectName: string;
	root: ProjectTreeFolder;
}

export function normalizeProjectTree(value: unknown): ProjectTreePayload {
	const data = asObject(value, "project/tree");
	return {
		projectName: asString(data.projectName, "project/tree.projectName"),
		root: normalizeProjectTreeFolder(data.root, "project/tree.root"),
	};
}

function normalizeProjectTreeNode(value: unknown, label: string): ProjectTreeNode {
	const data = asObject(value, label);
	const type = asString(data.type, `${label}.type`);
	if (type === "file") {
		return {
			name: asString(data.name, `${label}.name`),
			type: "file",
			referenced: asBoolean(data.referenced, `${label}.referenced`),
		};
	}
	if (type === "folder") {
		return normalizeProjectTreeFolder(data, label);
	}
	throw new Error(`${label}.type must be "file" or "folder", got "${type}"`);
}

function normalizeProjectTreeFolder(value: unknown, label: string): ProjectTreeFolder {
	const data = asObject(value, label);
	return {
		name: asString(data.name, `${label}.name`),
		type: "folder",
		children: asArray(data.children, `${label}.children`).map((child, i) =>
			normalizeProjectTreeNode(child, `${label}.children[${i}]`),
		),
	};
}

// ── Project files ───────────────────────────────────────────────────

export interface ProjectFileEntry {
	name: string;
	type: "xml" | "hip";
	path: string;
	modified: string;
}

export interface ProjectFilesPayload {
	files: ProjectFileEntry[];
}

export function normalizeProjectFiles(value: unknown): ProjectFilesPayload {
	const data = asObject(value, "project/files");
	return {
		files: asArray(data.files, "project/files.files").map((entry, i) => {
			const obj = asObject(entry, `project/files.files[${i}]`);
			const type = asString(obj.type, `project/files.files[${i}].type`);
			if (type !== "xml" && type !== "hip") {
				throw new Error(`project/files.files[${i}].type must be "xml" or "hip", got "${type}"`);
			}
			return {
				name: asString(obj.name, `project/files.files[${i}].name`),
				type,
				path: asString(obj.path, `project/files.files[${i}].path`),
				modified: asString(obj.modified, `project/files.files[${i}].modified`),
			};
		}),
	};
}

// ── Project settings ────────────────────────────────────────────────

export type ProjectSettingValue = string | number | boolean;

export interface ProjectSettingEntry {
	value: ProjectSettingValue;
	description: string;
	options?: ProjectSettingValue[];
}

export interface ProjectSettingsPayload {
	settings: Record<string, ProjectSettingEntry>;
}

export function normalizeProjectSettings(value: unknown): ProjectSettingsPayload {
	const data = asObject(value, "project/settings");
	const settings = asObject(data.settings, "project/settings.settings");
	const out: Record<string, ProjectSettingEntry> = {};
	for (const [key, entry] of Object.entries(settings)) {
		const obj = asObject(entry, `project/settings.settings.${key}`);
		const settingValue = normalizeSettingValue(obj.value, `project/settings.settings.${key}.value`);
		const description = asString(obj.description, `project/settings.settings.${key}.description`);
		const result: ProjectSettingEntry = { value: settingValue, description };
		if (obj.options !== undefined) {
			if (!Array.isArray(obj.options)) {
				throw new Error(`project/settings.settings.${key}.options must be an array`);
			}
			result.options = obj.options.map((opt, i) =>
				normalizeSettingValue(opt, `project/settings.settings.${key}.options[${i}]`),
			);
		}
		out[key] = result;
	}
	return { settings: out };
}

function normalizeSettingValue(value: unknown, label: string): ProjectSettingValue {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	throw new Error(`${label} must be a string, number, or boolean`);
}

// ── Project preprocessors ───────────────────────────────────────────

export type PreprocessorOS = "Windows" | "macOS" | "Linux";
export type PreprocessorTarget = "Project" | "Dll";

/** Scope keys: "*.*", "Project.*", "Dll.*", "Project.Windows", etc. */
export type PreprocessorScope = string;

export interface PreprocessorListPayload {
	preprocessors: Record<PreprocessorScope, Record<string, string>>;
}

export function normalizePreprocessorList(value: unknown): PreprocessorListPayload {
	const data = asObject(value, "project/preprocessor/list");
	const scopes = asObject(data.preprocessors, "project/preprocessor/list.preprocessors");
	const out: Record<string, Record<string, string>> = {};
	for (const [scope, macros] of Object.entries(scopes)) {
		const macroObj = asObject(macros, `project/preprocessor/list.preprocessors.${scope}`);
		const macroOut: Record<string, string> = {};
		for (const [name, val] of Object.entries(macroObj)) {
			// HISE returns ints raw; coerce to string for canonical contract
			macroOut[name] = String(val);
		}
		out[scope] = macroOut;
	}
	return { preprocessors: out };
}

// ── Project snippet ─────────────────────────────────────────────────

export interface ProjectSnippetPayload {
	snippet: string;
}

export function normalizeProjectSnippet(value: unknown): ProjectSnippetPayload {
	const data = asObject(value, "project/snippet");
	return {
		snippet: asString(data.snippet, "project/snippet.snippet"),
	};
}

// ── Project save result ─────────────────────────────────────────────

export interface ProjectSavePayload {
	path: string;
	masterChainRenamed?: boolean;
	newName?: string;
}

export function normalizeProjectSave(value: unknown): ProjectSavePayload {
	const data = asObject(value, "project/save");
	const result: ProjectSavePayload = {
		path: asString(data.path, "project/save.path"),
	};
	if (data.masterChainRenamed !== undefined) {
		result.masterChainRenamed = asBoolean(data.masterChainRenamed, "project/save.masterChainRenamed");
	}
	if (data.newName !== undefined) {
		result.newName = asString(data.newName, "project/save.newName");
	}
	return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

function asObject(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`${label} must be a string`);
	}
	return value;
}

function asBoolean(value: unknown, label: string): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const lower = value.toLowerCase();
		if (lower === "true" || lower === "yes" || lower === "1") return true;
		if (lower === "false" || lower === "no" || lower === "0" || lower === "") return false;
	}
	if (typeof value === "number") return value !== 0;
	throw new Error(`${label} must be a boolean`);
}
