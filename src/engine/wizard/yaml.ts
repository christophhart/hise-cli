// ── Wizard YAML — 1:1 serialization of WizardDefinition ─────────────
//
// The YAML format maps directly to the WizardDefinition type.
// No transformation — just parse/stringify with the yaml library.

import { stringify, parse } from "yaml";
import type { WizardDefinition } from "./types.js";

/** Serialize a WizardDefinition to YAML string. */
export function wizardToYaml(def: WizardDefinition): string {
	return stringify(def, { lineWidth: 120 });
}

/** Deserialize a YAML string to WizardDefinition. */
export function yamlToWizard(yamlStr: string): WizardDefinition {
	return parse(yamlStr) as WizardDefinition;
}
