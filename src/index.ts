#!/usr/bin/env node

/**
 * hise-cli - Interactive CLI client for HISE's named pipe REPL server.
 *
 * Connects to a running HISE instance via named pipe, provides a
 * human-friendly REPL with command shorthand, and formats JSON responses.
 *
 * Usage:
 *   hise-cli                    Connect to default pipe (hise-repl)
 *   hise-cli --pipe hise-repl-1234   Connect to a specific pipe
 *   hise-cli --list             List available HISE pipe instances
 */

import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import chalk from "chalk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReplResponse {
	success?: boolean;
	result?: Record<string, unknown>;
	error?: string;
	message?: string;
	progress?: boolean | number;
}

/** Returns true if the message is a final response (has success field). */
function isFinalResponse(msg: ReplResponse): boolean {
	return "success" in msg;
}

/** Returns true if the message is a progress update. */
function isProgressMessage(msg: ReplResponse): boolean {
	return "progress" in msg && !("success" in msg);
}

// ---------------------------------------------------------------------------
// Pipe discovery
// ---------------------------------------------------------------------------

const PIPE_PREFIX = "hise-repl";

function getPipePath(name: string): string {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\${name}`;
	}
	// macOS/Linux: JUCE creates two FIFOs at /tmp/{name}_in and /tmp/{name}_out.
	// node net.connect uses the socket path directly - but JUCE named pipes on
	// POSIX aren't Unix domain sockets, they're FIFO pairs. We'd need a different
	// approach on POSIX. For now, return the base path and handle POSIX in connect().
	return `/tmp/${name}`;
}

/** Scan for available HISE pipe instances. */
function discoverPipes(): string[] {
	const pipes: string[] = [];

	if (process.platform === "win32") {
		// Windows: enumerate \\.\pipe\ directory
		try {
			const entries = fs.readdirSync("\\\\.\\pipe\\");
			for (const entry of entries) {
				if (entry.startsWith(PIPE_PREFIX)) {
					pipes.push(entry);
				}
			}
		} catch {
			// Can't read pipe directory - not fatal
		}
	} else {
		// macOS/Linux: scan /tmp for hise-repl* FIFOs
		try {
			const entries = fs.readdirSync("/tmp");
			const seen = new Set<string>();
			for (const entry of entries) {
				// JUCE creates {name}_in and {name}_out; extract the base name
				const match = entry.match(/^(hise-repl[^_]*)_(?:in|out)$/);
				if (match && !seen.has(match[1])) {
					seen.add(match[1]);
					pipes.push(match[1]);
				}
			}
		} catch {
			// Not fatal
		}
	}

	return pipes;
}

// ---------------------------------------------------------------------------
// Command shorthand parser
// ---------------------------------------------------------------------------

/** Known commands that take no arguments. */
const SIMPLE_COMMANDS = new Set(["status", "project.info", "quit", "shutdown", "spin"]);

/**
 * Parse user input into a JSON command string.
 *
 * Supports:
 *   "status"                -> {"cmd":"status"}
 *   "project.info"          -> {"cmd":"project.info"}
 *   '{"cmd":"status"}'      -> passed through as-is
 *   "shutdown"              -> {"cmd":"shutdown"}
 */
function parseInput(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;

	// If it looks like raw JSON, pass through
	if (trimmed.startsWith("{")) {
		// Validate it's parseable
		try {
			JSON.parse(trimmed);
			return trimmed;
		} catch {
			return null;
		}
	}

	// Split into command and potential arguments
	const parts = trimmed.split(/\s+/);
	const cmd = parts[0].toLowerCase();

	if (SIMPLE_COMMANDS.has(cmd)) {
		return JSON.stringify({ cmd });
	}

	// Unknown command - still send it, server will reply with an error
	return JSON.stringify({ cmd });
}

// ---------------------------------------------------------------------------
// Response formatting
// ---------------------------------------------------------------------------

function formatResponse(raw: string): string {
	let parsed: ReplResponse;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return chalk.dim(raw);
	}

	if (!parsed.success) {
		const errorMsg = parsed.error || "Unknown error";
		return chalk.red(`Error: ${errorMsg}`);
	}

	// "message" field (used by quit, shutdown)
	if (parsed.message) {
		return chalk.green(parsed.message);
	}

	// "result" object - format as key: value pairs
	if (parsed.result && typeof parsed.result === "object") {
		const lines: string[] = [];
		for (const [key, value] of Object.entries(parsed.result)) {
			lines.push(`  ${chalk.cyan(key)}: ${chalk.white(String(value))}`);
		}
		return lines.join("\n");
	}

	// Fallback
	return chalk.dim(JSON.stringify(parsed, null, 2));
}

// ---------------------------------------------------------------------------
// Spinner / progress bar
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["|", "/", "-", "\\"];
const BAR_WIDTH = 20;

let spinnerInterval: ReturnType<typeof setInterval> | null = null;
let spinnerFrame = 0;
let spinnerText = "";
let lastProgressValue: number | null = null;

function renderProgressBar(ratio: number): string {
	const filled = Math.round(ratio * BAR_WIDTH);
	const empty = BAR_WIDTH - filled;
	const pct = Math.round(ratio * 100)
		.toString()
		.padStart(3);
	const bar =
		chalk.green("\u2588".repeat(filled)) +
		chalk.dim("\u2591".repeat(empty));
	return `[${bar}] ${pct}%`;
}

function clearLine(): void {
	process.stdout.write("\r\x1b[K");
}

function startSpinner(msg: string = ""): void {
	stopSpinner();
	spinnerText = msg;
	spinnerFrame = 0;
	lastProgressValue = null;

	spinnerInterval = setInterval(() => {
		clearLine();
		if (lastProgressValue !== null) {
			// Determinate: show progress bar
			const bar = renderProgressBar(lastProgressValue);
			process.stdout.write(`${bar} ${chalk.dim(spinnerText)}`);
		} else {
			// Indeterminate: show spinning character
			const frame = chalk.yellow(
				SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length]
			);
			process.stdout.write(`${frame} ${chalk.dim(spinnerText)}`);
		}
		spinnerFrame++;
	}, 80);
}

function updateSpinner(msg: string, progress?: boolean | number): void {
	spinnerText = msg;
	if (typeof progress === "number") {
		lastProgressValue = Math.max(0, Math.min(1, progress));
	} else {
		lastProgressValue = null;
	}
}

function stopSpinner(): void {
	if (spinnerInterval !== null) {
		clearInterval(spinnerInterval);
		spinnerInterval = null;
		clearLine();
	}
	lastProgressValue = null;
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

function connect(pipeName: string): Promise<net.Socket> {
	return new Promise((resolve, reject) => {
		const pipePath = getPipePath(pipeName);

		const socket = net.connect({ path: pipePath }, () => {
			resolve(socket);
		});

		socket.once("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
				reject(new Error(`No HISE instance found on pipe '${pipeName}'`));
			} else {
				reject(err);
			}
		});
	});
}

// ---------------------------------------------------------------------------
// REPL loop
// ---------------------------------------------------------------------------

async function runRepl(pipeName: string): Promise<void> {
	let socket: net.Socket;

	try {
		socket = await connect(pipeName);
	} catch (err) {
		console.error(chalk.red(String(err)));
		process.exit(1);
	}

	console.log(chalk.green(`Connected to HISE on pipe '${pipeName}'`));
	console.log(chalk.dim("Type a command (status, project.info, quit, shutdown) or raw JSON."));
	console.log(chalk.dim("Press Ctrl+C to disconnect.\n"));

	// Track whether we've already sent the quit command to avoid
	// sending it twice (e.g. Ctrl+C followed by readline close).
	let quitSent = false;

	/** Best-effort: send quit command so HISE knows we're leaving. */
	const sendQuit = () => {
		if (quitSent) return;
		quitSent = true;
		try {
			socket.write('{"cmd":"quit"}\n', "utf-8");
		} catch {
			// Socket may already be destroyed - that's fine
		}
	};

	// Console window closed or terminal hangup - send quit before we die.
	// On Windows, closing the cmd.exe window sends SIGHUP to Node.
	// On POSIX, closing the terminal sends SIGHUP.
	process.on("SIGHUP", () => {
		sendQuit();
		socket.destroy();
		process.exit(0);
	});

	// Ctrl+C - send quit and exit cleanly.
	process.on("SIGINT", () => {
		sendQuit();
		socket.destroy();
		process.exit(0);
	});

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: chalk.yellow("hise> "),
		terminal: true,
	});

	// True while waiting for a final response from the server.
	let commandPending = false;

	// Buffer incoming data and split on newlines
	let recvBuffer = "";

	socket.on("data", (data: Buffer) => {
		recvBuffer += data.toString("utf-8");

		// Process all complete lines
		let newlineIdx: number;
		while ((newlineIdx = recvBuffer.indexOf("\n")) >= 0) {
			const line = recvBuffer.substring(0, newlineIdx).trim();
			recvBuffer = recvBuffer.substring(newlineIdx + 1);
			if (!line) continue;

			let msg: ReplResponse;
			try {
				msg = JSON.parse(line);
			} catch {
				// Not JSON - display raw
				stopSpinner();
				console.log(chalk.dim(line));
				if (!commandPending) rl.prompt();
				continue;
			}

			if (isProgressMessage(msg)) {
				// Progress update - update spinner/bar text
				if (!spinnerInterval) startSpinner(msg.message || "");
				updateSpinner(msg.message || "", msg.progress);
				continue;
			}

			// Final response - stop spinner and display
			stopSpinner();
			commandPending = false;
			console.log(formatResponse(line));

			// Handle special exit messages
			if (msg.message === "bye") {
				console.log(chalk.dim("Disconnected."));
				socket.destroy();
				rl.close();
				process.exit(0);
			}
			if (msg.message === "Shutting down HISE") {
				console.log(chalk.dim("HISE is shutting down. Disconnecting."));
				socket.destroy();
				rl.close();
				process.exit(0);
			}

			rl.prompt();
		}
	});

	socket.on("close", () => {
		stopSpinner();
		console.log(chalk.dim("\nConnection closed by HISE."));
		rl.close();
		process.exit(0);
	});

	socket.on("error", (err) => {
		stopSpinner();
		console.error(chalk.red(`\nConnection error: ${err.message}`));
		rl.close();
		process.exit(1);
	});

	rl.on("line", (input: string) => {
		const json = parseInput(input);
		if (json === null) {
			if (input.trim()) {
				console.log(chalk.red("Invalid input. Use a command name or raw JSON."));
			}
			rl.prompt();
			return;
		}

		// Send the command and start the spinner
		commandPending = true;
		startSpinner("Waiting...");
		socket.write(json + "\n", "utf-8");
		// Don't prompt - wait for final response
	});

	rl.on("close", () => {
		stopSpinner();
		sendQuit();
		socket.destroy();
		process.exit(0);
	});

	rl.prompt();
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main(): void {
	const args = process.argv.slice(2);

	// --list: show available pipes
	if (args.includes("--list")) {
		const pipes = discoverPipes();
		if (pipes.length === 0) {
			console.log(chalk.dim("No HISE pipe instances found."));
		} else {
			console.log(chalk.cyan("Available HISE instances:"));
			for (const p of pipes) {
				console.log(`  ${chalk.white(p)}`);
			}
		}
		return;
	}

	// --pipe <name>: connect to specific pipe
	let pipeName = PIPE_PREFIX;
	const pipeIdx = args.indexOf("--pipe");
	if (pipeIdx >= 0 && args[pipeIdx + 1]) {
		pipeName = args[pipeIdx + 1];
	} else if (args.length > 0 && !args[0].startsWith("--")) {
		// Allow positional: hise-cli hise-repl-1234
		pipeName = args[0];
	}

	// If no specific pipe requested, try to auto-discover
	if (pipeName === PIPE_PREFIX) {
		const pipes = discoverPipes();
		if (pipes.length === 0) {
			console.error(chalk.red("No HISE pipe instances found. Is HISE running with the REPL server enabled?"));
			console.error(chalk.dim("Enable it via Tools > Toggle REPL Console in HISE."));
			process.exit(1);
		}
		if (pipes.length === 1) {
			pipeName = pipes[0];
		} else if (pipes.includes(PIPE_PREFIX)) {
			// Prefer the default name
			pipeName = PIPE_PREFIX;
		} else {
			// Multiple non-default pipes - ask user to specify
			console.log(chalk.cyan("Multiple HISE instances found:"));
			for (const p of pipes) {
				console.log(`  ${chalk.white(p)}`);
			}
			console.log(chalk.dim("\nUse --pipe <name> to connect to a specific instance."));
			process.exit(1);
		}
	}

	runRepl(pipeName);
}

main();
