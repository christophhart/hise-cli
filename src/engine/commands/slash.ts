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

async function handleHelp(
	_args: string,
	session: CommandSession,
): Promise<CommandResult> {
	const modeId = session.currentModeId as ModeId;
	const commands = session.allCommands();
	const help = generateHelp(modeId, commands);
	return overlayResult(help.title, help.lines, help.footer);
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
		const fullId = args ? `${modeId}:${args}` : modeId;
		const result = session.pushMode(fullId);
		if (result) return result;
		const label = args ? `${modeId}:${args}` : modeId;
		return textResult(`Entered ${label} mode.`);
	};
	return handler;
}

async function handleWizard(
	args: string,
	_session: CommandSession,
): Promise<CommandResult> {
	if (!args) {
		return errorResult("Usage: /wizard <id>. Wizard framework not yet implemented.");
	}
	return errorResult(`Wizard "${args}" not yet implemented.`);
}

// ── Registration ────────────────────────────────────────────────────

export function registerBuiltinCommands(registry: CommandRegistry): void {
	registry.register({
		name: "exit",
		description: "Exit current mode (or quit at root)",
		handler: handleExit,
	});

	registry.register({
		name: "quit",
		description: "Quit (alias for /exit)",
		handler: handleExit,
	});

	registry.register({
		name: "help",
		description: "Show available commands and help topics",
		handler: handleHelp,
	});

	registry.register({
		name: "clear",
		description: "Clear the output",
		handler: handleClear,
	});

	registry.register({
		name: "modes",
		description: "List available modes",
		handler: handleModes,
	});

	registry.register({
		name: "builder",
		description: "Enter builder mode (module tree)",
		handler: createModeHandler("builder"),
	});

	registry.register({
		name: "script",
		description: "Enter script mode (HiseScript REPL)",
		handler: createModeHandler("script"),
	});

	registry.register({
		name: "dsp",
		description: "Enter DSP mode (scriptnode)",
		handler: createModeHandler("dsp"),
	});

	registry.register({
		name: "sampler",
		description: "Enter sampler mode",
		handler: createModeHandler("sampler"),
	});

	registry.register({
		name: "inspect",
		description: "Enter inspect mode (runtime monitor)",
		handler: createModeHandler("inspect"),
	});

	registry.register({
		name: "project",
		description: "Enter project mode (settings)",
		handler: createModeHandler("project"),
	});

	registry.register({
		name: "compile",
		description: "Enter compile mode (build targets)",
		handler: createModeHandler("compile"),
	});

	registry.register({
		name: "import",
		description: "Enter import mode (asset import)",
		handler: createModeHandler("import"),
	});

	registry.register({
		name: "wizard",
		description: "Run a wizard workflow",
		handler: handleWizard,
	});
}
