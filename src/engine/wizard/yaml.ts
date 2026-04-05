// ── Wizard YAML — 1:1 serialization of WizardDefinition ─────────────
//
// The YAML format maps directly to the WizardDefinition type.
// No transformation — just parse/stringify with the yaml library.
// Tasks without an explicit `type` are normalized to "http" for backward compat.

import { stringify, parse } from "yaml";
import type { WizardDefinition } from "./types.js";

/** Serialize a WizardDefinition to YAML string. */
export function wizardToYaml(def: WizardDefinition): string {
	return stringify(def, { lineWidth: 120 });
}

/** Deserialize a YAML string to WizardDefinition. */
export function yamlToWizard(yamlStr: string): WizardDefinition {
	const raw = parse(yamlStr) as WizardDefinition;
	return normalizeDefinition(raw);
}

/** Ensure tasks have an explicit type (defaults to "http" for HISE wizards). */
function normalizeDefinition(def: WizardDefinition): WizardDefinition {
	const needsNormalization = def.tasks.some((t) => !t.type);
	if (!needsNormalization) return def;
	return {
		...def,
		tasks: def.tasks.map((t) => (t.type ? t : { ...t, type: "http" as const })),
	};
}
