// ── Built-in slash command handlers ──────────────────────────────────

import type { CommandResult } from "../result.js";
import {
	emptyResult,
	errorResult,
	tableResult,
	textResult,
	wizardResult,
} from "../result.js";
import { MODE_ACCENTS, type ModeId } from "../modes/mode.js";
import type { CommandHandler, CommandRegistry, CommandSession } from "./registry.js";
import { generateHelp } from "./help.js";
import type { WizardAnswers } from "../wizard/types.js";

// ── Handler implementations ─────────────────────────────────────────

async function handleExit(
	_args: string,
	session: CommandSession,
): Promise<CommandResult> {
	return session.popMode();
}

async function handleQuit(
	_args: string,
	session: CommandSession,
): Promise<CommandResult> {
	// Force quit regardless of mode stack depth
	session.requestQuit();
	return textResult("Goodbye.");
}

async function handleHelp(
	_args: string,
	session: CommandSession,
): Promise<CommandResult> {
	const modeId = session.currentModeId as ModeId;
	const commands = session.allCommands();
	const help = generateHelp(modeId, commands);

	const result = textResult(help.content);
	result.accent = modeId === "root" ? "#90FFB1" : MODE_ACCENTS[modeId];
	return result;
}

async function handleClear(
	_args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	return emptyResult();
}

async function handleModes(
	_args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	const modeInfo: Array<[string, string, string]> = [
		["builder", "Module tree", MODE_ACCENTS.builder],
		["script", "HiseScript REPL", MODE_ACCENTS.script],
		["dsp", "Scriptnode DSP", MODE_ACCENTS.dsp],
		["sampler", "Sample maps", MODE_ACCENTS.sampler],
		["inspect", "Runtime monitor", MODE_ACCENTS.inspect],
		["project", "Project settings", MODE_ACCENTS.project],
		["compile", "Build targets", MODE_ACCENTS.compile],
		["undo", "Undo history & plan groups", MODE_ACCENTS.undo],
	];

	return tableResult(
		["Mode", "Description", "Color"],
		modeInfo.map(([name, desc, color]) => [name, desc, color]),
	);
}

function createModeHandler(modeId: ModeId): CommandHandler {
	const handler: CommandHandler = async (args, session) => {
		// Parse args: [.context] [command]
		// - /builder → enter mode
		// - /builder.SineGenerator → enter mode with context
		// - /builder add SimpleGain → one-shot execution
		// - /builder.SineGenerator add LFO → one-shot with context
		
		let context: string | undefined;
		let commandInput: string | undefined;
		
		if (args.startsWith(".")) {
			// Dot-notation: extract context path
			const spaceIndex = args.indexOf(" ");
			if (spaceIndex === -1) {
				// Just context, no command: /builder.SineGenerator
				context = args.slice(1);
			} else {
				// Context + command: /builder.SineGenerator add LFO
				context = args.slice(1, spaceIndex);
				commandInput = args.slice(spaceIndex + 1).trim();
			}
		} else if (args) {
			// No dot prefix → one-shot command
			commandInput = args;
		}
		
		// Determine execution mode
		if (commandInput) {
			// One-shot execution
			const mode = session.getOrCreateMode(modeId);
			
			// Set context if provided
			if (context && mode.setContext) {
				mode.setContext(context);
			}
			
			// Execute one-shot
			return session.executeOneShot(modeId, commandInput);
		} else {
			// Enter mode (with optional context)
			const mode = session.getOrCreateMode(modeId);

			// Set context if provided
			if (context && mode.setContext) {
				mode.setContext(context);
			}

			// If already in this mode, don't push again
			if (session.currentModeId === modeId) {
				const label = context ? `${modeId}.${context}` : modeId;
				const result = textResult(`Already in ${label} mode.`);
				result.accent = mode.accent;
				return result;
			}

			// Push mode onto stack
			const pushResult = session.pushMode(modeId);
			if (pushResult) return pushResult;

			// Fetch initial data (tree, history) so sidebar shows content immediately
			if (mode.onEnter) {
				await mode.onEnter({ connection: session.connection, popMode: () => session.popMode() });
			}

			const label = context ? `${modeId}.${context}` : modeId;
			const result = textResult(`Entered ${label} mode.`);
			// Tag with target mode's accent for output border
			result.accent = mode.accent;
			return result;
		}
	};
	return handler;
}

async function handleExpand(
	args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	const pattern = args.trim() || "*";
	// Actual expand is handled by the TUI layer (app.tsx) which
	// intercepts this command and delegates to TreeSidebar.
	return textResult(`Expanded: ${pattern}`);
}

async function handleCollapse(
	args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	const pattern = args.trim() || "*";
	// Actual collapse is handled by the TUI layer (app.tsx).
	return textResult(`Collapsed: ${pattern}`);
}

// ── Wizard command ──────────────────────────────────────────────────

/**
 * Parse pre-fill arguments from a wizard command line.
 * E.g., "target:standalone format:vst" → { target: "standalone", format: "vst" }
 */
function parseWizardPrefill(args: string): { prefill: WizardAnswers; flags: Set<string>; remaining: string } {
	const prefill: WizardAnswers = {};
	const flags = new Set<string>();
	const remaining: string[] = [];

	for (const token of args.split(/\s+/).filter(Boolean)) {
		if (token.startsWith("--")) {
			flags.add(token.slice(2));
		} else if (token.includes(":")) {
			const colonIdx = token.indexOf(":");
			const key = token.slice(0, colonIdx);
			const value = token.slice(colonIdx + 1);
			if (key) prefill[key] = value;
		} else {
			remaining.push(token);
		}
	}

	return { prefill, flags, remaining: remaining.join(" ") };
}

async function handleWizard(
	args: string,
	session: CommandSession,
): Promise<CommandResult> {
	const registry = session.wizardRegistry;
	if (!registry) {
		return errorResult("No wizard definitions loaded.");
	}

	const trimmed = args.trim();

	// /wizard or /wizard list → list available wizards
	if (!trimmed || trimmed === "list") {
		const wizards = registry.list();
		if (wizards.length === 0) {
			return textResult("No wizards available.");
		}
		return tableResult(
			["ID", "Name"],
			wizards.map((w) => [w.id, w.header]),
		);
	}

	// Split: first token is wizard ID, rest is args
	const spaceIdx = trimmed.indexOf(" ");
	const wizardId = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const wizardArgs = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

	const def = registry.get(wizardId);
	if (!def) {
		// Try fuzzy match
		const all = registry.list();
		const match = all.find((w) => w.id.startsWith(wizardId));
		if (match) {
			return handleWizardWithDef(match, wizardArgs, session);
		}
		return errorResult(`Unknown wizard: "${wizardId}". Use /wizard list to see available wizards.`);
	}

	return handleWizardWithDef(def, wizardArgs, session);
}

async function handleWizardWithDef(
	def: import("../wizard/types.js").WizardDefinition,
	args: string,
	session: CommandSession,
): Promise<CommandResult> {
	const { prefill, flags } = parseWizardPrefill(args);

	// --schema: output field schema as JSON
	if (flags.has("schema")) {
		const fields = def.tabs.flatMap((t) =>
			t.fields.map((f) => ({
				id: f.id,
				type: f.type,
				label: f.label,
				required: f.required,
				items: f.items,
				defaultValue: f.defaultValue,
			})),
		);
		return textResult(JSON.stringify({ id: def.id, header: def.header, fields }, null, 2));
	}

	// --run: execute directly without form
	if (flags.has("run")) {
		const { WizardExecutor } = await import("../wizard/executor.js");
		const { mergeInitDefaults } = await import("../wizard/types.js");
		const executor = new WizardExecutor({
			connection: session.connection,
			handlerRegistry: session.handlerRegistry,
		});

		// Run init to fetch defaults, then merge with definition defaults and prefill
		const initDefaults = await executor.initialize(def);
		const mergedDef = mergeInitDefaults(def, initDefaults);

		const answers: WizardAnswers = { ...mergedDef.globalDefaults };
		for (const tab of mergedDef.tabs) {
			for (const field of tab.fields) {
				if (field.defaultValue !== undefined) {
					answers[field.id] = field.defaultValue;
				}
			}
		}
		Object.assign(answers, prefill);

		// Validate and execute
		const { validateAnswers } = await import("../wizard/validator.js");
		const validation = validateAnswers(mergedDef, answers);
		if (!validation.valid) {
			const messages = validation.errors.map((e) => `  ${e.fieldId}: ${e.message}`).join("\n");
			return errorResult(`Validation failed:\n${messages}`);
		}

		const hasHttpTasks = mergedDef.tasks.some((t) => t.type === "http");
		if (hasHttpTasks && !session.connection) {
			return errorResult("No HISE connection — cannot execute HTTP wizard tasks.");
		}

		const result = await executor.execute(mergedDef, answers);
		if (result.success) {
			return textResult(result.message);
		}
		return errorResult(result.message);
	}

	// Default: return wizard result to open the form in TUI
	return wizardResult(def, prefill);
}

const VALID_DENSITIES = ["auto", "compact", "standard", "spacious"];

async function handleDensity(
	args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	const arg = args.trim().toLowerCase();
	if (arg && !VALID_DENSITIES.includes(arg)) {
		return errorResult(
			`Unknown density "${arg}". Valid options: ${VALID_DENSITIES.join(", ")}`,
		);
	}
	// The actual density change is handled by the TUI layer (app.tsx)
	// which intercepts this command's input. The engine returns a
	// placeholder text that the TUI will replace with the actual state.
	return textResult(`Density: ${arg || "auto"}`);
}

// ── Registration ────────────────────────────────────────────────────

// ── Connect command ──────────────────────────────────────────────────

async function handleConnect(
	_args: string,
	session: CommandSession,
): Promise<CommandResult> {
	if (!session.connection) {
		return errorResult("No connection configured.");
	}
	const alive = await session.connection.probe();
	if (alive) {
		return textResult("Connected to HISE on localhost:1900.");
	}
	return errorResult("HISE not responding on localhost:1900. Start HISE and try again.");
}

export function registerBuiltinCommands(registry: CommandRegistry): void {
	registry.register({
		name: "exit",
		description: "Exit current mode (or quit at root)",
		handler: handleExit,
		kind: "command",
	});

	registry.register({
		name: "quit",
		description: "Quit the application",
		handler: handleQuit,
		kind: "command",
	});

	registry.register({
		name: "help",
		description: "Show available commands and help topics",
		handler: handleHelp,
		kind: "command",
	});

	registry.register({
		name: "clear",
		description: "Clear the output",
		handler: handleClear,
		kind: "command",
		surfaces: ["tui"],
	});

	registry.register({
		name: "modes",
		description: "List available modes",
		handler: handleModes,
		kind: "command",
	});

	registry.register({
		name: "builder",
		description: "Enter builder mode (module tree)",
		handler: createModeHandler("builder"),
		kind: "mode",
	});

	registry.register({
		name: "script",
		description: "Enter script mode (HiseScript REPL)",
		handler: createModeHandler("script"),
		kind: "mode",
	});

	registry.register({
		name: "dsp",
		description: "Enter DSP mode (scriptnode)",
		handler: createModeHandler("dsp"),
		kind: "mode",
	});

	registry.register({
		name: "sampler",
		description: "Enter sampler mode",
		handler: createModeHandler("sampler"),
		kind: "mode",
	});

	registry.register({
		name: "inspect",
		description: "Enter inspect mode (runtime monitor)",
		handler: createModeHandler("inspect"),
		kind: "mode",
	});

	registry.register({
		name: "project",
		description: "Enter project mode (settings)",
		handler: createModeHandler("project"),
		kind: "mode",
	});

	registry.register({
		name: "compile",
		description: "Enter compile mode (build targets)",
		handler: createModeHandler("compile"),
		kind: "mode",
	});

	registry.register({
		name: "undo",
		description: "Enter undo mode (history & plan groups)",
		handler: createModeHandler("undo"),
		kind: "mode",
	});

	registry.register({
		name: "ui",
		description: "Enter UI mode (component CRUD & layout)",
		handler: createModeHandler("ui"),
		kind: "mode",
	});

	registry.register({
		name: "connect",
		description: "Check HISE connection status",
		handler: handleConnect,
		kind: "command",
		surfaces: ["tui"],
	});

	registry.register({
		name: "wizard",
		description: "Run a wizard (list, <name>, <name> --schema, <name> --run)",
		handler: handleWizard,
		kind: "command",
	});

	registry.register({
		name: "density",
		description: "Set layout density (auto/compact/standard/spacious)",
		handler: handleDensity,
		kind: "command",
		surfaces: ["tui"],
	});

	registry.register({
		name: "expand",
		description: "Expand tree sidebar nodes (wildcard pattern, default: *)",
		handler: handleExpand,
		kind: "command",
		surfaces: ["tui"],
	});

	registry.register({
		name: "collapse",
		description: "Collapse tree sidebar nodes (wildcard pattern, default: *)",
		handler: handleCollapse,
		kind: "command",
		surfaces: ["tui"],
	});

	registry.register({
		name: "compact",
		description: "Toggle compact tree view (hide chains, show modules only)",
		handler: async (_args, _session) => textResult("compact:toggle"),
		kind: "command",
		surfaces: ["tui"],
	});
}

/**
 * Register wizard aliases as top-level slash commands.
 * Called after wizard definitions are loaded from YAML.
 * E.g., aliases: ["setup"] → /setup opens the wizard form.
 */
export function registerWizardAliases(
	commandRegistry: CommandRegistry,
	wizardRegistry: import("../wizard/registry.js").WizardRegistry,
): void {
	for (const [alias, wizardId] of wizardRegistry.aliases()) {
		// Skip if a command with this name already exists (modes, builtins take precedence)
		if (commandRegistry.has(alias)) continue;

		const def = wizardRegistry.get(wizardId);
		if (!def) continue;

		commandRegistry.register({
			name: alias,
			description: `${def.header} (wizard)`,
			handler: (args, session) => handleWizardWithDef(def, args, session),
			kind: "command",
		});
	}
}
