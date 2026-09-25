// ── Sequence mode — timed event sequencer via inject_midi ───────────

import { isErrorResponse, isSuccessResponse } from "../hise.js";
import type { CommandResult } from "../result.js";
import { textResult, errorResult, markdownResult } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeSequence } from "../highlight/sequence.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";
import type {
	StoredSequenceDefinition,
	E2eDefinition,
	InjectMidiResponse,
	E2eResponse,
} from "./sequence-types.js";
import {
	parseEventLine,
	parseE2eEventLine,
	buildInjectPayload,
	buildE2ePayload,
	formatEventSummary,
	formatE2eEventSummary,
	sequenceDuration,
	extractName,
} from "./sequence-parser.js";

const SEQUENCE_COMMANDS = new Map<string, string>([
	["create", 'Start defining a named sequence: create "<name>"'],
	["e2e", 'Start defining a UI test: e2e "<name>"'],
	["flush", "End the current sequence definition"],
	["show", 'Show sequence details: show "<name>"'],
	["play", 'Execute a sequence (blocking): play "<name>"'],
	["record", 'Record sequence output to WAV: record "<name>" as <path>'],
	["stop", "Send all-notes-off"],
	["get", "Retrieve eval result from last playback: get <id>"],
	["help", "Show sequence mode commands"],
]);

export class SequenceMode implements Mode {
	readonly id: Mode["id"] = "sequence";
	readonly name = "Sequence";
	readonly accent = MODE_ACCENTS.sequence;
	readonly prompt = "[sequence] > ";
	private readonly completionEngine: CompletionEngine | null;

	private sequences = new Map<string, StoredSequenceDefinition>();
	private currentDef: StoredSequenceDefinition | null = null;
	private replResults = new Map<string, string>();

	constructor(completionEngine?: CompletionEngine) {
		this.completionEngine = completionEngine ?? null;
	}

	async onEnter(_session: SessionContext): Promise<void> {
		// Discard any in-progress definition from a previous session
		if (this.currentDef) {
			this.currentDef = null;
		}
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeSequence(value);
	}

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) {
			return { items: [], from: 0, to: input.length };
		}
		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;

		if (this.currentDef) {
			// Defining phase: suggest verbs after timestamp
			const items = this.completionEngine.completeSequence(trimmed);
			return { items, from: leadingSpaces, to: input.length, label: "Event types" };
		}

		const items = this.completionEngine.completeSequence(trimmed);
		return { items, from: leadingSpaces, to: input.length, label: "Sequence commands" };
	}

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		const trimmed = input.trim();
		if (!trimmed) return textResult("");

		// ── Defining phase ─────────────────────────────────────────
		if (this.currentDef) {
			const def = this.currentDef;
			const lower = trimmed.toLowerCase();
			if (lower === "flush") {
				return this.handleFlush();
			}
			if (lower === "help") {
				return this.showHelp();
			}
			// Parse as event line
			if (def.kind === "e2e") {
				const event = parseE2eEventLine(trimmed);
				if (typeof event === "string") return errorResult(event);
				def.events.push(event);
				return textResult(`  + ${formatE2eEventSummary(event)} at ${event.timestamp}ms`);
			}
			const event = parseEventLine(trimmed);
			if (typeof event === "string") return errorResult(event);
			def.events.push(event);
			return textResult(`  + ${formatEventSummary(event)} at ${event.timestamp}ms`);
		}

		// ── Command phase ──────────────────────────────────────────
		const firstSpace = trimmed.indexOf(" ");
		const command = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
		const args = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

		switch (command) {
			case "create": return this.handleCreate(args);
			case "e2e": return this.handleE2e(args);
			case "flush": return errorResult("No active definition. Use 'create' or 'e2e' first.");
			case "show": return this.handleShow(args);
			case "play": return this.handlePlay(args, session);
			case "record": return this.handleRecord(args, session);
			case "stop": return this.handleStop(session);
			case "get": return this.handleGet(args);
			case "help": return this.showHelp();
			default: return errorResult(`Unknown command: "${command}". Type "help" for available commands.`);
		}
	}

	// ── Command handlers ───────────────────────────────────────────

	private handleCreate(args: string): CommandResult {
		if (this.currentDef) {
			return errorResult(`Already defining sequence "${this.currentDef.name}". Use 'flush' to finish.`);
		}
		const name = extractName(args);
		if (!name) {
			return errorResult('Usage: create "<name>"');
		}
		this.currentDef = { kind: "midi", name, events: [] };
		return textResult(`Defining sequence "${name}" — enter events, then flush.`);
	}

	private handleE2e(args: string): CommandResult {
		if (this.currentDef) {
			const kind = this.currentDef.kind === "e2e" ? "E2E test" : "sequence";
			return errorResult(`Already defining ${kind} "${this.currentDef.name}". Use 'flush' to finish.`);
		}
		const name = extractName(args);
		if (!name) return errorResult('Usage: e2e "<name>"');
		this.currentDef = { kind: "e2e", name, events: [] };
		return textResult(`Defining E2E test "${name}" — enter interactions, then flush.`);
	}

	private handleFlush(): CommandResult {
		const def = this.currentDef!;
		def.events.sort((a, b) => a.timestamp - b.timestamp);
		this.sequences.set(def.name, def);
		this.currentDef = null;
		const dur = sequenceDuration(def.events);
		const label = def.kind === "e2e" ? "E2E test" : "Sequence";
		return textResult(`${label} "${def.name}" defined: ${def.events.length} events, ${dur}ms total.`);
	}

	private handleShow(args: string): CommandResult {
		const name = extractName(args);
		if (!name) return errorResult('Usage: show "<name>"');

		const def = this.sequences.get(name);
		if (!def) return errorResult(`Unknown sequence: "${name}"`);

		const dur = sequenceDuration(def.events);
		const rows = isE2eDefinition(def)
			? def.events.map((e, i) => `| ${i + 1} | ${e.timestamp}ms | ${e.type} | ${formatE2eEventSummary(e)} |`)
			: def.events.map((e, i) => `| ${i + 1} | ${e.timestamp}ms | ${e.type} | ${formatEventSummary(e)} |`);
		const title = def.kind === "e2e" ? "E2E" : "Sequence";

		return markdownResult(`## ${title}: ${def.name}

| | | |
|---|---|---|
| Events | ${def.events.length} |
| Duration | ${dur}ms |

| # | Time | Type | Details |
|---|------|------|---------|
${rows.join("\n")}`);
	}

	private async handlePlay(args: string, session: SessionContext): Promise<CommandResult> {
		const name = extractName(args);
		if (!name) return errorResult('Usage: play "<name>"');

		const def = this.sequences.get(name);
		if (!def) return errorResult(`Unknown sequence: "${name}"`);

		if (!session.connection) {
			return errorResult("No HISE connection.");
		}

		if (def.kind === "e2e") {
			const response = await session.connection.post("/api/testing/e2e", buildE2ePayload(def));
			if (isErrorResponse(response)) return errorResult(response.message);
			if (!isSuccessResponse(response)) return errorResult("Unexpected response from HISE");
			return this.processE2eResponse(response, name);
		}

		const payload = buildInjectPayload(def, { blocking: true });
		const response = await session.connection.post("/api/testing/sequence", payload);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isSuccessResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}

		return this.processPlayResponse(response, name);
	}

	private async handleRecord(args: string, session: SessionContext): Promise<CommandResult> {
		// record "<name>" as <path>
		const asIdx = args.lastIndexOf(" as ");
		if (asIdx === -1) return errorResult('Usage: record "<name>" as <path>');

		const namePart = args.slice(0, asIdx).trim();
		const rawPath = args.slice(asIdx + 4).trim();
		const recordPath = session.resolvePath?.(rawPath) ?? rawPath;

		const name = extractName(namePart);
		if (!name) return errorResult('Usage: record "<name>" as <path>');
		if (!recordPath) return errorResult("Missing output file path.");

		const def = this.sequences.get(name);
		if (!def) return errorResult(`Unknown sequence: "${name}"`);
		if (def.kind === "e2e") return errorResult("record is only available for MIDI sequences.");

		if (!session.connection) {
			return errorResult("No HISE connection.");
		}

		const payload = buildInjectPayload(def, { recordOutput: recordPath });
		const response = await session.connection.post("/api/testing/sequence", payload);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isSuccessResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}

		return this.processPlayResponse(response, name, recordPath);
	}

	private processPlayResponse(
		response: { result?: string | object | null; value?: unknown; [key: string]: unknown },
		name: string,
		recordPath?: string,
	): CommandResult {
		const data = extractResponseData(response);
		if (!data) {
			return textResult(`Sequence "${name}" sent.`);
		}

		// Store REPL results
		if (data.replResults) {
			for (const r of data.replResults) {
				this.replResults.set(r.id, String(r.value));
			}
		}

		const lines: string[] = [`Sequence "${name}" completed.`];
		if (data.eventsInSequence !== undefined) lines.push(`Events: ${data.eventsInSequence}`);
		if (data.durationMs !== undefined) lines.push(`Duration: ${data.durationMs}ms`);
		if (data.replResults && data.replResults.length > 0) {
			lines.push(`REPL results: ${data.replResults.length}`);
			for (const r of data.replResults) {
				lines.push(`  ${r.id} = ${r.value}`);
			}
		}
		if (recordPath) lines.push(`Recorded to: ${recordPath}`);

		return textResult(lines.join("\n"));
	}

	private processE2eResponse(
		response: { result?: string | object | null; value?: unknown; [key: string]: unknown },
		name: string,
	): CommandResult {
		const data = extractE2eResponseData(response);
		if (!data) return textResult(`E2E test "${name}" completed.`);

		if (data.replResults) {
			for (const r of data.replResults) this.replResults.set(r.id, String(r.value));
		}

		const lines: string[] = [`E2E test "${name}" completed.`];
		if (data.interactionsCompleted !== undefined) lines.push(`Interactions: ${data.interactionsCompleted}`);
		if (data.totalElapsedMs !== undefined) lines.push(`Duration: ${data.totalElapsedMs}ms`);
		if (data.replResults?.length) {
			lines.push(`REPL results: ${data.replResults.length}`);
			for (const r of data.replResults) lines.push(`  ${r.id} = ${r.value}`);
		}
		if (data.screenshots) {
			const screenshots = Object.values(data.screenshots);
			if (screenshots.length) {
				lines.push(`Screenshots: ${screenshots.length}`);
				for (const screenshot of screenshots) {
					lines.push(`  ${screenshot.id}${screenshot.filePath ? ` -> ${screenshot.filePath}` : ""}`);
				}
			}
		}
		return textResult(lines.join("\n"));
	}

	private async handleStop(session: SessionContext): Promise<CommandResult> {
		if (!session.connection) {
			return errorResult("No HISE connection.");
		}

		const payload = buildInjectPayload(
			{ name: "", events: [{ type: "allNotesOff", timestamp: 0 }] },
			{ blocking: true },
		);
		const response = await session.connection.post("/api/testing/sequence", payload);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		return textResult("All notes off.");
	}

	private handleGet(args: string): CommandResult {
		const id = args.trim();
		if (!id) return errorResult("Usage: get <id>");

		const value = this.replResults.get(id);
		if (value === undefined) {
			return errorResult(`No result for "${id}". Run a sequence or E2E test with eval first.`);
		}
		return textResult(value);
	}

	private showHelp(): CommandResult {
		const rows = [...SEQUENCE_COMMANDS.entries()].map(
			([cmd, desc]) => `| \`${cmd}\` | ${desc} |`,
		);
		return markdownResult(`## Sequence Commands

| Command | Description |
|---------|-------------|
${rows.join("\n")}

## Event Line Syntax (during define phase)

| Pattern | Description |
|---------|-------------|
| \`<time> play <note> [<vel>] [for <dur>]\` | MIDI note |
| \`<time> play <signal> [at <freq>] [for <dur>]\` | Test signal |
| \`<time> play sweep from <startFreq> to <endFreq> for <dur>\` | Sweep |
| \`<time> send CC <ctrl> <val>\` | CC message |
| \`<time> send pitchbend <val>\` | Pitchbend |
| \`<time> set <Proc.Param> <val>\` | Set attribute |
| \`<time> eval <expr> as <id>\` | Script eval |

## E2E Event Lines (during e2e definition)

| Pattern | Description |
|---------|-------------|
| \`<time> moveTo <componentId>\` | Move to a component |
| \`<time> click <componentId> [for <dur>]\` | Click a component |
| \`<time> doubleClick <componentId>\` | Double-click a component |
| \`<time> drag <componentId> by <x> <y> [for <dur>]\` | Drag a component |
| \`<time> selectMenuItem <text>\` | Select a menu item |
| \`<time> screenshot <id> [component <componentId>] [at <scale>]\` | Capture a screenshot |
| \`<time> eval <expr> as <id>\` | Evaluate HISEScript |`);
	}
}

function extractResponseData(
	response: { result?: string | object | null; value?: unknown; [key: string]: unknown },
): InjectMidiResponse | null {
	try {
		// New API: sequence fields are top-level
		if ("eventsInSequence" in response || "durationMs" in response || "replResults" in response) {
			return response as unknown as InjectMidiResponse;
		}
		if (response.value && typeof response.value === "object") {
			return response.value as InjectMidiResponse;
		}
		if (typeof response.result === "string" && response.result !== "") {
			return JSON.parse(response.result) as InjectMidiResponse;
		}
		if (response.result && typeof response.result === "object") {
			return response.result as InjectMidiResponse;
		}
	} catch {
		// parse failure
	}
	return null;
}

function extractE2eResponseData(
	response: { result?: string | object | null; value?: unknown; [key: string]: unknown },
): E2eResponse | null {
	try {
		if ("interactionsCompleted" in response || "replResults" in response || "screenshots" in response) {
			return response as unknown as E2eResponse;
		}
		if (response.value && typeof response.value === "object") {
			return response.value as E2eResponse;
		}
		if (typeof response.result === "string" && response.result !== "") {
			return JSON.parse(response.result) as E2eResponse;
		}
		if (response.result && typeof response.result === "object") {
			return response.result as E2eResponse;
		}
	} catch {
		// parse failure
	}
	return null;
}

function isE2eDefinition(def: StoredSequenceDefinition): def is E2eDefinition {
	return def.kind === "e2e";
}
