// ── Sequence parser — pure functions for DSL parsing ────────────────

import type {
	SequenceEvent,
	SequenceDefinition,
	InjectMidiPayload,
	TestSignalType,
} from "./sequence-types.js";
import { TEST_SIGNAL_TYPES } from "./sequence-types.js";

// ── Unit parsers ────────────────────��──────────────────────────────

/** Parse a duration string to milliseconds. Accepts `500ms`, `1.2s`. */
export function parseDuration(s: string): number | null {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(ms|s)$/i);
	if (!match) return null;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value < 0) return null;
	return match[2]!.toLowerCase() === "s" ? value * 1000 : value;
}

/** Parse a frequency string to Hz. Accepts `440Hz`, `1kHz`, `20kHz`. */
export function parseFrequency(s: string): number | null {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(k?Hz)$/i);
	if (!match) return null;
	const value = Number(match[1]);
	if (!Number.isFinite(value) || value < 0) return null;
	return match[2]!.toLowerCase() === "khz" ? value * 1000 : value;
}

// ── Note name parser (C3 = 60) ────────────────────────────────────

const NOTE_OFFSETS: Record<string, number> = {
	C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

/**
 * Parse a note name or MIDI number. C3 = 60.
 * Accepts: `C3`, `C#4`, `Db3`, `64` (raw MIDI number).
 */
export function parseNoteOrNumber(s: string): number | null {
	// Try raw MIDI number first
	const num = Number(s);
	if (Number.isInteger(num) && num >= 0 && num <= 127) return num;

	// Note name: [A-G][#b]?[0-9]
	const match = s.match(/^([A-Ga-g])(#|b)?(\d)$/);
	if (!match) return null;

	const letter = match[1]!.toUpperCase();
	const accidental = match[2] ?? "";
	const octave = Number(match[3]);

	const base = NOTE_OFFSETS[letter];
	if (base === undefined) return null;

	let noteNumber = (octave + 2) * 12 + base;
	if (accidental === "#") noteNumber++;
	if (accidental === "b") noteNumber--;

	if (noteNumber < 0 || noteNumber > 127) return null;
	return noteNumber;
}

/**
 * Normalize velocity: values > 1 are treated as 0–127 range and divided by 127.
 * Values 0.0–1.0 are kept as-is.
 */
export function normalizeVelocity(v: number): number | null {
	if (!Number.isFinite(v) || v < 0) return null;
	if (v > 1) {
		if (v > 127) return null;
		return v / 127;
	}
	return v;
}

// ── Event line parser ──────────────���───────────────────────────────

/**
 * Parse a single event line: `<timestamp> <verb> <args...>`
 * Returns a SequenceEvent on success, or an error string.
 */
export function parseEventLine(line: string): SequenceEvent | string {
	const tokens = tokenizeLine(line);
	if (tokens.length < 2) return "Expected: <timestamp> <verb> <args...>";

	const timestamp = parseDuration(tokens[0]!);
	if (timestamp === null) return `Invalid timestamp: "${tokens[0]}"`;

	const verb = tokens[1]!.toLowerCase();
	const args = tokens.slice(2);

	switch (verb) {
		case "play": return parsePlay(timestamp, args);
		case "send": return parseSend(timestamp, args);
		case "set": return parseSet(timestamp, args);
		case "eval": return parseEval(timestamp, args);
		default: return `Unknown verb: "${tokens[1]}". Expected: play, send, set, eval`;
	}
}

/** Tokenize a line respecting quoted strings. */
function tokenizeLine(line: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let inQuote = false;
	let quoteChar = "";

	for (const ch of line.trim()) {
		if (inQuote) {
			if (ch === quoteChar) {
				inQuote = false;
			} else {
				current += ch;
			}
		} else if (ch === '"' || ch === "'") {
			inQuote = true;
			quoteChar = ch;
		} else if (ch === " " || ch === "\t") {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) tokens.push(current);
	return tokens;
}

// ── Verb parsers ───────────────────────────────────────────────────

function parsePlay(timestamp: number, args: string[]): SequenceEvent | string {
	if (args.length === 0) return "play requires arguments: <note> or <signal>";

	const first = args[0]!;

	// Check if first arg is a test signal type
	if (isTestSignal(first)) {
		return parsePlaySignal(timestamp, first, args.slice(1));
	}

	// Otherwise, it's a note
	return parsePlayNote(timestamp, args);
}

function isTestSignal(s: string): s is TestSignalType {
	return TEST_SIGNAL_TYPES.includes(s.toLowerCase() as TestSignalType);
}

function parsePlayNote(timestamp: number, args: string[]): SequenceEvent | string {
	// play <note> [<vel>] [for <dur>]
	const noteNumber = parseNoteOrNumber(args[0]!);
	if (noteNumber === null) return `Invalid note: "${args[0]}"`;

	let velocity = 1.0;
	let duration = 500;
	let idx = 1;

	// Optional velocity (number that isn't preceded by "for")
	if (idx < args.length && args[idx]!.toLowerCase() !== "for") {
		const rawVel = Number(args[idx]);
		if (Number.isFinite(rawVel)) {
			const normVel = normalizeVelocity(rawVel);
			if (normVel === null) return `Invalid velocity: "${args[idx]}"`;
			velocity = normVel;
			idx++;
		}
	}

	// Optional "for <duration>"
	if (idx < args.length && args[idx]!.toLowerCase() === "for") {
		idx++;
		if (idx >= args.length) return "Expected duration after 'for'";
		const dur = parseDuration(args[idx]!);
		if (dur === null) return `Invalid duration: "${args[idx]}"`;
		duration = dur;
		idx++;
	}

	return {
		type: "note",
		timestamp,
		noteNumber,
		velocity,
		duration,
		channel: 1,
	};
}

function parsePlaySignal(timestamp: number, signal: string, args: string[]): SequenceEvent | string {
	const signalType = signal.toLowerCase() as TestSignalType;

	// Sweep: play sweep from <startFreq> to <endFreq> for <dur>
	if (signalType === "sweep") {
		return parseSweep(timestamp, args);
	}

	// Other signals: play <signal> [at <freq>] [for <dur>]
	let frequency: number | undefined;
	let duration = 500;
	let idx = 0;

	// Optional "at <freq>"
	if (idx < args.length && args[idx]!.toLowerCase() === "at") {
		idx++;
		if (idx >= args.length) return "Expected frequency after 'at'";
		const freq = parseFrequency(args[idx]!);
		if (freq === null) return `Invalid frequency: "${args[idx]}"`;
		frequency = freq;
		idx++;
	}

	// Optional "for <duration>"
	if (idx < args.length && args[idx]!.toLowerCase() === "for") {
		idx++;
		if (idx >= args.length) return "Expected duration after 'for'";
		const dur = parseDuration(args[idx]!);
		if (dur === null) return `Invalid duration: "${args[idx]}"`;
		duration = dur;
		idx++;
	}

	return {
		type: "testsignal",
		timestamp,
		signal: signalType,
		duration,
		frequency,
	};
}

function parseSweep(timestamp: number, args: string[]): SequenceEvent | string {
	// from <startFreq> to <endFreq> for <dur>
	let idx = 0;
	if (idx >= args.length || args[idx]!.toLowerCase() !== "from") {
		return "sweep requires: from <startFreq> to <endFreq> for <dur>";
	}
	idx++;

	if (idx >= args.length) return "Expected start frequency after 'from'";
	const startFrequency = parseFrequency(args[idx]!);
	if (startFrequency === null) return `Invalid start frequency: "${args[idx]}"`;
	idx++;

	if (idx >= args.length || args[idx]!.toLowerCase() !== "to") {
		return "Expected 'to' after start frequency";
	}
	idx++;

	if (idx >= args.length) return "Expected end frequency after 'to'";
	const endFrequency = parseFrequency(args[idx]!);
	if (endFrequency === null) return `Invalid end frequency: "${args[idx]}"`;
	idx++;

	let duration = 500;
	if (idx < args.length && args[idx]!.toLowerCase() === "for") {
		idx++;
		if (idx >= args.length) return "Expected duration after 'for'";
		const dur = parseDuration(args[idx]!);
		if (dur === null) return `Invalid duration: "${args[idx]}"`;
		duration = dur;
	}

	return {
		type: "testsignal",
		timestamp,
		signal: "sweep",
		duration,
		startFrequency,
		endFrequency,
	};
}

function parseSend(timestamp: number, args: string[]): SequenceEvent | string {
	if (args.length === 0) return "send requires: CC <ctrl> <val> or pitchbend <val>";

	const subtype = args[0]!.toLowerCase();

	if (subtype === "cc") {
		if (args.length < 3) return "send CC requires: <controller> <value>";
		const controller = Number(args[1]);
		const value = Number(args[2]);
		if (!Number.isInteger(controller) || controller < 0 || controller > 127) {
			return `Invalid CC controller: "${args[1]}" (0-127)`;
		}
		if (!Number.isInteger(value) || value < 0 || value > 127) {
			return `Invalid CC value: "${args[2]}" (0-127)`;
		}
		return { type: "cc", timestamp, controller, value, channel: 1 };
	}

	if (subtype === "pitchbend") {
		if (args.length < 2) return "send pitchbend requires: <value>";
		const value = Number(args[1]);
		if (!Number.isInteger(value) || value < 0 || value > 16383) {
			return `Invalid pitchbend value: "${args[1]}" (0-16383)`;
		}
		return { type: "pitchbend", timestamp, value, channel: 1 };
	}

	return `Unknown send type: "${args[0]}". Expected: CC, pitchbend`;
}

function parseSet(timestamp: number, args: string[]): SequenceEvent | string {
	// set <Processor.Param> <value>
	if (args.length < 2) return "set requires: <Processor.Param> <value>";

	const path = args[0]!;
	const dotIdx = path.lastIndexOf(".");
	if (dotIdx === -1 || dotIdx === 0 || dotIdx === path.length - 1) {
		return `Invalid parameter path: "${path}". Expected: ProcessorId.ParameterName`;
	}

	const processorId = path.slice(0, dotIdx);
	const parameterId = path.slice(dotIdx + 1);
	const value = Number(args[1]);
	if (!Number.isFinite(value)) return `Invalid value: "${args[1]}"`;

	return { type: "set_attribute", timestamp, processorId, parameterId, value };
}

function parseEval(timestamp: number, args: string[]): SequenceEvent | string {
	// eval <expression> as <id>
	const asIdx = args.lastIndexOf("as");
	if (asIdx === -1 || asIdx === 0 || asIdx === args.length - 1) {
		return "eval requires: <expression> as <id>";
	}

	const expression = args.slice(0, asIdx).join(" ");
	const id = args[asIdx + 1]!;

	return {
		type: "repl",
		timestamp,
		expression,
		moduleId: "Interface",
		id,
	};
}

// ── Payload builder ──────────────────��─────────────────────────────

export interface PayloadOptions {
	blocking?: boolean;
	recordOutput?: string;
}

export function buildInjectPayload(
	def: SequenceDefinition,
	opts: PayloadOptions = {},
): InjectMidiPayload {
	const messages = def.events.map(eventToMessage);
	const payload: InjectMidiPayload = { messages };
	if (opts.blocking !== undefined) payload.blocking = opts.blocking;
	if (opts.recordOutput !== undefined) {
		payload.recordOutput = opts.recordOutput;
		payload.blocking = true;
	}
	return payload;
}

function eventToMessage(event: SequenceEvent): Record<string, unknown> {
	switch (event.type) {
		case "note":
			return {
				type: "note",
				noteNumber: event.noteNumber,
				velocity: event.velocity,
				duration: event.duration,
				channel: event.channel,
				timestamp: event.timestamp,
			};
		case "cc":
			return {
				type: "cc",
				controller: event.controller,
				value: event.value,
				channel: event.channel,
				timestamp: event.timestamp,
			};
		case "pitchbend":
			return {
				type: "pitchbend",
				value: event.value,
				channel: event.channel,
				timestamp: event.timestamp,
			};
		case "set_attribute":
			return {
				type: "set_attribute",
				processorId: event.processorId,
				parameterId: event.parameterId,
				value: event.value,
				timestamp: event.timestamp,
			};
		case "repl":
			return {
				type: "repl",
				expression: event.expression,
				moduleId: event.moduleId,
				id: event.id,
				timestamp: event.timestamp,
			};
		case "testsignal": {
			const msg: Record<string, unknown> = {
				type: "testsignal",
				signal: event.signal,
				duration: event.duration,
				timestamp: event.timestamp,
			};
			if (event.frequency !== undefined) msg.frequency = event.frequency;
			if (event.startFrequency !== undefined) msg.startFrequency = event.startFrequency;
			if (event.endFrequency !== undefined) msg.endFrequency = event.endFrequency;
			return msg;
		}
		case "allNotesOff":
			return { type: "allNotesOff", timestamp: event.timestamp };
	}
}

// ── Human-readable summaries ───────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteNumberToName(n: number): string {
	const octave = Math.floor(n / 12) - 2;
	const name = NOTE_NAMES[n % 12]!;
	return `${name}${octave}`;
}

function formatMs(ms: number): string {
	if (ms >= 1000) return `${ms / 1000}s`;
	return `${ms}ms`;
}

export function formatEventSummary(event: SequenceEvent): string {
	switch (event.type) {
		case "note":
			return `note ${noteNumberToName(event.noteNumber)} vel=${Math.round(event.velocity * 127)} dur=${formatMs(event.duration)}`;
		case "cc":
			return `CC ${event.controller} = ${event.value}`;
		case "pitchbend":
			return `pitchbend = ${event.value}`;
		case "set_attribute":
			return `set ${event.processorId}.${event.parameterId} = ${event.value}`;
		case "repl":
			return `eval "${event.expression}" as ${event.id}`;
		case "testsignal":
			if (event.signal === "sweep") {
				return `sweep ${event.startFrequency ?? 20}Hz-${event.endFrequency ?? 20000}Hz dur=${formatMs(event.duration)}`;
			}
			return `${event.signal}${event.frequency ? ` ${event.frequency}Hz` : ""} dur=${formatMs(event.duration)}`;
		case "allNotesOff":
			return "all notes off";
	}
}

/** Compute total duration of a sequence (last event timestamp + its duration). */
export function sequenceDuration(events: SequenceEvent[]): number {
	let max = 0;
	for (const e of events) {
		const eventDur = "duration" in e && typeof e.duration === "number" ? e.duration : 0;
		const end = e.timestamp + eventDur;
		if (end > max) max = end;
	}
	return max;
}

/** Extract the quoted name from a command like `create "My Sequence"` or `create MySequence`. */
export function extractName(args: string): string | null {
	const trimmed = args.trim();
	// Quoted
	const quoted = trimmed.match(/^["'](.+?)["']$/);
	if (quoted) return quoted[1]!;
	// Bare word (no spaces)
	if (trimmed && !trimmed.includes(" ")) return trimmed;
	return null;
}
