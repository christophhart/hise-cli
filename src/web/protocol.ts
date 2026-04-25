// ── Web frontend WebSocket protocol ─────────────────────────────────
//
// Discriminated unions on `kind`. Imported by both server (Bun) and
// client (browser). Requests carry `id`, responses echo it. Unsolicited
// server pushes (progress, observer events) have no id.

import type { CommandResult, TreeNode } from "../engine/result.js";
import type { CompletionItem, ModeId } from "../engine/modes/mode.js";
import type {
	WizardAnswers,
	WizardDefinition,
	WizardProgress,
	WizardValidation,
} from "../engine/wizard/types.js";
import type { ObserverEvent } from "../observer/protocol.js";

// ── Client → Server ─────────────────────────────────────────────────

export type ClientMsg =
	| { kind: "submit-input"; id: string; line: string }
	| { kind: "complete"; id: string; line: string; cursor: number }
	| {
		kind: "wizard-step";
		id: string;
		wizardId: string;
		answers: WizardAnswers;
		action: "next" | "back" | "submit" | "cancel";
	}
	| { kind: "open-file"; id: string; path: string }
	| { kind: "save-file"; id: string; path: string; content: string }
	| { kind: "run-script"; id: string; path: string; content: string }
	| { kind: "dry-run-script"; id: string; path: string; content: string }
	| {
		kind: "complete-document";
		id: string;
		path: string;
		document: string;
		line: number;
		column: number;
	}
	| { kind: "request-snapshot"; id: string }
	| { kind: "select-tree-node"; id: string; nodeId: string }
	| { kind: "ping"; id: string };

// ── Server → Client ─────────────────────────────────────────────────

export interface SessionStateSnapshot {
	modeStack: ModeId[];
	prompt: string;
	projectName: string | null;
	projectFolder: string | null;
}

export interface WizardLiveState {
	wizardId: string;
	definition: WizardDefinition;
	answers: WizardAnswers;
	currentTabIndex: number;
	validation: WizardValidation;
	running: boolean;
	doneResult?: CommandResult;
}

export interface CompletionPayload {
	items: CompletionItem[];
	from: number;
	to: number;
	label?: string;
}

export type ServerMsg =
	| { kind: "result"; id: string; result: CommandResult }
	| { kind: "completion"; id: string; payload: CompletionPayload | null }
	| { kind: "wizard-state"; state: WizardLiveState | null }
	| { kind: "wizard-progress"; progress: WizardProgress }
	| { kind: "file-content"; id: string; path: string; content: string }
	| { kind: "file-saved"; id: string; path: string }
	| { kind: "run-result"; id: string; result: CommandResult }
	| { kind: "session-state"; state: SessionStateSnapshot }
	| { kind: "tree"; tree: TreeNode | null }
	| { kind: "log"; level: "info" | "warn" | "error"; text: string }
	| { kind: "error"; id?: string; message: string; detail?: string }
	| { kind: "llm-event"; event: ObserverEvent }
	| { kind: "pong"; id: string };

// ── Wire helpers ────────────────────────────────────────────────────

export function encode(msg: ServerMsg | ClientMsg): string {
	return JSON.stringify(msg);
}

export function decodeClient(text: string): ClientMsg | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed && typeof parsed === "object" && "kind" in parsed) {
			return parsed as ClientMsg;
		}
	} catch {
		// fall through
	}
	return null;
}

export function decodeServer(text: string): ServerMsg | null {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed && typeof parsed === "object" && "kind" in parsed) {
			return parsed as ServerMsg;
		}
	} catch {
		// fall through
	}
	return null;
}
