// ── Wizard registry — stores parsed wizard definitions ──────────────

import type { WizardDefinition } from "./types.js";

export class WizardRegistry {
	private readonly definitions = new Map<string, WizardDefinition>();
	private readonly aliasMap = new Map<string, WizardDefinition>();

	register(def: WizardDefinition): void {
		this.definitions.set(def.id, def);
		if (def.aliases) {
			for (const alias of def.aliases) {
				this.aliasMap.set(alias, def);
			}
		}
	}

	get(id: string): WizardDefinition | undefined {
		return this.definitions.get(id);
	}

	/** Resolve a slash command input against wizard aliases.
	 *  Matches "setup" for alias "setup", or "project create" for alias "project create".
	 *  Returns the wizard definition and any remaining args after the alias.
	 */
	resolveAlias(input: string): { def: WizardDefinition; args: string } | undefined {
		// Try longest match first (e.g. "project create foo" matches "project create")
		for (const [alias, def] of this.aliasMap) {
			if (input === alias || input.startsWith(alias + " ")) {
				return { def, args: input.slice(alias.length).trim() };
			}
		}
		return undefined;
	}

	/** All registered aliases as [alias, wizardId] pairs. */
	aliases(): Array<[string, string]> {
		return [...this.aliasMap.entries()].map(([alias, def]) => [alias, def.id]);
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
