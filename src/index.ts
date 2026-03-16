#!/usr/bin/env node

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";
import { render } from "ink";
import React from "react";
import { App as ReplApp } from "./app.js";
import { App as TuiApp } from "./tui/app.js";
import { HttpHiseConnection } from "./engine/hise.js";
import { MainMenuApp, type MenuChoice } from "./menu/App.js";
import { PIPE_PREFIX, connect, discoverPipes } from "./pipe.js";
import { SetupApp } from "./setup/App.js";
import {
	fetchLatestFaustVersion,
	fetchLatestPassingCommit,
} from "./setup-core/github.js";

// ── Subcommand parsing ──────────────────────────────────────────────

type Subcommand = "menu" | "repl" | "setup" | "update" | "migrate" | "nuke" | "list";

function parseArgs(argv: string[]): {
	subcommand: Subcommand;
	rest: string[];
} {
	const args = argv.slice(2);

	if (args.includes("--list")) {
		return { subcommand: "list", rest: args };
	}

	const first = args[0]?.toLowerCase();
	const known: Subcommand[] = ["repl", "setup", "update", "migrate", "nuke"];

	if (first && known.includes(first as Subcommand)) {
		return { subcommand: first as Subcommand, rest: args.slice(1) };
	}

	// No subcommand or unknown first arg: show menu
	return { subcommand: "menu", rest: args };
}

// ── Pipe helpers (reused from original) ─────────────────────────────

function printPipeList(): void {
	const pipes = discoverPipes();
	if (pipes.length === 0) {
		console.log(chalk.dim("No HISE pipe instances found."));
		return;
	}

	console.log(chalk.cyan("Available HISE instances:"));
	for (const pipe of pipes) {
		console.log(`  ${chalk.white(pipe)}`);
	}
}

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

function waitForPipe(
	timeoutMs: number = 30_000,
	intervalMs: number = 500,
	onTick?: () => void
): Promise<string | null> {
	return new Promise((resolve) => {
		const startTime = Date.now();

		const poll = () => {
			const pipes = discoverPipes();
			if (pipes.length > 0) {
				resolve(pipes.includes(PIPE_PREFIX) ? PIPE_PREFIX : pipes[0]);
				return;
			}

			if (Date.now() - startTime >= timeoutMs) {
				resolve(null);
				return;
			}

			onTick?.();
			setTimeout(poll, intervalMs);
		};

		poll();
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

// ── New TUI launch (HTTP REST API) ──────────────────────────────────

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

async function launchNewTui(connection: HttpHiseConnection): Promise<void> {
	const instance = render(
		React.createElement(TuiApp, { connection }),
		{
			exitOnCtrlC: true,
		},
	);
	await instance.waitUntilExit();
}

// ── Launch functions ────────────────────────────────────────────────

async function launchRepl(
	args: string[],
	options: { skipLaunchPrompt?: boolean } = {}
): Promise<void> {
	// If --pipe was explicitly given, use legacy pipe REPL directly
	const pipeIndex = args.indexOf("--pipe");
	const explicitPipe = pipeIndex >= 0 && args[pipeIndex + 1]
		? args[pipeIndex + 1]
		: null;

	if (explicitPipe) {
		await connectAndRunRepl(explicitPipe);
		return;
	}

	// 1. Probe HTTP REST API on localhost:1900 (new TUI path)
	const connection = new HttpHiseConnection();
	const httpAlive = await connection.probe();

	if (httpAlive) {
		await launchNewTui(connection);
		return;
	}

	// 2. HISE may be starting — wait with retries (up to 10s)
	console.log(chalk.dim("Probing HISE REST API on localhost:1900..."));
	const httpReady = await probeHiseHttp("127.0.0.1", 1900, 10, 1000);

	if (httpReady) {
		const retryConnection = new HttpHiseConnection();
		await launchNewTui(retryConnection);
		return;
	}

	// 3. Fallback: try legacy named pipes
	const pipes = discoverPipes();

	if (pipes.length > 0) {
		if (pipes.length > 1 && !pipes.includes(PIPE_PREFIX)) {
			console.log(chalk.cyan("Multiple HISE instances found:"));
			for (const pipe of pipes) {
				console.log(`  ${chalk.white(pipe)}`);
			}
			console.log(
				chalk.dim("\nUse --pipe <name> to connect to a specific instance.")
			);
			process.exit(1);
		}

		const pipeName = pipes.includes(PIPE_PREFIX) ? PIPE_PREFIX : pipes[0];
		await connectAndRunRepl(pipeName);
		return;
	}

	// 4. No connection — offer to launch HISE Debug
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

	// Wait for either HTTP or pipe connection
	process.stdout.write(chalk.dim("Waiting for HISE"));
	const httpOrPipe = await Promise.race([
		probeHiseHttp("127.0.0.1", 1900, 30, 1000).then((ok) =>
			ok ? ("http" as const) : null,
		),
		waitForPipe(30_000, 500, () => {
			process.stdout.write(chalk.dim("."));
		}).then((pipe) => (pipe ? ("pipe" as const) : null)),
	]);

	if (httpOrPipe === "http") {
		console.log(chalk.green(" connected (HTTP)!"));
		const newConnection = new HttpHiseConnection();
		await launchNewTui(newConnection);
	} else if (httpOrPipe === "pipe") {
		console.log(chalk.green(" connected (pipe)!"));
		const pipes = discoverPipes();
		const pipeName = pipes.includes(PIPE_PREFIX) ? PIPE_PREFIX : pipes[0];
		await connectAndRunRepl(pipeName);
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

async function connectAndRunRepl(pipeName: string): Promise<void> {
	try {
		const connection = await connect(pipeName);
		const restoreAltScreen = setupAltScreen();

		const instance = render(
			React.createElement(ReplApp, { connection, pipeName })
		);
		await instance.waitUntilExit().finally(() => {
			restoreAltScreen();
		});
	} catch (error) {
		console.error(chalk.red(String(error)));
		process.exit(1);
	}
}

async function launchSetup(_args: string[]): Promise<void> {
	// Fetch online metadata (hard fail if offline)
	console.log(chalk.cyan("Fetching CI status and Faust version..."));

	let targetCommit: string | undefined;
	let faustVersion: string | undefined;

	try {
		[targetCommit, faustVersion] = await Promise.all([
			fetchLatestPassingCommit(),
			fetchLatestFaustVersion(),
		]);
		console.log(
			chalk.green(`Target commit: ${targetCommit.substring(0, 7)}`)
		);
		console.log(chalk.green(`Faust version: ${faustVersion}`));
	} catch (error) {
		console.error(
			chalk.red(
				`Failed to fetch online metadata: ${String(error)}`
			)
		);
		console.error(
			chalk.red(
				"An internet connection is required for setup. Please check your connection and try again."
			)
		);
		process.exit(1);
	}

	const onExit = () => {
		// Nothing special needed
	};

	const instance = render(
		React.createElement(SetupApp, {
			targetCommit,
			faustVersion,
			onExit,
		})
	);
	await instance.waitUntilExit();
}

async function launchUpdate(_args: string[]): Promise<void> {
	console.log(chalk.yellow("Update flow not yet implemented."));
	process.exit(0);
}

async function launchMigrate(_args: string[]): Promise<void> {
	console.log(chalk.yellow("Migrate flow not yet implemented."));
	process.exit(0);
}

async function launchNuke(_args: string[]): Promise<void> {
	console.log(chalk.yellow("Nuke flow not yet implemented."));
	process.exit(0);
}

function launchMenu(): void {
	const handleSelect = (choice: MenuChoice) => {
		// Unmount menu and launch chosen mode
		instance.unmount();

		setTimeout(() => {
			switch (choice) {
				case "setup":
					void launchSetup([]);
					break;
				case "update":
					void launchUpdate([]);
					break;
				case "migrate":
					void launchMigrate([]);
					break;
				case "nuke":
					void launchNuke([]);
					break;
				case "repl":
					void launchRepl([], { skipLaunchPrompt: true });
					break;
			}
		}, 0);
	};

	const instance = render(
		React.createElement(MainMenuApp, { onSelect: handleSelect })
	);
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const { subcommand, rest } = parseArgs(process.argv);

	switch (subcommand) {
		case "list":
			printPipeList();
			break;
		case "repl":
			await launchRepl(rest);
			break;
		case "setup":
			await launchSetup(rest);
			break;
		case "update":
			await launchUpdate(rest);
			break;
		case "migrate":
			await launchMigrate(rest);
			break;
		case "nuke":
			await launchNuke(rest);
			break;
		case "menu":
		default:
			launchMenu();
			break;
	}
}

void main();
