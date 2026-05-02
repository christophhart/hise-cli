// Source-package `project_info.xml` parser. Spec §3.4.
// CLI reads the source package's XML directly (target-side reads/writes go
// through HISE). We only need a flat key->value map plus access to the four
// ExtraDefinitions* slots used for preprocessor lookup.

import { XMLParser } from "fast-xml-parser";
import { decodeXmlEntities } from "./xml.js";

export interface ProjectInfo {
	settings: Record<string, string>;
}

const PARSER = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseAttributeValue: false,
	allowBooleanAttributes: true,
	preserveOrder: false,
});

export function parseProjectInfoXml(xml: string): ProjectInfo {
	const parsed = PARSER.parse(xml) as Record<string, unknown>;
	const root = parsed.ProjectSettings;
	if (!root || typeof root !== "object") {
		throw new Error("project_info.xml: missing <ProjectSettings> root");
	}
	const settings: Record<string, string> = {};
	for (const [key, raw] of Object.entries(root as Record<string, unknown>)) {
		// fast-xml-parser may emit single elements as objects, repeated as arrays.
		// HISE uses each element exactly once, so we expect object form.
		if (Array.isArray(raw)) {
			throw new Error(`project_info.xml: <${key}> appears multiple times`);
		}
		if (raw && typeof raw === "object") {
			const attrs = raw as Record<string, unknown>;
			if (typeof attrs.value === "string") {
				settings[key] = decodeXmlEntities(attrs.value);
			}
		}
	}
	return { settings };
}

const EXTRA_DEFINITIONS_SLOTS = [
	"ExtraDefinitionsWindows",
	"ExtraDefinitionsOSX",
	"ExtraDefinitionsLinux",
	"ExtraDefinitionsNetworkDll",
] as const;

// Look up a preprocessor macro across the four ExtraDefinitions* slots.
// Each slot is a CRLF/LF-separated list of KEY=VALUE lines (per HISE convention).
// Returns the first non-null value found (Windows-first precedence). If the
// macro appears with conflicting values across slots, includes a warning string.
export interface PreprocessorLookup {
	value: string | null;
	warnings: string[];
}

export function lookupSourcePreprocessor(info: ProjectInfo, name: string): PreprocessorLookup {
	const found: Array<{ slot: string; value: string }> = [];
	for (const slot of EXTRA_DEFINITIONS_SLOTS) {
		const slotValue = info.settings[slot];
		if (!slotValue) continue;
		const v = readMacroFromSlot(slotValue, name);
		if (v !== null) found.push({ slot, value: v });
	}
	if (found.length === 0) return { value: null, warnings: [] };
	const first = found[0].value;
	const conflicts = found.filter((f) => f.value !== first);
	const warnings: string[] = [];
	if (conflicts.length > 0) {
		const slotList = found.map((f) => `${f.slot}=${JSON.stringify(f.value)}`).join(", ");
		warnings.push(`Preprocessor ${name} has divergent slot values: ${slotList}; using first (${found[0].slot})`);
	}
	return { value: first, warnings };
}

function readMacroFromSlot(slotValue: string, name: string): string | null {
	for (const rawLine of slotValue.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		if (line.slice(0, eq).trim() === name) {
			return line.slice(eq + 1).trim();
		}
	}
	return null;
}
