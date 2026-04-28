// ── Tape Parser — parse .tape files into TapeCommand[] ──────────────

import type {
	SetKey,
	TapeCommand,
} from "./types.js";
import { unescapeQuotes } from "../string-utils.js";

const SET_KEYS = new Set<string>([
	"Shell", "FontSize", "Width", "Height", "TypingSpeed", "Theme",
	"Padding", "Framerate", "PlaybackSpeed", "LetterSpacing", "LineHeight",
	"CursorBlink", "WindowBar", "WindowBarSize", "BorderRadius",
	"Margin", "MarginFill",
]);

export interface ParseResult {
	commands: TapeCommand[];
	errors: Array<{ line: number; message: string }>;
}

export function parseTape(source: string): ParseResult {
	const commands: TapeCommand[] = [];
	const errors: Array<{ line: number; message: string }> = [];
	const lines = source.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const lineNum = i + 1;
		const raw = lines[i].trim();

		// Skip empty lines and comments
		if (raw === "" || raw.startsWith("#")) {
			continue;
		}

		const parsed = parseLine(raw, lineNum);
		if (parsed.error) {
			errors.push({ line: lineNum, message: parsed.error });
		} else if (parsed.command) {
			commands.push(parsed.command);
		}
	}

	return { commands, errors };
}

interface LineResult {
	command?: TapeCommand;
	error?: string;
}

function parseLine(line: string, _lineNum: number): LineResult {
	const parts = splitTokens(line);
	if (parts.length === 0) {
		return {};
	}

	const verb = parts[0];

	switch (verb) {
		case "Output":
			return parseOutput(parts);
		case "Set":
			return parseSet(parts);
		case "Type":
			return parseType(line);
		case "Sleep":
			return parseSleep(parts);
		case "Wait":
			return parseWait(line);
		case "Expect":
			return parseExpect(line);
		case "ExpectMode":
			return parseExpectMode(line);
		case "ExpectPrompt":
			return parseExpectPrompt(line);
		case "Snapshot":
			return parseSnapshot(parts);
		case "Annotation":
			return parseAnnotation(line);
		case "Hide":
			return { command: { type: "Hide" } };
		case "Show":
			return { command: { type: "Show" } };
		case "ShowKeys":
			return { command: { type: "ShowKeys" } };
		case "HideKeys":
			return { command: { type: "HideKeys" } };
		// Key names
		case "Enter":
		case "Backspace":
		case "Delete":
		case "Tab":
		case "Escape":
		case "Up":
		case "Down":
		case "Left":
		case "Right":
		case "PageUp":
		case "PageDown":
		case "Home":
		case "End":
		case "Space":
			return parseKey(parts);
		default:
			// Check for Ctrl+X / Alt+X patterns
			if (/^(Ctrl|Alt)\+./.test(verb)) {
				return parseKey(parts);
			}
			return { error: `Unknown command: ${verb}` };
	}
}

function parseOutput(parts: string[]): LineResult {
	if (parts.length < 2) {
		return { error: "Output requires a file path" };
	}
	return { command: { type: "Output", path: parts[1] } };
}

function parseSet(parts: string[]): LineResult {
	if (parts.length < 3) {
		return { error: "Set requires a key and value" };
	}
	const key = parts[1];

	// hise-cli extension: Set Connection "mock" / "live"
	if (key === "Connection") {
		const value = stripQuotesSimple(parts.slice(2).join(" "));
		if (value !== "mock" && value !== "live") {
			return { error: `Invalid connection type: ${value}. Use "mock" or "live".` };
		}
		return { command: { type: "SetConnection", connection: value } };
	}

	// hise-cli extension: Set MockResponse "/api/repl" {...}
	if (key === "MockResponse") {
		if (parts.length < 4) {
			return { error: "Set MockResponse requires an endpoint and response JSON" };
		}
		const endpoint = stripQuotesSimple(parts[2]);
		const response = parts.slice(3).join(" ");
		return { command: { type: "SetMockResponse", endpoint, response } };
	}

	if (!SET_KEYS.has(key)) {
		return { error: `Unknown Set key: ${key}` };
	}
	return {
		command: {
			type: "Set",
			key: key as SetKey,
			value: parts.slice(2).join(" "),
		},
	};
}

function stripQuotesSimple(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1);
	}
	return s;
}

function parseType(line: string): LineResult {
	// Type "text" [speed]  or  Type text
	const match = line.match(
		/^Type\s+"((?:[^"\\]|\\.)*)"\s*(?:(\d+(?:\.\d+)?)(ms|s))?$/,
	);
	if (match) {
		const text = unescapeQuotes(match[1]).replace(/\\n/g, "\n");
		const speed = match[2] ? parseFloat(match[2]) : undefined;
		return { command: { type: "Type", text, speed } };
	}

	// Type without quotes — rest of line is the text
	const rest = line.slice(5).trim();
	if (!rest) {
		return { error: "Type requires text" };
	}
	return { command: { type: "Type", text: rest } };
}

function parseSleep(parts: string[]): LineResult {
	if (parts.length < 2) {
		return { error: "Sleep requires a duration" };
	}
	const raw = parts[1];
	const match = raw.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
	if (!match) {
		return { error: `Invalid sleep duration: ${raw}` };
	}
	const value = parseFloat(match[1]);
	const unit = (match[2] || "ms") as "ms" | "s";
	return { command: { type: "Sleep", duration: value, unit } };
}

function parseWait(line: string): LineResult {
	// Wait "pattern" [timeout]
	const match = line.match(
		/^Wait\s+"((?:[^"\\]|\\.)*)"\s*(?:(\d+(?:\.\d+)?)(ms|s))?$/,
	);
	if (!match) {
		return { error: "Wait requires a quoted pattern" };
	}
	const pattern = unescapeQuotes(match[1]);
	const timeout = match[2]
		? parseFloat(match[2]) * (match[3] === "s" ? 1000 : 1)
		: undefined;
	return { command: { type: "Wait", pattern, timeout } };
}

function parseExpect(line: string): LineResult {
	// Expect "pattern" [region]
	const match = line.match(
		/^Expect\s+"((?:[^"\\]|\\.)*)"\s*(?:(output|statusbar|input))?$/,
	);
	if (!match) {
		return { error: "Expect requires a quoted pattern" };
	}
	const pattern = unescapeQuotes(match[1]);
	const region = match[2] as
		| "output"
		| "statusbar"
		| "input"
		| undefined;
	return { command: { type: "Expect", pattern, region } };
}

function parseExpectMode(line: string): LineResult {
	const match = line.match(/^ExpectMode\s+"((?:[^"\\]|\\.)*)"\s*$/);
	if (!match) {
		return { error: "ExpectMode requires a quoted mode name" };
	}
	const mode = unescapeQuotes(match[1]);
	return { command: { type: "ExpectMode", mode } };
}

function parseExpectPrompt(line: string): LineResult {
	const match = line.match(/^ExpectPrompt\s+"((?:[^"\\]|\\.)*)"\s*$/);
	if (!match) {
		return { error: "ExpectPrompt requires a quoted prompt string" };
	}
	const prompt = unescapeQuotes(match[1]);
	return { command: { type: "ExpectPrompt", prompt } };
}

function parseSnapshot(parts: string[]): LineResult {
	if (parts.length < 2) {
		return { error: "Snapshot requires a name" };
	}
	return { command: { type: "Snapshot", name: parts[1] } };
}

function parseAnnotation(line: string): LineResult {
	// Annotation "text" [duration]
	const match = line.match(
		/^Annotation\s+"((?:[^"\\]|\\.)*)"\s*(?:(\d+(?:\.\d+)?)(ms|s))?$/,
	);
	if (!match) {
		return { error: "Annotation requires quoted text" };
	}
	const text = unescapeQuotes(match[1]);
	const duration = match[2]
		? parseFloat(match[2]) * (match[3] === "s" ? 1000 : 1)
		: undefined;
	return { command: { type: "Annotation", text, duration } };
}

function parseKey(parts: string[]): LineResult {
	const key = parts[0];
	const count = parts.length > 1 ? parseInt(parts[1], 10) : undefined;
	if (count !== undefined && isNaN(count)) {
		return { error: `Invalid key repeat count: ${parts[1]}` };
	}
	return { command: { type: "Key", key, count } };
}

// Split line into tokens, respecting quoted strings
function splitTokens(line: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuote = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"' && (i === 0 || line[i - 1] !== "\\")) {
			inQuote = !inQuote;
			current += ch;
		} else if (ch === " " && !inQuote) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) {
		tokens.push(current);
	}
	return tokens;
}
