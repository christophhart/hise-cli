// ── Zustand store — client-side session mirror ──────────────────────

import { create } from "zustand";
import type {
	CompletionPayload,
	ServerMsg,
	SessionStateSnapshot,
	WizardLiveState,
} from "../../protocol.js";
import type { CommandResult, TreeNode } from "../../../engine/result.js";
import type { ObserverEvent } from "../../../observer/protocol.js";

export type OutputEntrySource = "user" | "llm";

export interface OutputEntry {
	id: string;
	source: OutputEntrySource;
	command?: string;
	result: CommandResult;
	/** Mode active when the command was issued (root-level if from REPL prompt). */
	modeId?: string;
}

export interface ToastEntry {
	id: string;
	level: "info" | "warn" | "error";
	text: string;
}

export interface AppState {
	// Connection
	connected: boolean;

	// Session mirror
	sessionState: SessionStateSnapshot;
	tree: TreeNode | null;

	// REPL output log
	output: OutputEntry[];
	currentInput: string;

	// Completion popup
	completion: CompletionPayload | null;
	completionFor: string | null; // request id

	// Wizard
	wizard: WizardLiveState | null;

	// Editor
	editor: {
		visible: boolean;
		path: string | null;
		content: string;
	};

	// Toasts
	toasts: ToastEntry[];

	// REPL command history (most-recent last)
	history: string[];
	historyIndex: number | null;  // null = current draft
	draft: string;

	// Mutators
	setConnected(c: boolean): void;
	applyServerMsg(msg: ServerMsg): void;
	setCurrentInput(line: string): void;
	clearCompletion(): void;
	dismissToast(id: string): void;
	pushUserCommand(command: string, result: CommandResult, modeId?: string): void;
	pushLlmEvent(event: ObserverEvent): void;
	setTree(tree: TreeNode | null): void;
	setEditorState(state: AppState["editor"]): void;
	pushHistory(line: string): void;
	historyUp(currentValue: string): string | null;
	historyDown(): string | null;
}

const initialSession: SessionStateSnapshot = {
	modeStack: ["root"],
	prompt: "›",
	projectName: null,
	projectFolder: null,
};

let nextEntryId = 0;
const newId = () => `e-${++nextEntryId}`;

export const useStore = create<AppState>((set, get) => ({
	connected: false,
	sessionState: initialSession,
	tree: null,
	output: [],
	currentInput: "",
	completion: null,
	completionFor: null,
	wizard: null,
	editor: { visible: false, path: null, content: "" },
	toasts: [],
	history: [],
	historyIndex: null,
	draft: "",

	setConnected(c) {
		set({ connected: c });
	},

	setCurrentInput(line) {
		set({ currentInput: line });
	},

	clearCompletion() {
		set({ completion: null, completionFor: null });
	},

	dismissToast(id) {
		set({ toasts: get().toasts.filter((t) => t.id !== id) });
	},

	pushUserCommand(command, result, modeId) {
		// Tree results route to the sidebar, not the output log.
		if (result.type === "tree") {
			set({ tree: result.root });
			return;
		}
		set({
			output: [
				...get().output,
				{ id: newId(), source: "user", command, result, modeId },
			],
		});
	},

	setTree(tree) {
		set({ tree });
	},

	setEditorState(state) {
		set({ editor: state });
	},

	pushHistory(line) {
		const trimmed = line.trim();
		if (!trimmed) return;
		const { history } = get();
		// Skip duplicates of the immediate predecessor.
		if (history[history.length - 1] === trimmed) {
			set({ historyIndex: null, draft: "" });
			return;
		}
		set({
			history: [...history, trimmed].slice(-200),
			historyIndex: null,
			draft: "",
		});
	},

	historyUp(currentValue) {
		const { history, historyIndex } = get();
		if (history.length === 0) return null;
		if (historyIndex === null) {
			// Save the in-progress draft before navigating into history.
			set({ draft: currentValue, historyIndex: history.length - 1 });
			return history[history.length - 1] ?? null;
		}
		const next = Math.max(0, historyIndex - 1);
		set({ historyIndex: next });
		return history[next] ?? null;
	},

	historyDown() {
		const { history, historyIndex, draft } = get();
		if (historyIndex === null) return null;
		const next = historyIndex + 1;
		if (next >= history.length) {
			set({ historyIndex: null });
			return draft;
		}
		set({ historyIndex: next });
		return history[next] ?? null;
	},

	pushLlmEvent(event) {
		if (event.type === "command.start") {
			set({
				output: [
					...get().output,
					{
						id: `llm-${event.id}`,
						source: "llm",
						command: event.command,
						result: { type: "empty" },
						modeId: event.mode,
					},
				],
			});
			return;
		}
		if (event.type === "command.end") {
			set({
				output: get().output.map((e) =>
					e.id === `llm-${event.id}` ? { ...e, result: event.result } : e,
				),
			});
		}
	},

	applyServerMsg(msg) {
		switch (msg.kind) {
			case "session-state":
				set({ sessionState: msg.state });
				return;
			case "tree":
				set({ tree: msg.tree });
				return;
			case "completion":
				set({ completion: msg.payload, completionFor: msg.id });
				return;
			case "wizard-state":
				set({ wizard: msg.state });
				return;
			case "wizard-progress":
				// Append a transient toast for now; richer handling in wizard task.
				set({
					toasts: [
						...get().toasts,
						{
							id: `wp-${Date.now()}-${Math.random()}`,
							level: "info",
							text: msg.progress.message ?? msg.progress.phase,
						},
					],
				});
				return;
			case "log":
				set({
					toasts: [
						...get().toasts,
						{ id: `log-${Date.now()}-${Math.random()}`, level: msg.level, text: msg.text },
					],
				});
				return;
			case "error":
				set({
					toasts: [
						...get().toasts,
						{
							id: `err-${Date.now()}-${Math.random()}`,
							level: "error",
							text: msg.message + (msg.detail ? ": " + msg.detail : ""),
						},
					],
				});
				return;
			case "file-content":
				set({
					editor: { visible: true, path: msg.path, content: msg.content },
				});
				return;
			case "file-saved":
				set({
					toasts: [
						...get().toasts,
						{ id: `saved-${msg.id}`, level: "info", text: `Saved ${msg.path}` },
					],
				});
				return;
			case "run-result":
				set({
					output: [
						...get().output,
						{ id: newId(), source: "user", command: "F5/F7", result: msg.result },
					],
				});
				return;
			case "llm-event":
				get().pushLlmEvent(msg.event);
				return;
			case "result":
			case "pong":
				// Handled by ws-client (request/response correlation)
				return;
		}
	},
}));
