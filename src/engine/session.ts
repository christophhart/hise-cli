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
import type { WizardRegistry } from "./wizard/registry.js";
import type { WizardHandlerRegistry } from "./wizard/handler-registry.js";

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
	wizardRegistry: WizardRegistry | null = null;
	handlerRegistry: WizardHandlerRegistry | null = null;
	projectName: string | null = null;
	projectFolder: string | null = null;
	loadScriptFile?: (filePath: string) => Promise<string>;
	saveScriptFile?: (filePath: string, content: string) => Promise<void>;
	globScriptFiles?: (pattern: string) => Promise<string[]>;

	/**
	 * Resolve a script file path. Absolute paths pass through.
	 * Relative paths resolve against projectFolder/Scripts/ when HISE
	 * is connected, or are returned unchanged (for node:path.resolve
	 * to handle against CWD in the I/O layer).
	 */
	resolveScriptPath(filePath: string): string {
		// Absolute: Unix /path or Windows D:\path / D:/path
		if (filePath.startsWith("/") || /^[a-zA-Z]:[/\\]/.test(filePath)) {
			return filePath;
		}
		if (this.projectFolder) {
			return this.projectFolder + "/" + filePath;
		}
		return filePath;
	}

	private readonly modeFactories = new Map<string, ModeFactory>();
	private readonly modeCache = new Map<string, Mode>();

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

	// ── Mode instance cache ─────────────────────────────────────────

	getOrCreateMode(modeId: string): Mode {
		let mode = this.modeCache.get(modeId);
		if (!mode) {
			const colonIndex = modeId.indexOf(":");
			const baseId = colonIndex === -1 ? modeId : modeId.slice(0, colonIndex);
			const context = colonIndex === -1 ? undefined : modeId.slice(colonIndex + 1);

			const factory = this.modeFactories.get(baseId);
			if (!factory) {
				throw new Error(`Mode "${baseId}" is not registered`);
			}

			mode = factory(context);
			this.modeCache.set(modeId, mode);
		}
		return mode;
	}

	/** Invalidate all cached mode trees — called after undo operations
	 *  which can affect any domain (builder, ui). */
	invalidateAllTrees(): void {
		for (const mode of this.modeCache.values()) {
			mode.invalidateTree?.();
		}
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

		const factory = this.modeFactories.get(baseId);
		if (!factory) {
			return errorResult(
				`Mode "${baseId}" is not registered. Available modes: ${[...this.modeFactories.keys()].join(", ") || "(none)"}`,
			);
		}

		const mode = this.getOrCreateMode(modeId);
		this.modeStack.push(mode);
		return null;
	}

	// Called by /exit handler via CommandSession interface.
	// If silent is true, returns empty result instead of exit message.
	popMode(silent?: boolean): CommandResult {
		if (this.modeStack.length <= 1) {
			// At root — signal quit
			this.quitRequested = true;
			return textResult("Goodbye.");
		}
		const popped = this.modeStack.pop()!;
		if (silent) {
			return { type: "empty" };
		}
		return textResult(`Exited ${popped.name} mode.`);
	}

	requestQuit(): void {
		this.quitRequested = true;
	}

	get shouldQuit(): boolean {
		return this.quitRequested;
	}

	// ── One-shot execution ──────────────────────────────────────────

	async executeOneShot(modeId: string, input: string): Promise<CommandResult> {
		const activeMode = this.currentMode(); // save reference before push
		const mode = this.getOrCreateMode(modeId);
		this.modeStack.push(mode);
		const result = await mode.parse(input, this);
		this.popMode(true); // Silent pop

		// After undo one-shot, invalidate all cached mode trees and eagerly
		// re-fetch the active mode's tree so getTree() returns fresh data.
		if (modeId === "undo") {
			this.invalidateAllTrees();
			// Re-run ensureTree by triggering a parse-like flow on the active mode
			if (activeMode.onEnter && this.connection) {
				await activeMode.onEnter(this);
			}
		}

		// Tag the result with the mode's accent so the TUI can use it for output borders
		if (result.type !== "empty") {
			result.accent = mode.accent;
		}

		return result;
	}

	// ── Completion ─────────────────────────────────────────────────

	complete(input: string, cursor: number): CompletionResult {
		// Slash commands: check if we're completing mode arguments
		if (input.startsWith("/")) {
			// Pattern: /mode[.context] args
			// If there's a space after the mode name, delegate to that mode's completion
			const spaceIndex = input.indexOf(" ");
			if (spaceIndex > 0) {
				// Extract mode spec (e.g., "builder" or "script" from "/builder add" or "/script Interface")
				const modeSpec = input.slice(1, spaceIndex);
				const args = input.slice(spaceIndex + 1);
				
				// Try to resolve the mode (ignore dots for now, they're for context)
				const dotIndex = modeSpec.indexOf(".");
				const baseModeId = dotIndex === -1 ? modeSpec : modeSpec.slice(0, dotIndex);
				
				// /expect: delegate command part to current mode's completion
				if (baseModeId === "expect") {
					const mode = this.currentMode();
					if (mode.complete) {
						// Only complete the command portion (before " is ")
						const isIdx = args.lastIndexOf(" is ");
						const commandPart = isIdx === -1 ? args : args.slice(0, isIdx);
						const commandCursor = isIdx === -1
							? cursor - (spaceIndex + 1)
							: Math.min(cursor - (spaceIndex + 1), commandPart.length);
						const result = mode.complete(commandPart, commandCursor);
						return {
							items: result.items,
							from: result.from + spaceIndex + 1,
							to: result.to + spaceIndex + 1,
							label: result.label,
						};
					}
				}

				// Check if this mode is registered
				if (this.modeFactories.has(baseModeId)) {
					try {
						const mode = this.getOrCreateMode(baseModeId);
						if (mode.complete) {
							// Delegate to mode's completion with adjusted cursor
							const adjustedCursor = cursor - (spaceIndex + 1);
							const result = mode.complete(args, adjustedCursor);
							// Shift the result positions back to absolute
							return {
								items: result.items,
								from: result.from + spaceIndex + 1,
								to: result.to + spaceIndex + 1,
								label: result.label,
							};
						}
					} catch {
						// Mode not registered, fall through to slash completion
					}
				}
			}
			
			// Normal slash command completion
			if (this.completionEngine) {
				return this.completionEngine.completeSlash(input);
			}
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
