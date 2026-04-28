// ── /project mode formatters ────────────────────────────────────────
//
// Pure functions: take normalized contract payloads, return CommandResult.
// Reused by both the engine mode and the live-parity tests so that
// formatter parity can be asserted without re-implementing rendering.

import type { CommandResult, TreeNode } from "../result.js";
import { errorResult, markdownResult, preformattedResult, textResult } from "../result.js";
import { renderTreeBox } from "./builder-ops.js";
import type {
	PreprocessorListPayload,
	ProjectFilesPayload,
	ProjectListPayload,
	ProjectSavePayload,
	ProjectSettingsPayload,
	ProjectTreePayload,
} from "../../mock/contracts/project.js";
import type { StatusPayload } from "../../mock/contracts/status.js";

export function formatInfo(
	status: StatusPayload | null,
	activeIsSnippetBrowser: boolean | null,
): CommandResult {
	if (!status) {
		return errorResult("Project info unavailable — HISE status response missing.");
	}
	const lines = [
		"## Project Info",
		"",
		"| Field | Value |",
		"|-------|-------|",
		`| Name | ${status.project.name} |`,
		`| Project Folder | \`${status.project.projectFolder}\` |`,
		`| Scripts Folder | \`${status.project.scriptsFolder}\` |`,
	];
	if (activeIsSnippetBrowser) {
		lines.push("");
		lines.push("> ⚠ Snippet browser is active — `/project` commands will return 409 until you exit it.");
	}
	return markdownResult(lines.join("\n"));
}

export function formatProjects(payload: ProjectListPayload): CommandResult {
	const headerLines = [
		"## Projects",
		"",
		"| Active | Name | Path |",
		"|:------:|------|------|",
	];
	const rows = payload.projects.map((p) => {
		const marker = p.name === payload.active ? "●" : "";
		return `| ${marker} | ${p.name} | \`${p.path}\` |`;
	});
	return markdownResult([...headerLines, ...rows].join("\n"));
}

export function formatFiles(payload: ProjectFilesPayload): CommandResult {
	if (payload.files.length === 0) {
		return textResult("No saveable files yet.");
	}
	const lines = [
		"## Project Files",
		"",
		"| Name | Type | Path | Modified |",
		"|------|:----:|------|----------|",
	];
	for (const f of payload.files) {
		lines.push(`| ${f.name} | ${f.type} | \`${f.path}\` | ${f.modified} |`);
	}
	return markdownResult(lines.join("\n"));
}

export function formatSettings(payload: ProjectSettingsPayload): CommandResult {
	const entries = Object.entries(payload.settings);
	if (entries.length === 0) {
		return textResult("No settings.");
	}
	const lines = [
		"## Project Settings",
		"",
		"| Key | Value | Options |",
		"|-----|-------|---------|",
	];
	for (const [key, entry] of entries) {
		const opts = entry.options ? entry.options.map((o) => String(o)).join(", ") : "";
		const valueStr = formatSettingValue(entry.value);
		lines.push(`| ${key} | ${valueStr} | ${opts} |`);
	}
	lines.push("");
	lines.push("Use `describe <key>` for the full description.");
	return markdownResult(lines.join("\n"));
}

export function formatDescribeSetting(
	key: string,
	payload: ProjectSettingsPayload,
): CommandResult {
	const entry = payload.settings[key];
	if (!entry) {
		return errorResult(`Unknown setting: "${key}". Use \`show settings\` for the full list.`);
	}
	const lines = [
		`## ${key}`,
		"",
		`**Current value:** ${formatSettingValue(entry.value)}`,
	];
	if (entry.options && entry.options.length > 0) {
		lines.push("");
		lines.push(`**Options:** ${entry.options.map((o) => `\`${String(o)}\``).join(", ")}`);
	}
	if (entry.description) {
		lines.push("");
		lines.push(entry.description);
	}
	return markdownResult(lines.join("\n"));
}

function formatSettingValue(value: string | number | boolean): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string" && value === "") return "—";
	return String(value);
}

export function formatPreprocessors(
	payload: PreprocessorListPayload,
	osFilter: string,
	targetFilter: string,
): CommandResult {
	const scopes = Object.entries(payload.preprocessors);
	const lines = ["## Preprocessor Definitions"];
	const filterParts: string[] = [];
	if (targetFilter !== "all") filterParts.push(`target=${targetFilter}`);
	if (osFilter !== "all") filterParts.push(`os=${osFilter}`);
	if (filterParts.length > 0) {
		lines.push("");
		lines.push(`Filter: ${filterParts.join(", ")}`);
	}
	if (scopes.length === 0) {
		lines.push("");
		lines.push("(none)");
		return markdownResult(lines.join("\n"));
	}
	const scopeOrder = scopes.sort((a, b) => sortScope(a[0]) - sortScope(b[0]));
	for (const [scope, macros] of scopeOrder) {
		const macroEntries = Object.entries(macros);
		if (macroEntries.length === 0) continue;
		lines.push("");
		lines.push(`### ${scope}`);
		lines.push("");
		lines.push("| Macro | Value |");
		lines.push("|-------|-------|");
		for (const [name, value] of macroEntries.sort()) {
			lines.push(`| ${name} | ${value} |`);
		}
	}
	return markdownResult(lines.join("\n"));
}

function sortScope(scope: string): number {
	if (scope === "*.*") return 0;
	if (scope.endsWith(".*")) return 1;
	return 2;
}

export function formatProjectTree(payload: ProjectTreePayload): CommandResult {
	return preformattedResult(renderTreeBox(buildTreeNode(payload.root)), undefined, true);
}

export function buildTreeNode(
	node: ProjectTreePayload["root"] | ProjectTreePayload["root"]["children"][number],
	pathPrefix = "",
): TreeNode {
	if (node.type === "folder") {
		const id = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;
		return {
			label: node.name,
			id,
			nodeKind: "chain",
			children: node.children.map((c) => buildTreeNode(c, id)),
		};
	}
	const id = pathPrefix ? `${pathPrefix}/${node.name}` : node.name;
	return {
		label: node.name,
		id,
		nodeKind: "module",
		dimmed: !node.referenced,
	};
}

export function formatSaveResult(payload: ProjectSavePayload): CommandResult {
	const lines = [
		`Saved \`${payload.path}\``,
	];
	if (payload.masterChainRenamed) {
		lines.push("");
		lines.push(`> Master chain renamed to **${payload.newName ?? "(unknown)"}**.`);
	}
	return markdownResult(lines.join("\n"));
}
