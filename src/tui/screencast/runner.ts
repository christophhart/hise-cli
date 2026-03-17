// ── Tape Runner — execute .tape commands against real pty ────────────
//
// Spawns the app in a pseudo-terminal via node-pty, feeds keystrokes
// from tape commands, captures real terminal output for .cast files,
// and checks assertions against the output stream.

import * as path from "node:path";
import * as pty from "node-pty";
import type { TapeCommand } from "../../engine/screencast/types.js";

// ── Types ───────────────────────────────────────────────────────────

export interface RunnerConfig {
	width?: number;
	height?: number;
	/** Path to the built app entry point. Defaults to dist/index.js. */
	entryPoint?: string;
	/** Extra CLI args passed to the app. --mock is always included. */
	extraArgs?: string[];
}

/** A raw output event from the pty — maps directly to an asciicast "o" event. */
export interface OutputEvent {
	time: number;    // seconds since start
	data: string;    // raw terminal bytes (with ANSI)
}

/** An input event — maps to an asciicast "i" event. */
export interface InputEvent {
	time: number;
	text: string;
}

export interface AssertionResult {
	pass: boolean;
	command: TapeCommand;
	message: string;
}

export interface Marker {
	time: number;
	text: string;
}

export interface RunResult {
	events: OutputEvent[];
	inputs: InputEvent[];
	assertions: AssertionResult[];
	markers: Marker[];
	width: number;
	height: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

function stripAnsi(s: string): string {
	// Strip all ANSI escape sequences: CSI, OSC, character set, etc.
	return s
		.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
		.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
		.replace(/\x1b[()][0-9A-B]/g, "")
		.replace(/\x1b[=>]/g, "");
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Map a Key command name to the stdin byte sequence. */
function keySequence(key: string): string {
	if (key.startsWith("Ctrl+")) {
		const ch = key.slice(5);
		if (ch === "Space") return "\x00";
		if (ch.length === 1) {
			return String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 64);
		}
		return ch;
	}
	if (key.startsWith("Alt+")) {
		return `\x1b${key.slice(4)}`;
	}
	switch (key) {
		case "Enter": return "\r";
		case "Tab": return "\t";
		case "Backspace": return "\x7f";
		case "Delete": return "\x1b[3~";
		case "Escape": return "\x1b";
		case "Space": return " ";
		case "Up": return "\x1b[A";
		case "Down": return "\x1b[B";
		case "Right": return "\x1b[C";
		case "Left": return "\x1b[D";
		case "Home": return "\x1b[H";
		case "End": return "\x1b[F";
		case "PageUp": return "\x1b[5~";
		case "PageDown": return "\x1b[6~";
		default: return key;
	}
}

// ── Config extraction from Set commands ─────────────────────────────

function extractConfig(commands: TapeCommand[]): {
	width: number;
	height: number;
	typingSpeed: number;
} {
	let width = 80;
	let height = 24;
	let typingSpeed = 50;

	for (const cmd of commands) {
		if (cmd.type === "Set") {
			if (cmd.key === "Width") width = parseInt(cmd.value, 10) || 80;
			else if (cmd.key === "Height") height = parseInt(cmd.value, 10) || 24;
			else if (cmd.key === "TypingSpeed") {
				const match = cmd.value.match(/^(\d+)(ms|s)?$/);
				if (match) {
					typingSpeed = parseFloat(match[1]);
					if (match[2] === "s") typingSpeed *= 1000;
				}
			}
		}
	}

	return { width, height, typingSpeed };
}

// ── Runner ──────────────────────────────────────────────────────────

export async function runTape(
	commands: TapeCommand[],
	config?: Partial<RunnerConfig>,
): Promise<RunResult> {
	const extracted = extractConfig(commands);
	const width = config?.width ?? extracted.width;
	const height = config?.height ?? extracted.height;
	const typingSpeed = extracted.typingSpeed;

	const events: OutputEvent[] = [];
	const inputs: InputEvent[] = [];
	const assertions: AssertionResult[] = [];
	const markers: Marker[] = [];

	// Output buffer — accumulates all pty output.
	// outputCursor tracks where we last checked for assertions,
	// so Expect only matches output since the last command.
	let outputBuffer = "";
	let outputCursor = 0;
	let hidden = false;

	// Clock tracks simulated time for the .cast file
	const startTime = Date.now();
	function elapsed(): number {
		return (Date.now() - startTime) / 1000;
	}

	// Resolve entry point
	const entryPoint = config?.entryPoint
		?? path.resolve(import.meta.dirname, "../../../dist/index.js");
	const extraArgs = config?.extraArgs ?? [];

	// Spawn the app in a pty with --mock and --no-animation.
	// Animation is disabled by default for screencasts to reduce
	// output size (idle redraws). Use process.execPath for the
	// absolute node binary path — node-pty's posix_spawn doesn't
	// search PATH.
	const proc = pty.spawn(process.execPath, [entryPoint, "--mock", "--no-animation", ...extraArgs], {
		name: "xterm-256color",
		cols: width,
		rows: height,
		env: {
			...process.env,
			TERM: "xterm-256color",
			// Force color output even without a real TTY
			FORCE_COLOR: "1",
		},
	});

	// Capture pty output
	const dataHandler = proc.onData((data: string) => {
		outputBuffer += data;
		if (!hidden) {
			events.push({ time: elapsed(), data });
		}
	});

	// Wait for the app to boot and show the prompt
	const BOOT_TIMEOUT = 10_000;
	const bootDeadline = Date.now() + BOOT_TIMEOUT;
	while (Date.now() < bootDeadline) {
		if (stripAnsi(outputBuffer).includes(">")) break;
		await delay(100);
	}
	if (!stripAnsi(outputBuffer).includes(">")) {
		proc.kill();
		dataHandler.dispose();
		throw new Error("App did not boot within timeout — no prompt found");
	}

	// Mark the cursor past the boot output
	outputCursor = outputBuffer.length;

	// ── Command execution ───────────────────────────────────────────

	try {
		for (const cmd of commands) {
			switch (cmd.type) {
				case "Set":
				case "SetConnection":
				case "Output": {
					// Config already extracted / not applicable in pty mode
					break;
				}

				case "SetMockResponse": {
					// Not supported in pty mode — the app runs in a
					// separate process. Skip silently.
					break;
				}

				case "Type": {
					const charDelay = cmd.speed ?? typingSpeed;
					// Type characters one at a time — like a human would
					for (const ch of cmd.text) {
						proc.write(ch);
						inputs.push({ time: elapsed(), text: ch });
						await delay(charDelay);
					}
					// Advance cursor — output from typing will appear
					// after settle, assertions check from here
					await delay(50);
					outputCursor = outputBuffer.length;
					break;
				}

				case "Key": {
					const count = cmd.count ?? 1;
					const seq = keySequence(cmd.key);
					for (let i = 0; i < count; i++) {
						proc.write(seq);
						inputs.push({ time: elapsed(), text: cmd.key });
						if (count > 1) await delay(30);
					}
					// Enter and Tab trigger processing — wait for output
					if (cmd.key === "Enter" || cmd.key === "Tab") {
						await delay(300);
					} else {
						await delay(50);
					}
					outputCursor = outputBuffer.length;
					break;
				}

				case "Sleep": {
					const ms = cmd.unit === "s"
						? cmd.duration * 1000
						: cmd.duration;
					await delay(ms);
					outputCursor = outputBuffer.length;
					break;
				}

				case "Wait": {
					const timeout = cmd.timeout ?? 5000;
					const deadline = Date.now() + timeout;
					let found = false;
					while (Date.now() < deadline) {
						const recent = stripAnsi(outputBuffer.slice(outputCursor));
						if (recent.includes(cmd.pattern)) {
							found = true;
							break;
						}
						await delay(50);
					}
					outputCursor = outputBuffer.length;
					if (!found) {
						assertions.push({
							pass: false,
							command: cmd,
							message: `Wait timed out: "${cmd.pattern}" not found within ${timeout}ms`,
						});
					}
					break;
				}

				case "Expect": {
					// Check the last visible screen for the pattern.
					// This is more reliable than cursor-based tracking
					// because the pty output contains full screen repaints.
					const lastClear = outputBuffer.lastIndexOf("\x1b[2J");
					const lastScreen = lastClear >= 0
						? stripAnsi(outputBuffer.slice(lastClear))
						: stripAnsi(outputBuffer.slice(-2000));
					const pass = lastScreen.includes(cmd.pattern);
					assertions.push({
						pass,
						command: cmd,
						message: pass
							? `Expect passed: found "${cmd.pattern}"`
							: `Expect failed: "${cmd.pattern}" not found in last screen`,
					});
					break;
				}

				case "ExpectMode": {
					// The pty output contains full screen repaints. We check
					// the LAST screen repaint (the final clear+redraw in the
					// buffer) to determine the currently visible mode.
					const plain = stripAnsi(outputBuffer);
					// Find the last screen clear — this marks the start of
					// the most recent visible frame.
					const lastClear = outputBuffer.lastIndexOf("\x1b[2J");
					const lastScreen = lastClear >= 0
						? stripAnsi(outputBuffer.slice(lastClear))
						: plain.slice(-2000);
					let pass: boolean;
					if (cmd.mode === "root") {
						// Root mode: the visible screen should NOT contain
						// any mode bracket in the status/prompt area.
						pass = !lastScreen.includes("[script]")
							&& !lastScreen.includes("[builder]")
							&& !lastScreen.includes("[inspect]");
					} else {
						pass = lastScreen.toLowerCase().includes(cmd.mode.toLowerCase());
					}
					assertions.push({
						pass,
						command: cmd,
						message: pass
							? `ExpectMode passed: "${cmd.mode}"`
							: `ExpectMode failed: "${cmd.mode}" not visible in output`,
					});
					break;
				}

				case "ExpectPrompt": {
					// Check the last visible screen for the prompt text
					const lastClear = outputBuffer.lastIndexOf("\x1b[2J");
					const lastScreen = lastClear >= 0
						? stripAnsi(outputBuffer.slice(lastClear))
						: stripAnsi(outputBuffer.slice(-2000));
					const trimmed = cmd.prompt.trimEnd();
					const pass = lastScreen.includes(trimmed);
					assertions.push({
						pass,
						command: cmd,
						message: pass
							? `ExpectPrompt passed: "${cmd.prompt}"`
							: `ExpectPrompt failed: "${cmd.prompt}" not found in output`,
					});
					break;
				}

				case "Snapshot": {
					// In pty mode, snapshot captures the full output buffer
					assertions.push({
						pass: true,
						command: cmd,
						message: `Snapshot: ${cmd.name}`,
					});
					break;
				}

				case "Annotation": {
					const duration = cmd.duration ?? 2000;
					markers.push({ time: elapsed(), text: cmd.text });
					await delay(duration);
					break;
				}

				case "Hide": {
					hidden = true;
					break;
				}

				case "Show": {
					hidden = false;
					break;
				}
			}
		}
	} finally {
		// Gracefully exit the app
		proc.write("\x03"); // Ctrl+C
		await delay(200);
		proc.kill();
		dataHandler.dispose();
	}

	return { events, inputs, assertions, markers, width, height };
}
