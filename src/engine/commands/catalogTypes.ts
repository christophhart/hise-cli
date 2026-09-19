/** Surface-specific command documentation shared by every frontend. */
export type CommandSurface = "cli" | "tui";
export type CommandSafety = "read-only" | "mutation" | "dangerous" | "unknown";

export interface CatalogRecipe {
	title: string;
	argv?: readonly string[];
	lines?: readonly string[];
	display: string;
	stdin?: string;
}

export interface CatalogCommand {
	id: string;
	mode: string;
	title: string;
	purpose: string;
	tags: readonly string[];
	aliases: readonly string[];
	contexts: readonly string[];
	surfaces: readonly CommandSurface[];
	safety: CommandSafety;
	danger: boolean;
	help: { visibility: string; order: number };
	recipes: Partial<Record<CommandSurface, CatalogRecipe>>;
	examples?: readonly CatalogRecipe[];
	notes?: readonly string[];
}

export interface CatalogMode {
	id: string;
	title: string;
	summary: string;
	/** Compact exact-name inventory injected into mode-specific help. */
	vocabulary?: string;
	invocation: readonly CatalogRecipe[];
	notes: readonly string[];
	antiPatterns: readonly { avoid: string; prefer: string }[];
	quickStart: readonly CatalogRecipe[];
	concepts: readonly { id: string; title: string; body: readonly string[] }[];
	commands: readonly CatalogCommand[];
	types: Record<string, unknown>;
}

export interface CommandCatalog {
	schemaVersion: 3;
	common: Record<string, unknown>;
	modes: readonly CatalogMode[];
}

export function catalogCommands(catalog: CommandCatalog, surface?: CommandSurface): CatalogCommand[] {
	return catalog.modes.flatMap((mode) => mode.commands)
		.filter((command) => !surface || command.surfaces.includes(surface));
}

export function recipeFor(command: CatalogCommand, surface: CommandSurface): CatalogRecipe | undefined {
	return command.surfaces.includes(surface) ? command.recipes[surface] : undefined;
}
