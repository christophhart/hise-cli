// ── WebHost — owns the singleton Session for the web frontend ───────
//
// One Session per server process; multiple browser WS clients share it.
// Per-host async lock around session.handleInput prevents interleaved
// mutations when multiple tabs submit at once. Broadcasts state changes
// to all connected clients.

import type { Session } from "../engine/session.js";
import type { CompletionEngine } from "../engine/completion/engine.js";
import type { HiseConnection } from "../engine/hise.js";
import type { TreeNode } from "../engine/result.js";
import type { ModeId } from "../engine/modes/mode.js";
import type { ServerMsg, SessionStateSnapshot } from "./protocol.js";
import { encode } from "./protocol.js";

export interface WsClient {
	send(text: string): void;
	close(): void;
}

export interface WebHost {
	readonly session: Session;
	readonly completionEngine: CompletionEngine;
	readonly connection: HiseConnection;
	attach(client: WsClient): void;
	detach(client: WsClient): void;
	broadcast(msg: ServerMsg): void;
	withLock<T>(fn: () => Promise<T>): Promise<T>;
	snapshot(): SessionStateSnapshot;
	currentTree(): TreeNode | null;
}

export function createWebHost(deps: {
	session: Session;
	completionEngine: CompletionEngine;
	connection: HiseConnection;
}): WebHost {
	const clients = new Set<WsClient>();
	let lockChain: Promise<unknown> = Promise.resolve();

	const broadcast = (msg: ServerMsg) => {
		const text = encode(msg);
		for (const c of clients) {
			try {
				c.send(text);
			} catch {
				// dropped client; cleanup happens on close handler
			}
		}
	};

	const withLock = <T>(fn: () => Promise<T>): Promise<T> => {
		const next = lockChain.then(fn, fn);
		// keep the chain alive even if fn rejects
		lockChain = next.catch(() => undefined);
		return next;
	};

	const snapshot = (): SessionStateSnapshot => ({
		modeStack: deps.session.modeStack.map((m) => m.id as ModeId),
		prompt: derivePrompt(deps.session),
		projectName: deps.session.projectName ?? null,
		projectFolder: deps.session.projectFolder ?? null,
	});

	const currentTree = (): TreeNode | null => {
		// The TUI computes the current tree from the active mode. Modes
		// don't expose a unified "treeRoot" hook today — for v1 the host
		// returns null and lets the React side render an empty sidebar
		// until a tree CommandResult arrives. Expand later by adding a
		// `getTree()` method to relevant Mode implementations.
		return null;
	};

	return {
		session: deps.session,
		completionEngine: deps.completionEngine,
		connection: deps.connection,
		attach(client) {
			clients.add(client);
		},
		detach(client) {
			clients.delete(client);
		},
		broadcast,
		withLock,
		snapshot,
		currentTree,
	};
}

function derivePrompt(session: Session): string {
	const id = session.currentModeId;
	return id === "root" ? "›" : `${id} ›`;
}
