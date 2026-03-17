// ── Session — core state container ──────────────────────────────────

// Both TUI and CLI frontends consume Session. Class with thin methods
// delegating to pure functions for testability.

import type { HiseConnection } from "./hise.js";
import type { CommandResult } from "./result.js";
import { errorResult, textResult } from "./result.js";
import type { CompletionResult, Mode, SessionContext } from "./modes/mode.js";
import { RootMode } from "./modes/root.js";
import {
	CommandRegistry,
	type CommandSession,
} from "./commands/registry.js";
import { registerBuiltinCommands } from "./commands/slash.js";
import type { CompletionEngine } from "./completion/engine.js";

// ── Mode factory registry ───────────────────────────────────────────

// Maps mode identifiers (e.g. "script", "script:Interface") to factory
// functions that create Mode instances. Session uses this to instantiate
// modes when pushMode is called from slash command handlers.

export type ModeFactory = (context: string | undefined) => Mode;

// ── Session class ───────────────────────────────────────────────────

export class Session implements SessionContext, CommandSession {
	readonly modeStack: Mode[];
	readonly history: string[] = [];
	readonly connection: HiseConnection | null;
	readonly registry: CommandRegistry;
	readonly completionEngine: CompletionEngine | null;
	projectName: string | null = null;

	private readonly modeFactories = new Map<string, ModeFactory>();

	// Signal for TUI to handle quit
	private quitRequested = false;

	constructor(
		connection: HiseConnection | null = null,
		completionEngine?: CompletionEngine,
	) {
		this.connection = connection;
		this.completionEngine = completionEngine ?? null;
		this.modeStack = [new RootMode()];
		this.registry = new CommandRegistry();
		registerBuiltinCommands(this.registry);

		// Feed slash commands into the completion engine
		if (this.completionEngine) {
			this.completionEngine.setSlashCommands(this.registry.all());
		}
	}

	// ── Mode factory registration ───────────────────────────────────

	registerMode(id: string, factory: ModeFactory): void {
		this.modeFactories.set(id, factory);
	}

	// ── Mode stack ──────────────────────────────────────────────────

	currentMode(): Mode {
		return this.modeStack[this.modeStack.length - 1];
	}

	get modeStackDepth(): number {
		// Root mode doesn't count
		return this.modeStack.length - 1;
	}

	get currentModeId(): string {
		return this.currentMode().id;
	}

	allCommands(): import("./commands/registry.js").CommandEntry[] {
		return this.registry.all();
	}

	// Called by slash command handlers via CommandSession interface.
	// Returns null on success, or a CommandResult error.
	pushMode(modeId: string): CommandResult | null {
		const colonIndex = modeId.indexOf(":");
		const baseId = colonIndex === -1 ? modeId : modeId.slice(0, colonIndex);
		const context = colonIndex === -1 ? undefined : modeId.slice(colonIndex + 1);

		const factory = this.modeFactories.get(baseId);
		if (!factory) {
			return errorResult(
				`Mode "${baseId}" is not registered. Available modes: ${[...this.modeFactories.keys()].join(", ") || "(none)"}`,
			);
		}

		const mode = factory(context);
		this.modeStack.push(mode);
		return null;
	}

	// Called by /exit handler via CommandSession interface.
	popMode(): CommandResult {
		if (this.modeStack.length <= 1) {
			// At root — signal quit
			this.quitRequested = true;
			return textResult("Goodbye.");
		}
		const popped = this.modeStack.pop()!;
		return textResult(`Exited ${popped.name} mode.`);
	}

	requestQuit(): void {
		this.quitRequested = true;
	}

	get shouldQuit(): boolean {
		return this.quitRequested;
	}

	// ── Completion ─────────────────────────────────────────────────

	complete(input: string, cursor: number): CompletionResult {
		// Slash commands always go to the engine's slash completion
		if (input.startsWith("/") && this.completionEngine) {
			return this.completionEngine.completeSlash(input);
		}

		// Delegate to current mode's complete() if available
		const mode = this.currentMode();
		if (mode.complete) {
			return mode.complete(input, cursor);
		}

		return { items: [], from: 0, to: input.length };
	}

	// ── Input dispatch ──────────────────────────────────────────────

	async handleInput(raw: string): Promise<CommandResult> {
		const trimmed = raw.trim();
		if (trimmed === "") {
			return { type: "empty" };
		}

		// Record in history (deduplicate consecutive duplicates)
		if (
			this.history.length === 0 ||
			this.history[this.history.length - 1] !== trimmed
		) {
			this.history.push(trimmed);
		}

		// Slash commands are always dispatched to the registry
		if (trimmed.startsWith("/")) {
			return this.registry.dispatch(trimmed, this);
		}

		// Everything else goes to the current mode's parser
		return this.currentMode().parse(trimmed, this);
	}
}
