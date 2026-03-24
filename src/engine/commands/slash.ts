// ── Built-in slash command handlers ──────────────────────────────────

import type { CommandResult } from "../result.js";
import {
	emptyResult,
	errorResult,
	overlayResult,
	tableResult,
	textResult,
} from "../result.js";
import { MODE_ACCENTS, type ModeId } from "../modes/mode.js";
import type { CommandHandler, CommandRegistry, CommandSession } from "./registry.js";
import { generateHelp } from "./help.js";

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

	return textResult(help.content);

	// TODO: remove the ENTIRE OVERLAY SYSTEM!!!
	//return overlayResult(help.title, help.content, help.footer);
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
		["import", "Asset import", MODE_ACCENTS.import],
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
			
			// Push mode onto stack
			const pushResult = session.pushMode(modeId);
			if (pushResult) return pushResult;
			
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
		name: "import",
		description: "Enter import mode (asset import)",
		handler: createModeHandler("import"),
		kind: "mode",
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
}
