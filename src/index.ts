#!/usr/bin/env node

import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { App as TuiApp } from "./tui/app.js";
import { HttpHiseConnection } from "./engine/hise.js";
import { createSession } from "./session-bootstrap.js";
import { executeCliCommand } from "./cli/run.js";
import { renderCliHelp } from "./cli/help.js";
import { listCliCommands } from "./cli/commands.js";
import { createDefaultMockRuntime } from "./mock/runtime.js";
import { registerUpdateHandlers } from "./tui/wizard-handlers/index.js";
import { bootstrapNodeRuntime, type NodeRuntime } from "./bootstrap-runtime.js";

// ── Runtime singleton ───────────────────────────────────────────────

const runtime: NodeRuntime = bootstrapNodeRuntime();

// ── Alt-screen helpers ──────────────────────────────────────────────

function setupAltScreen(): () => void {
	const enterAlt = "\x1b[?1049h\x1b[2J\x1b[H";
	const leaveAlt = "\x1b[?1049l";
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

async function launchTui(
	connection: import("./engine/hise.js").HiseConnection,
	options?: { animate?: boolean; showKeys?: boolean },
): Promise<void> {
	// Update wizard handlers need a live connection + launcher, so register
	// them per-session once those are in scope. Re-registering replaces any
	// previous binding on the shared handler registry.
	registerUpdateHandlers(runtime.handlerRegistry, {
		executor: runtime.phaseExecutor,
		connection,
		launcher: runtime.hiseLauncher,
	});
	const restoreAltScreen = setupAltScreen();

	const instance = render(
		React.createElement(TuiApp, {
			connection,
			dataLoader: runtime.dataLoader,
			animate: options?.animate,
			handlerRegistry: runtime.handlerRegistry,
			launcher: runtime.hiseLauncher,
			showKeys: options?.showKeys,
		}),
		{
			exitOnCtrlC: false,
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
	const showKeys = args.includes("--show-keys");

	if (args.includes("--mock")) {
		const mockRuntime = createDefaultMockRuntime();
		await launchTui(mockRuntime.connection, { animate: !noAnimation, showKeys });
		return;
	}

	// Launch immediately — the TUI's 5s polling detects HISE when it comes online.
	// Use /connect to manually check connection status.
	const connection = new HttpHiseConnection();
	await launchTui(connection, { animate: !noAnimation, showKeys });
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	// Web frontend: hise-cli --web [--mock] [--no-open] [--port=N]
	if (process.argv.includes("--web")) {
		const { launchWeb } = await import("./web/server.js");
		const args = process.argv.slice(2);
		await launchWeb({
			runtime,
			useMock: args.includes("--mock"),
			openBrowser: !args.includes("--no-open"),
			port: parsePortFlag(args),
		});
		return;
	}

	// Fast-path: diagnose subcommand (no session bootstrap needed)
	if (process.argv[2] === "diagnose") {
		const args = process.argv.slice(3);
		if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
			console.log(renderCliHelp([], "diagnose"));
			process.exit(0);
		}
		const { executeDiagnose, parseDiagnoseFlags, formatDiagnoseOutput } = await import("./cli/diagnose.js");
		const { filePath, flags } = parseDiagnoseFlags(args);
		if (!filePath) {
			console.error("diagnose requires a file path argument");
			process.exit(1);
		}
		const connection = new HttpHiseConnection();
		const result = await executeDiagnose(filePath, connection);
		connection.destroy();

		if (flags.format === "pretty") {
			const output = formatDiagnoseOutput(result, flags);
			if (output) {
				process.stderr.write(output + "\n");
			}
			// Exit 2 = hook "block" signal (shows stderr to Claude), 0 = clean
			process.exitCode = result.ok ? 0 : 2;
			return;
		}

		console.log(JSON.stringify(result));
		process.exitCode = result.ok ? 0 : 1;
		return;
	}

	const bootstrap = createSession({ connection: null });
	const cliCommands = listCliCommands(bootstrap.session.allCommands());
	const cliResult = await executeCliCommand(process.argv, cliCommands, runtime.dataLoader, { handlerRegistry: runtime.handlerRegistry, launcher: runtime.hiseLauncher });

	if (cliResult.kind === "help") {
		console.log(renderCliHelp(cliCommands, cliResult.scope));
		return;
	}

	if (cliResult.kind === "error") {
		console.error(chalk.red(cliResult.message));
		process.exitCode = 1;
		return;
	}

	if (cliResult.kind === "json") {
		console.log(JSON.stringify(cliResult.payload));
		process.exitCode = cliResult.payload.ok ? 0 : 1;
		return;
	}

	if (cliResult.kind === "diagnose") {
		// Should not reach here — handled by fast-path above
		console.error("diagnose must be handled before session bootstrap");
		process.exit(1);
	}

	await launchRepl(cliResult.args);
}

function parsePortFlag(args: string[]): number | undefined {
	for (const arg of args) {
		if (arg.startsWith("--port=")) {
			const n = Number(arg.slice("--port=".length));
			if (Number.isFinite(n) && n > 0 && n < 65536) return n;
		}
	}
	return undefined;
}

void main();
