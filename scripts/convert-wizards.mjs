// Convert HISE multipage dialog JSONs → wizard YAML definitions.
// Run once: node scripts/convert-wizards.mjs
//
// Reads:  wizards/*.json (HISE C++ format)
// Writes: data/wizards/*.yaml (WizardDefinition format)

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stringify } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const JSON_DIR = join(ROOT, "wizards");
const YAML_DIR = join(ROOT, "data", "wizards");

// ── Inline parser (same logic as src/engine/wizard/parser.ts) ───────
// Duplicated here to avoid ESM/build dependency — this is a one-shot script.

function parseWizardJson(filename, raw) {
	const data = raw;
	const pages = data.Children ?? [];
	const properties = data.Properties ?? {};
	const globalState = data.GlobalState ?? {};

	const globalDefaults = {};
	for (const [key, value] of Object.entries(globalState)) {
		globalDefaults[key] = String(value);
	}

	const tabs = [];
	const allTasks = [];
	let allPostActions = [];

	for (let i = 0; i < pages.length; i++) {
		const page = pages[i];
		const pageChildren = page.Children ?? [];
		const label = deriveTabLabel(page, i);

		const fields = extractFields(pageChildren, globalDefaults);
		if (fields.length > 0) {
			tabs.push({ label, fields });
		}

		const branchTabs = extractBranchTabs(pageChildren, globalDefaults, label);
		tabs.push(...branchTabs);
		allTasks.push(...extractTasks(pageChildren));

		if (i === pages.length - 1) {
			allPostActions = extractPostActions(pageChildren);
		}
	}

	for (const tab of tabs) {
		deduplicateRadioGroups(tab);
	}

	return {
		id: filename,
		header: properties.Header ?? filename,
		subtitle: properties.Subtitle || undefined,
		tabs,
		tasks: allTasks,
		postActions: allPostActions,
		globalDefaults,
	};
}

const DEFAULT_TAB_LABELS = ["Settings", "Execution", "Complete", "Options", "Advanced"];

function deriveTabLabel(page, index) {
	if (page.Text && page.Text.trim().length > 0) return page.Text.trim();
	return DEFAULT_TAB_LABELS[index] ?? `Tab ${index + 1}`;
}

function extractFields(elements, globalDefaults) {
	const fields = [];
	for (const el of elements) {
		const type = el.Type;
		if (type === "TextInput") fields.push(makeTextField(el, globalDefaults));
		else if (type === "FileSelector") fields.push(makeFileField(el, globalDefaults));
		else if (type === "Choice") fields.push(makeChoiceField(el, globalDefaults));
		else if (type === "Button" && isToggleButton(el)) fields.push(makeToggleField(el, globalDefaults));
		else if (type === "List" || type === "Column") {
			if (el.Children) fields.push(...extractFields(el.Children, globalDefaults));
		}
	}
	return fields;
}

function makeTextField(el, defaults) {
	return clean({
		id: el.ID ?? "", type: "text", label: el.Text ?? el.ID ?? "",
		required: el.Required === true, help: el.Help,
		defaultValue: resolveDefault(el, defaults), emptyText: el.EmptyText,
		parseArray: el.ParseArray === true ? true : undefined,
	});
}

function makeFileField(el, defaults) {
	return clean({
		id: el.ID ?? "", type: "file", label: el.Text ?? el.ID ?? "",
		required: el.Required === true, help: el.Help,
		defaultValue: resolveDefault(el, defaults),
		directory: el.Directory === true ? true : undefined,
		wildcard: el.Wildcard, saveFile: el.SaveFile === true ? true : undefined,
	});
}

function makeChoiceField(el, defaults) {
	const items = el.Items ? el.Items.split("\n").filter(s => s.length > 0) : [];
	const valueMode = el.ValueMode === "Text" ? "text" : "index";
	return clean({
		id: el.ID ?? "", type: "choice", label: el.Text ?? el.ID ?? "",
		required: false, help: el.Help, defaultValue: resolveDefault(el, defaults),
		items, valueMode,
	});
}

function makeToggleField(el, defaults) {
	return clean({
		id: el.ID ?? "", type: "toggle", label: el.Text ?? el.ID ?? "",
		required: false, help: el.Help, defaultValue: resolveDefault(el, defaults),
	});
}

function isToggleButton(el) {
	if (el.Trigger === true) return false;
	if (el.ButtonType === "Text") return false;
	return true;
}

function isPostActionButton(el) {
	return el.Trigger === true && el.ButtonType === "Text";
}

function resolveDefault(el, globalDefaults) {
	if (el.UseInitValue && el.InitValue !== undefined) return String(el.InitValue);
	const id = el.ID;
	if (id && id in globalDefaults) return globalDefaults[id];
	return undefined;
}

function extractTasks(elements) {
	const tasks = [];
	for (const el of elements) {
		if (el.Type === "LambdaTask") {
			const fn = el.Function ?? el.ID ?? "task";
			tasks.push({ id: el.ID || fn, function: fn });
		}
		if (el.Children) tasks.push(...extractTasks(el.Children));
	}
	return tasks;
}

function extractPostActions(elements) {
	const actions = [];
	for (const el of elements) {
		if (el.Type === "Button" && isPostActionButton(el)) {
			actions.push(clean({ id: el.ID ?? "", label: el.Text ?? el.ID ?? "", help: el.Help }));
		}
		if (el.Children) actions.push(...extractPostActions(el.Children));
	}
	return actions;
}

function extractBranchTabs(elements, globalDefaults, parentLabel) {
	const tabs = [];
	for (const el of elements) {
		if (el.Type === "Branch" && el.ID && el.Children) {
			for (let i = 0; i < el.Children.length; i++) {
				const branch = el.Children[i];
				const fields = extractFields(branch.Children ?? [], globalDefaults);
				if (fields.length === 0) continue;
				tabs.push({
					label: `${parentLabel} ${i + 1}`,
					fields,
					condition: { fieldId: el.ID, value: String(i) },
				});
			}
		}
		if ((el.Type === "List" || el.Type === "Column") && el.Children) {
			tabs.push(...extractBranchTabs(el.Children, globalDefaults, parentLabel));
		}
	}
	return tabs;
}

function deduplicateRadioGroups(tab) {
	const idCounts = new Map();
	for (const field of tab.fields) {
		idCounts.set(field.id, (idCounts.get(field.id) ?? 0) + 1);
	}
	const duplicateIds = new Set();
	for (const [id, count] of idCounts) {
		if (count > 1) duplicateIds.add(id);
	}
	if (duplicateIds.size === 0) return;

	for (const dupId of duplicateIds) {
		const matching = tab.fields.filter(f => f.id === dupId);
		if (matching.length < 2) continue;
		const items = matching.map(f => f.label);
		const firstField = matching[0];
		const merged = clean({
			id: dupId, type: "choice", label: dupId, required: false,
			help: firstField.help, defaultValue: firstField.defaultValue,
			items, valueMode: "text",
		});
		const firstIndex = tab.fields.indexOf(firstField);
		tab.fields[firstIndex] = merged;
		for (let i = tab.fields.length - 1; i >= 0; i--) {
			if (tab.fields[i].id === dupId && i !== firstIndex) {
				tab.fields.splice(i, 1);
			}
		}
	}
}

/** Remove undefined/null/false values for cleaner YAML output. */
function clean(obj) {
	const result = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined && v !== null && v !== false) {
			result[k] = v;
		}
	}
	return result;
}

// ── Main ────────────────────────────────────────────────────────────

if (!existsSync(YAML_DIR)) mkdirSync(YAML_DIR, { recursive: true });

const SKIP = new Set(["broadcaster.json"]);
const files = readdirSync(JSON_DIR).filter(f => f.endsWith(".json") && !SKIP.has(f));

for (const file of files) {
	const raw = JSON.parse(readFileSync(join(JSON_DIR, file), "utf-8"));
	const id = file.replace(".json", "");
	const def = parseWizardJson(id, raw);
	const yaml = stringify(def, { lineWidth: 120 });
	const outPath = join(YAML_DIR, `${id}.yaml`);
	writeFileSync(outPath, yaml, "utf-8");
	console.log(`  ${file} → ${id}.yaml (${def.tabs.length} tabs, ${def.tabs.reduce((s, t) => s + t.fields.length, 0)} fields)`);
}

console.log(`\nConverted ${files.length} wizards to ${YAML_DIR}`);
