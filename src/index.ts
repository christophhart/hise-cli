#!/usr/bin/env node

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { App as TuiApp } from "./tui/app.js";
import { HttpHiseConnection } from "./engine/hise.js";
import { createNodeDataLoader } from "./tui/nodeDataLoader.js";
import { createSession } from "./session-bootstrap.js";
import { executeCliCommand } from "./cli/run.js";
import { renderCliHelp } from "./cli/help.js";
import { listCliCommands } from "./cli/commands.js";
import { createDefaultMockRuntime } from "./mock/runtime.js";

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

// ── HISE Debug launch helpers ───────────────────────────────────────

function findHiseDebug(): string | null {
	const isWin = process.platform === "win32";
	const names = isWin
		? ["HISE Debug.exe"]
		: ["HISE Debug"];

	// On Windows, X_OK is not meaningful - just check file exists
	const accessMode = isWin ? fs.constants.F_OK : fs.constants.X_OK;

	const pathEnv = process.env.PATH || "";
	const separator = isWin ? ";" : ":";
	const dirs = pathEnv.split(separator).filter(Boolean);

	for (const dir of dirs) {
		for (const name of names) {
			const candidate = path.join(dir, name);
			try {
				fs.accessSync(candidate, accessMode);
				return candidate;
			} catch {
				// Not found here, keep looking.
			}
		}
	}

	return null;
}

function promptYesNo(question: string): Promise<boolean> {
	if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
		process.stdin.setRawMode(false);
	}
	process.stdin.resume();

	const parseAnswer = (answer: string): boolean | null => {
		const hadEscape = /\x1b/.test(answer);
		const cleaned = answer
			.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
			.replace(/[\x00-\x1F\x7F]/g, "")
			.trim()
			.toLowerCase();

		if (cleaned === "") {
			return hadEscape ? null : true;
		}

		if (cleaned === "y" || cleaned === "yes") {
			return true;
		}

		if (cleaned === "n" || cleaned === "no") {
			return false;
		}

		return null;
	};

	return new Promise((resolve) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		const ask = () => {
			rl.question(question, (answer) => {
				const parsed = parseAnswer(answer);
				if (parsed === null) {
					console.log(chalk.dim("Please enter y or n."));
					ask();
					return;
				}

				rl.close();
				resolve(parsed);
			});
		};

		ask();
	});
}

function spawnHiseDebug(exePath: string): void {
	const args = ["start_server"];

	if (process.platform === "win32") {
		child_process.spawn(exePath, args, {
			detached: true,
			stdio: "ignore",
			shell: false,
		}).unref();
	} else {
		child_process.spawn(exePath, args, {
			detached: true,
			stdio: "ignore",
		}).unref();
	}
}

// ── HTTP connection ─────────────────────────────────────────────────

async function probeHiseHttp(
	host = "127.0.0.1",
	port = 1900,
	retries = 10,
	intervalMs = 1000,
): Promise<boolean> {
	const connection = new HttpHiseConnection(host, port);
	for (let i = 0; i < retries; i++) {
		const alive = await connection.probe();
		if (alive) return true;
		if (i < retries - 1) {
			await new Promise((r) => setTimeout(r, intervalMs));
		}
	}
	return false;
}

// Resolve data/ directory relative to this file (works from both
// dist/index.js and src/index.ts).
const dataDir = path.resolve(import.meta.dirname, "../data");
const dataLoader = createNodeDataLoader(dataDir);

async function launchTui(
	connection: import("./engine/hise.js").HiseConnection,
	options?: { animate?: boolean; builderTree?: import("./engine/result.js").TreeNode | null },
): Promise<void> {
	const restoreAltScreen = setupAltScreen();

	const instance = render(
		React.createElement(TuiApp, {
			connection,
			dataLoader,
			builderTree: options?.builderTree,
			animate: options?.animate,
		}),
		{
			exitOnCtrlC: true,
		},
	);
	await instance.waitUntilExit().finally(() => {
		restoreAltScreen();
	});
}

// ── Launch functions ────────────────────────────────────────────────

async function launchRepl(
	args: string[],
	options: { skipLaunchPrompt?: boolean } = {}
): Promise<void> {
	const noAnimation = args.includes("--no-animation");

	// If --mock was given, skip all connection probing and launch
	// with a mock connection. Useful for exploring the CLI without
	// HISE running, for demos, and for screencast recording.
	if (args.includes("--mock")) {
		const mockRuntime = createDefaultMockRuntime();
		await launchTui(mockRuntime.connection, {
			animate: !noAnimation,
			builderTree: mockRuntime.builderTree,
		});
		return;
	}

	// 1. Probe HTTP REST API on localhost:1900
	const connection = new HttpHiseConnection();
	const httpAlive = await connection.probe();

	if (httpAlive) {
		await launchTui(connection, { animate: !noAnimation });
		return;
	}

	// 2. HISE may be starting - wait with retries (up to 10s)
	console.log(chalk.dim("Probing HISE REST API on localhost:1900..."));
	const httpReady = await probeHiseHttp("127.0.0.1", 1900, 10, 1000);

	if (httpReady) {
		const retryConnection = new HttpHiseConnection();
		await launchTui(retryConnection, { animate: !noAnimation });
		return;
	}

	// 3. No connection - offer to launch HISE Debug
	const hisePath = findHiseDebug();

	if (!hisePath) {
		console.error(
			chalk.red("No HISE instance found and 'HISE Debug' is not on PATH.")
		);
		console.error(
			chalk.dim(
				"Either start HISE manually, or add HISE Debug to your PATH."
			)
		);
		process.exit(1);
	}

	console.log(chalk.yellow("No running HISE instance found."));
	console.log(chalk.dim(`Found: ${hisePath}`));

	const shouldLaunch = options.skipLaunchPrompt
		? true
		: await promptYesNo(
				chalk.cyan("Launch HISE Debug with REPL server? [Y/n] ")
			);

	if (!shouldLaunch) {
		process.exit(0);
	}

	console.log(chalk.dim("Starting HISE Debug..."));
	spawnHiseDebug(hisePath);

	// Wait for HTTP connection
	process.stdout.write(chalk.dim("Waiting for HISE"));
	const httpUp = await probeHiseHttp("127.0.0.1", 1900, 30, 1000);

	if (httpUp) {
		console.log(chalk.green(" connected!"));
		const newConnection = new HttpHiseConnection();
		await launchTui(newConnection, { animate: !noAnimation });
	} else {
		console.log("");
		console.error(
			chalk.red("\nTimed out waiting for HISE to start (30s).")
		);
		console.error(
			chalk.dim("HISE may still be loading. Try again in a moment.")
		);
		process.exit(1);
	}
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const bootstrap = createSession({ connection: null });
	const cliCommands = listCliCommands(bootstrap.session.allCommands());
	const cliResult = await executeCliCommand(process.argv, cliCommands, dataLoader);

	if (cliResult.kind === "help") {
		console.log(renderCliHelp(cliCommands));
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
