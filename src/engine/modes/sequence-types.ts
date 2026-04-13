// ── Sequence types — timed event definitions for inject_midi ────────

export interface NoteEvent {
	type: "note";
	timestamp: number;
	noteNumber: number;
	velocity: number;       // 0.0–1.0 (normalized)
	duration: number;       // ms
	channel: number;        // 1–16
}

export interface CcEvent {
	type: "cc";
	timestamp: number;
	controller: number;     // 0–127
	value: number;          // 0–127
	channel: number;
}

export interface PitchbendEvent {
	type: "pitchbend";
	timestamp: number;
	value: number;          // 0–16383
	channel: number;
}

export interface SetAttributeEvent {
	type: "set_attribute";
	timestamp: number;
	processorId: string;
	parameterId: string;
	value: number;
}

export interface ReplEvent {
	type: "repl";
	timestamp: number;
	expression: string;
	moduleId: string;
	id: string;
}

export interface TestSignalEvent {
	type: "testsignal";
	timestamp: number;
	signal: TestSignalType;
	duration: number;
	frequency?: number;
	startFrequency?: number;
	endFrequency?: number;
}

export interface AllNotesOffEvent {
	type: "allNotesOff";
	timestamp: number;
}

export type TestSignalType = "sine" | "saw" | "sweep" | "dirac" | "noise" | "silence";

export const TEST_SIGNAL_TYPES: readonly TestSignalType[] = [
	"sine", "saw", "sweep", "dirac", "noise", "silence",
] as const;

export type SequenceEvent =
	| NoteEvent
	| CcEvent
	| PitchbendEvent
	| SetAttributeEvent
	| ReplEvent
	| TestSignalEvent
	| AllNotesOffEvent;

export interface SequenceDefinition {
	name: string;
	events: SequenceEvent[];
}

export interface InjectMidiPayload {
	messages: Record<string, unknown>[];
	blocking?: boolean;
	recordOutput?: string;
}

export interface InjectMidiResponse {
	isPlaying: boolean;
	durationMs: number;
	activeNotes: number;
	eventsInSequence: number;
	playedEvents: number;
	progress: number;
	replResults?: ReplResult[];
}

export interface ReplResult {
	id: string;
	expression: string;
	moduleId: string;
	timestamp: number;
	success: boolean;
	value: unknown;
}
