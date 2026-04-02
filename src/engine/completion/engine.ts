// ── CompletionEngine — fuzzy matching across static datasets ────────

// Consumes all three static datasets (moduleList, scriptingApi,
// scriptnodeList) and the command registry. Provides mode-aware
// completion candidates with prefix matching + Levenshtein fallback
// for close misses.

import type { CompletionItem, CompletionResult } from "../modes/mode.js";
import type {
	DataLoader,
	ModuleList,
	ScriptingApi,
	ScriptnodeList,
} from "../data.js";
import type { CommandEntry } from "../commands/registry.js";

// ── Levenshtein distance (inline — no external dep for engine) ──────

export function levenshteinDistance(a: string, b: string): number {
	const la = a.length;
	const lb = b.length;
	if (la === 0) return lb;
	if (lb === 0) return la;

	// Single-row DP
	const row = new Array<number>(lb + 1);
	for (let j = 0; j <= lb; j++) row[j] = j;

	for (let i = 1; i <= la; i++) {
		let prev = i - 1;
		row[0] = i;
		for (let j = 1; j <= lb; j++) {
			const cur = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j], row[j - 1]) + 1;
			prev = row[j];
			row[j] = cur;
		}
	}
	return row[lb];
}

// ── Fuzzy match scoring ─────────────────────────────────────────────

export interface ScoredItem {
	item: CompletionItem;
	score: number; // lower is better: 0 = exact, 1 = prefix, 2+ = fuzzy
}

/**
 * Score a candidate against input prefix. Returns null if no match.
 * Scoring:
 *   0 — exact match
 *   1 — case-insensitive prefix match
 *   2 — case-insensitive substring match (contains)
 *   3+ — Levenshtein distance (only if ≤ maxDistance)
 */
export function scoreMatch(
	input: string,
	candidate: string,
	maxDistance = 3,
): number | null {
	const lower = input.toLowerCase();
	const candidateLower = candidate.toLowerCase();

	if (lower === candidateLower) return 0;
	if (candidateLower.startsWith(lower)) return 1;
	if (candidateLower.includes(lower)) return 2;

	// Only compute Levenshtein for short inputs to avoid expensive misses
	if (input.length >= 2) {
		const dist = levenshteinDistance(lower, candidateLower);
		if (dist <= maxDistance) return 2 + dist;
	}

	return null;
}

/**
 * Filter and sort items by fuzzy match score.
 * Returns items sorted best-first (lowest score), capped at limit.
 */
export function fuzzyFilter(
	input: string,
	items: CompletionItem[],
	limit = 20,
): CompletionItem[] {
	if (input === "") return items.slice(0, limit);

	const scored: ScoredItem[] = [];
	for (const item of items) {
		// Match against label, insertText, and detail — take the best score
		let best = scoreMatch(input, item.label);
		if (item.insertText) {
			const s = scoreMatch(input, item.insertText);
			if (s !== null && (best === null || s < best)) best = s;
		}
		if (item.detail) {
			const s = scoreMatch(input, item.detail);
			if (s !== null && (best === null || s < best)) best = s;
		}
		if (best !== null) {
			scored.push({ item, score: best });
		}
	}

	scored.sort((a, b) => {
		if (a.score !== b.score) return a.score - b.score;
		return a.item.label.localeCompare(b.item.label);
	});

	return scored.slice(0, limit).map((s) => s.item);
}

// ── Cached dataset items ────────────────────────────────────────────

export interface CompletionDatasets {
	moduleItems: CompletionItem[];
	moduleParamMap: Map<string, CompletionItem[]>; // moduleId → params
	apiNamespaceItems: CompletionItem[];
	apiMethodMap: Map<string, CompletionItem[]>; // className → methods
	scriptnodeItems: CompletionItem[];
	scriptnodeFactories: CompletionItem[];
	scriptnodeByFactory: Map<string, CompletionItem[]>; // factory → nodes
}

/**
 * Build completion items from raw datasets. Called once at startup,
 * results cached in the CompletionEngine.
 */
export function buildDatasets(
	moduleList: ModuleList | null,
	scriptingApi: ScriptingApi | null,
	scriptnodeList: ScriptnodeList | null,
): CompletionDatasets {
	// ── Modules ──────────────────────────────────────────────────
	const moduleItems: CompletionItem[] = [];
	const moduleParamMap = new Map<string, CompletionItem[]>();

	if (moduleList) {
		for (const m of moduleList.modules) {
			moduleItems.push({
				label: m.prettyName,
				detail: m.id,
			});

			if (m.parameters?.length > 0) {
				const params: CompletionItem[] = m.parameters.map((p) => ({
					label: p.id,
					detail: `${p.range.min}–${p.range.max} (${p.type})`,
				}));
				moduleParamMap.set(m.id, params);
			}
		}
	}

	// ── Scripting API ───────────────────────────────────────────
	const apiNamespaceItems: CompletionItem[] = [];
	const apiMethodMap = new Map<string, CompletionItem[]>();

	if (scriptingApi) {
		for (const [name, cls] of Object.entries(scriptingApi.classes)) {
			// Brief description: first sentence, fall back to category.
			const nsBrief = cls.description
				? cls.description.split(/\.\s/)[0]!.replace(/\.$/, "")
				: cls.category;
			apiNamespaceItems.push({
				label: name,
				detail: nsBrief,
			});

			if (cls.methods.length > 0) {
				const methods: CompletionItem[] = cls.methods.map((m) => {
					// Brief description: first sentence (up to first period).
					const brief = m.description
						? m.description.split(/\.\s/)[0]!.replace(/\.$/, "")
						: "";
					return {
						label: m.name,
						detail: brief,
						insertText: m.parameters.length === 0
							? `${m.name}()`
							: `${m.name}(`,
					};
				});
				apiMethodMap.set(name, methods);
			}
		}
	}

	// ── Scriptnode ──────────────────────────────────────────────
	const scriptnodeItems: CompletionItem[] = [];
	const scriptnodeFactories: CompletionItem[] = [];
	const scriptnodeByFactory = new Map<string, CompletionItem[]>();
	const factorySet = new Set<string>();

	if (scriptnodeList) {
		for (const [fullId, node] of Object.entries(scriptnodeList)) {
			scriptnodeItems.push({
				label: fullId,
				detail: node.type,
			});

			const dotIndex = fullId.indexOf(".");
			if (dotIndex !== -1) {
				const factory = fullId.slice(0, dotIndex);
				const nodeId = fullId.slice(dotIndex + 1);

				factorySet.add(factory);

				const existing = scriptnodeByFactory.get(factory) ?? [];
				existing.push({
					label: nodeId,
					detail: node.type,
					insertText: fullId,
				});
				scriptnodeByFactory.set(factory, existing);
			}
		}

		for (const f of factorySet) {
			const count = scriptnodeByFactory.get(f)?.length ?? 0;
			scriptnodeFactories.push({
				label: f,
				detail: `${count} node${count !== 1 ? "s" : ""}`,
				insertText: `${f}.`,
			});
		}
	}

	return {
		moduleItems,
		moduleParamMap,
		apiNamespaceItems,
		apiMethodMap,
		scriptnodeItems,
		scriptnodeFactories,
		scriptnodeByFactory,
	};
}

// ── Slash command items ─────────────────────────────────────────────

export function buildSlashItems(commands: CommandEntry[]): CompletionItem[] {
	return commands.map((c) => ({
		label: `/${c.name}`,
		detail: c.description,
		insertText: `/${c.name}`,
	}));
}

// ── CompletionEngine class ──────────────────────────────────────────

export class CompletionEngine {
	private datasets: CompletionDatasets | null = null;
	private slashItems: CompletionItem[] = [];
	private loading: Promise<void> | null = null;

	/**
	 * Initialize with data loader. Safe to call multiple times —
	 * second call is a no-op if already loaded.
	 */
	async init(loader: DataLoader): Promise<void> {
		if (this.datasets) return;
		if (this.loading) return this.loading;

		this.loading = (async () => {
			const [moduleList, scriptingApi, scriptnodeList] = await Promise.all([
				loader.loadModuleList().catch(() => null),
				loader.loadScriptingApi().catch(() => null),
				loader.loadScriptnodeList().catch(() => null),
			]);

			this.datasets = buildDatasets(moduleList, scriptingApi, scriptnodeList);
		})();

		return this.loading;
	}

	/** Set slash command items from the registry. */
	setSlashCommands(commands: CommandEntry[]): void {
		this.slashItems = buildSlashItems(commands);
	}

	/** Manual dataset injection (for testing). */
	setDatasets(datasets: CompletionDatasets): void {
		this.datasets = datasets;
	}

	// ── Query methods ───────────────────────────────────────────

	/**
	 * Complete slash commands. Input includes the leading `/`.
	 * Returns completions for the command name portion.
	 */
	completeSlash(input: string): CompletionResult {
		const prefix = input.startsWith("/") ? input : `/${input}`;
		const items = fuzzyFilter(prefix, this.slashItems);
		return { items, from: 0, to: input.length, label: "Slash commands" };
	}

	/**
	 * Complete module type names (for `add <type>` in builder mode).
	 */
	completeModuleType(prefix: string): CompletionItem[] {
		if (!this.datasets) return [];
		return fuzzyFilter(prefix, this.datasets.moduleItems);
	}

	/**
	 * Complete module parameters (for `set <module> <param>` in builder).
	 */
	completeModuleParam(moduleId: string, prefix: string): CompletionItem[] {
		if (!this.datasets) return [];
		const params = this.datasets.moduleParamMap.get(moduleId);
		if (!params) return [];
		return fuzzyFilter(prefix, params);
	}

	/**
	 * Complete scripting API namespaces (top-level identifiers in script mode).
	 * Handles "Namespace.method" dotted access — returns methods after dot.
	 */
	completeScript(input: string): CompletionResult {
		if (!this.datasets) return { items: [], from: 0, to: input.length };

		const dotIndex = input.lastIndexOf(".");
		if (dotIndex !== -1) {
			// After a dot — complete method names
			const ns = input.slice(0, dotIndex);
			const methodPrefix = input.slice(dotIndex + 1);
			const methods = this.datasets.apiMethodMap.get(ns);
			if (methods) {
				const items = fuzzyFilter(methodPrefix, methods);
				return { items, from: dotIndex + 1, to: input.length, label: `${ns} methods` };
			}
			return { items: [], from: dotIndex + 1, to: input.length };
		}

		// Before dot — complete namespace names
		const items = fuzzyFilter(input, this.datasets.apiNamespaceItems);
		return { items, from: 0, to: input.length, label: "API namespaces" };
	}

	/**
	 * Complete scriptnode factory.nodeId (for DSP mode).
	 * Handles "factory." prefix — returns nodes in that factory after dot.
	 */
	completeScriptnode(input: string): CompletionResult {
		if (!this.datasets) return { items: [], from: 0, to: input.length };

		const dotIndex = input.indexOf(".");
		if (dotIndex !== -1) {
			const factory = input.slice(0, dotIndex);
			const nodePrefix = input.slice(dotIndex + 1);
			const nodes = this.datasets.scriptnodeByFactory.get(factory);
			if (nodes) {
				const items = fuzzyFilter(nodePrefix, nodes);
				return { items, from: dotIndex + 1, to: input.length };
			}
			return { items: [], from: dotIndex + 1, to: input.length };
		}

		// Before dot — complete factory names
		const items = fuzzyFilter(input, this.datasets.scriptnodeFactories);
		return { items, from: 0, to: input.length };
	}

	/**
	 * Complete inspect mode subcommands.
	 */
	completeInspect(prefix: string): CompletionItem[] {
		const items: CompletionItem[] = [
			{ label: "version", detail: "Show HISE server version information" },
			{ label: "project", detail: "Show current project information" },
			{ label: "help", detail: "Show inspect mode commands" },
		];
		return fuzzyFilter(prefix, items);
	}

	/**
	 * Complete builder mode keywords at position 0.
	 */
	completeBuilderKeyword(prefix: string): CompletionItem[] {
		const items: CompletionItem[] = [
			{ label: "add", detail: "Add a module to the tree" },
			{ label: "clone", detail: "Duplicate a module" },
			{ label: "remove", detail: "Remove a module" },
			{ label: "move", detail: "Move a module (stub)" },
			{ label: "rename", detail: "Rename a module" },
			{ label: "set", detail: "Set a module parameter" },
			{ label: "load", detail: "Load DSP network into module" },
			{ label: "bypass", detail: "Bypass a module" },
			{ label: "enable", detail: "Enable a bypassed module" },
			{ label: "show", detail: "Show tree, types, or module" },
			{ label: "cd", detail: "Navigate to a processor (cd .., cd /)" },
			{ label: "ls", detail: "List children at current path" },
			{ label: "pwd", detail: "Print current path" },
		];
		return fuzzyFilter(prefix, items);
	}

	/**
	 * Complete "show" subcommands in builder mode.
	 */
	completeBuilderShow(prefix: string): CompletionItem[] {
		const items: CompletionItem[] = [
			{ label: "tree", detail: "Show module tree" },
			{ label: "types", detail: "List available module types" },
		];
		return fuzzyFilter(prefix, items);
	}
}
