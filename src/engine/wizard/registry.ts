// ── Wizard registry — stores parsed wizard definitions ──────────────

import type { WizardDefinition } from "./types.js";
import { parseWizardJson } from "./parser.js";

export class WizardRegistry {
	private readonly definitions = new Map<string, WizardDefinition>();

	register(def: WizardDefinition): void {
		this.definitions.set(def.id, def);
	}

	get(id: string): WizardDefinition | undefined {
		return this.definitions.get(id);
	}

	list(): WizardDefinition[] {
		return [...this.definitions.values()];
	}

	/**
	 * Parse raw wizard JSON objects and register them all.
	 * @param raws - Array of { filename (without .json), data (parsed JSON) }
	 */
	static fromRawData(raws: Array<{ filename: string; data: unknown }>): WizardRegistry {
		const registry = new WizardRegistry();
		for (const { filename, data } of raws) {
			try {
				const def = parseWizardJson(filename, data);
				registry.register(def);
			} catch {
				// Skip wizards that fail to parse (e.g., broadcaster)
			}
		}
		return registry;
	}
}
