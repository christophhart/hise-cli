#!/usr/bin/env node

// ── Terminal color detection (must run before any renderer import) ───
// Rezi forces truecolor when it detects pre-rendered ANSI in text content,
// which breaks terminals like macOS Terminal.app that don't support 24-bit
// RGB. Set FORCE_COLOR early so Rezi respects the terminal's actual level.
if (!process.env.FORCE_COLOR && !process.env.NO_COLOR) {
	const ct = process.env.COLORTERM ?? "";
	if (ct !== "truecolor" && ct !== "24bit") {
		const depth = process.stdout.getColorDepth?.();
		if (typeof depth === "number" && depth < 24) {
			process.env.FORCE_COLOR = "2"; // 256-color
		}
	}
}

import chalk from "chalk";
import { render } from "./tui/ink-shim.js";
import React from "react";
import { App as TuiApp } from "./tui/app.js";
import { HttpHiseConnection } from "./engine/hise.js";
import { createBundledDataLoader } from "./tui/bundledDataLoader.js";
import { createSession } from "./session-bootstrap.js";
import { executeCliCommand } from "./cli/run.js";
import { renderCliHelp } from "./cli/help.js";
import { listCliCommands } from "./cli/commands.js";
import { createDefaultMockRuntime } from "./mock/runtime.js";
import { WizardHandlerRegistry } from "./engine/wizard/handler-registry.js";
import { createNodePhaseExecutor } from "./tui/nodePhaseExecutor.js";
import { registerSetupHandlers, registerCompileHandlers } from "./tui/wizard-handlers/index.js";

// ── Wizard handler setup ────────────────────────────────────────────

const phaseExecutor = createNodePhaseExecutor();
const handlerRegistry = new WizardHandlerRegistry();
registerSetupHandlers(handlerRegistry, phaseExecutor);
registerCompileHandlers(handlerRegistry, phaseExecutor);

// ── Alt-screen helpers ──────────────────────────────────────────────

function setupAltScreen(): () => void {
	const enterAlt = "\u001b[?1049h\u001b[2J\u001b[H";
	const leaveAlt = "\u001b[?1049l";
	let restored = false;

	const restore = () => {
		if (restored) return;
		restored = true;
		process.stdout.write(leaveAlt);
	};

	process.once("exit", restore);
	process.once("SIGTERM", restore);
	process.once("uncaughtException", restore);
	process.once("unhandledRejection", restore);
	process.stdout.write(enterAlt);

	return restore;
}

const dataLoader = createBundledDataLoader();

async function launchTui(
	connection: import("./engine/hise.js").HiseConnection,
	options?: { animate?: boolean },
): Promise<void> {
	const restoreAltScreen = setupAltScreen();

	const instance = render(
		React.createElement(TuiApp, {
			connection,
			dataLoader,
			animate: options?.animate,
			handlerRegistry,
		}),
		{
			exitOnCtrlC: true,
			maxFps: 60,
		},
	);
	await instance.waitUntilExit().finally(() => {
		restoreAltScreen();
	});
}

// ── Launch functions ────────────────────────────────────────────────

async function launchRepl(args: string[]): Promise<void> {
	const noAnimation = args.includes("--no-animation");

	if (args.includes("--mock")) {
		const mockRuntime = createDefaultMockRuntime();
		await launchTui(mockRuntime.connection, { animate: !noAnimation });
		return;
	}

	// Launch immediately — the TUI's 5s polling detects HISE when it comes online.
	// Use /connect to manually check connection status.
	const connection = new HttpHiseConnection();
	await launchTui(connection, { animate: !noAnimation });
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const bootstrap = createSession({ connection: null });
	const cliCommands = listCliCommands(bootstrap.session.allCommands());
	const cliResult = await executeCliCommand(process.argv, cliCommands, dataLoader, { handlerRegistry });

	if (cliResult.kind === "help") {
		console.log(renderCliHelp(cliCommands, cliResult.scope));
		return;
	}

	if (cliResult.kind === "error") {
		console.error(chalk.red(cliResult.message));
		process.exit(1);
	}

	if (cliResult.kind === "json") {
		console.log(JSON.stringify(cliResult.payload));
		process.exit(cliResult.payload.ok ? 0 : 1);
	}

	await launchRepl(cliResult.args);
}

void main();
