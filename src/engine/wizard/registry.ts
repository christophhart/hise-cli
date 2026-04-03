// ── Wizard registry — stores parsed wizard definitions ──────────────

import type { WizardDefinition } from "./types.js";

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
	 * Create a registry from an array of WizardDefinitions (loaded from YAML).
	 */
	static fromDefinitions(defs: WizardDefinition[]): WizardRegistry {
		const registry = new WizardRegistry();
		for (const def of defs) {
			registry.register(def);
		}
		return registry;
	}
}
