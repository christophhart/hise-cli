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
	kind?: "midi";
}

export type E2eActionType = "moveTo" | "click" | "doubleClick" | "drag" | "selectMenuItem" | "screenshot" | "repl";

export interface E2eEventBase {
	timestamp: number;
	type: E2eActionType;
}

export interface E2eTargetEvent extends E2eEventBase {
	type: "moveTo" | "click" | "doubleClick";
	target: string;
	duration?: number;
}

export interface E2eDragEvent extends E2eEventBase {
	type: "drag";
	target: string;
	delta: { x: number; y: number };
	duration?: number;
}

export interface E2eMenuEvent extends E2eEventBase {
	type: "selectMenuItem";
	menuItemText: string;
	duration?: number;
}

export interface E2eScreenshotEvent extends E2eEventBase {
	type: "screenshot";
	id: string;
	componentId?: string;
	scale?: number;
}

export interface E2eReplEvent extends E2eEventBase {
	type: "repl";
	expression: string;
	id: string;
}

export type E2eEvent = E2eTargetEvent | E2eDragEvent | E2eMenuEvent | E2eScreenshotEvent | E2eReplEvent;

export interface E2eDefinition {
	kind: "e2e";
	name: string;
	events: E2eEvent[];
}

export type StoredSequenceDefinition = SequenceDefinition | E2eDefinition;

export interface InjectMidiPayload {
	messages: Record<string, unknown>[];
	blocking?: boolean;
	recordOutput?: string;
}

export interface E2ePayload {
	interactions: Record<string, unknown>[];
	verbose?: boolean;
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

export interface E2eScreenshotResult {
	id: string;
	moduleId?: string;
	componentId?: string;
	width?: number;
	height?: number;
	scale?: number;
	sizeKB?: number;
	filePath?: string;
}

export interface E2eResponse {
	interactionsCompleted?: number;
	totalElapsedMs?: number;
	replResults?: ReplResult[];
	screenshots?: Record<string, E2eScreenshotResult>;
}
