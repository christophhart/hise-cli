// ── Per-connection WS message dispatch ──────────────────────────────

import type { WebHost, WsClient } from "./session-host.js";
import type { ClientMsg, ServerMsg } from "./protocol.js";
import { decodeClient, encode } from "./protocol.js";
import type { CommandResult } from "../engine/result.js";
import { runReportResult } from "../engine/result.js";
import type { WizardAnswers, WizardDefinition } from "../engine/wizard/types.js";
import { mergeInitDefaults } from "../engine/wizard/types.js";
import { WizardExecutor, WizardInitAbortError } from "../engine/wizard/executor.js";
import { parseScript } from "../engine/run/parser.js";
import { validateScript, formatValidationReport } from "../engine/run/validator.js";
import { executeScript, dryRunScript } from "../engine/run/executor.js";
import { buildModeMap } from "../engine/run/mode-map.js";

export interface ConnectionContext {
	host: WebHost;
	client: WsClient;
}

export async function dispatchClientMessage(
	ctx: ConnectionContext,
	raw: string,
): Promise<void> {
	const msg = decodeClient(raw);
	if (!msg) {
		send(ctx, { kind: "error", message: "Invalid message frame" });
		return;
	}

	switch (msg.kind) {
		case "ping":
			send(ctx, { kind: "pong", id: msg.id });
			return;

		case "submit-input":
			await handleSubmitInput(ctx, msg);
			return;

		case "complete":
			handleComplete(ctx, msg);
			return;

		case "request-snapshot":
			send(ctx, { kind: "session-state", state: ctx.host.snapshot() });
			send(ctx, { kind: "tree", tree: ctx.host.currentTree() });
			return;

		case "open-file":
			await handleOpenFile(ctx, msg);
			return;

		case "save-file":
			await handleSaveFile(ctx, msg);
			return;

		case "select-tree-node":
			handleSelectTreeNode(ctx, msg);
			return;

		case "run-script":
			await handleRunScript(ctx, msg, false);
			return;

		case "dry-run-script":
			await handleRunScript(ctx, msg, true);
			return;

		case "complete-document":
			handleCompleteDocument(ctx, msg);
			return;

		default: {
			const exhaustive: never = msg;
			send(ctx, { kind: "error", message: `Unknown kind: ${(exhaustive as { kind?: string }).kind ?? "?"}` });
		}
	}
}

// ── Handlers ────────────────────────────────────────────────────────

async function handleSubmitInput(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "submit-input" }>,
): Promise<void> {
	// Web-specific: `/edit [path]` opens a .hsc file (or a scratch buffer
	// when no path is supplied) in the Monaco pane. The engine's /edit
	// command is TUI-only (callback body editing) so we intercept here.
	const trimmed = msg.line.trim();
	if (trimmed === "/edit") {
		await openEditor(ctx, msg.id, null);
		return;
	}
	const editMatch = trimmed.match(/^\/edit\s+(\S.+)$/);
	if (editMatch) {
		await openEditor(ctx, msg.id, editMatch[1]!);
		return;
	}

	const result = await ctx.host.withLock(() =>
		ctx.host.session.handleInput(msg.line),
	);
	const finalResult = await maybeInitWizardResult(ctx, result);
	send(ctx, { kind: "result", id: msg.id, result: finalResult });
	ctx.host.broadcast({ kind: "session-state", state: ctx.host.snapshot() });
	broadcastTreeIfAvailable(ctx);
}

/** Tree-node double-click: forward to current mode's selectNode (the
 *  TUI uses this same hook). The mode mutates its internal selection /
 *  cwd; we broadcast the refreshed tree + session state. */
function handleSelectTreeNode(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "select-tree-node" }>,
): void {
	const mode = ctx.host.session.currentMode() as unknown as {
		selectNode?(path: string[]): void;
	};
	if (typeof mode.selectNode !== "function") return;
	const path = msg.nodeId.split(".").filter((s) => s.length > 0);
	try {
		mode.selectNode(path);
	} catch {
		// non-fatal
	}
	broadcastTreeIfAvailable(ctx);
	ctx.host.broadcast({ kind: "session-state", state: ctx.host.snapshot() });
}

/** Pull the active mode's tree (if it exposes getTree()) and broadcast.
 *  Mirrors the TUI's per-keystroke sidebar refresh. */
function broadcastTreeIfAvailable(ctx: ConnectionContext): void {
	const mode = ctx.host.session.currentMode() as unknown as {
		getTree?(): import("../engine/result.js").TreeNode | null;
	};
	if (typeof mode.getTree !== "function") return;
	try {
		const tree = mode.getTree() ?? null;
		ctx.host.broadcast({ kind: "tree", tree });
	} catch {
		// non-fatal; keep prior tree
	}
}

/** Sentinel path for an untitled in-memory scratch buffer. */
export const SCRATCH_PATH = "<scratch>";

async function openEditor(
	ctx: ConnectionContext,
	requestId: string,
	rawPath: string | null,
): Promise<void> {
	if (rawPath === null) {
		// Untitled scratch buffer — no file load, no save on F5.
		send(ctx, {
			kind: "file-content",
			id: requestId,
			path: SCRATCH_PATH,
			content: "",
		});
		send(ctx, {
			kind: "result",
			id: requestId,
			result: { type: "text", content: "Opened scratch buffer." },
		});
		return;
	}
	if (!ctx.host.session.loadScriptFile) {
		send(ctx, { kind: "error", id: requestId, message: "loadScriptFile not wired" });
		return;
	}
	try {
		const content = await ctx.host.session.loadScriptFile(rawPath);
		send(ctx, { kind: "file-content", id: requestId, path: rawPath, content });
		send(ctx, {
			kind: "result",
			id: requestId,
			result: { type: "text", content: `Opened ${rawPath} in editor.` },
		});
	} catch (err) {
		send(ctx, {
			kind: "result",
			id: requestId,
			result: {
				type: "error",
				message: `Failed to open ${rawPath}`,
				detail: String(err),
			},
		});
	}
}

/**
 * If the engine returned a wizard result, run the wizard's init handler
 * server-side and merge the fetched defaults into the definition before
 * forwarding to the client. Mirrors the TUI's app.tsx behaviour. Init
 * abort produces an error result instead of opening the form.
 */
async function maybeInitWizardResult(
	ctx: ConnectionContext,
	result: CommandResult,
): Promise<CommandResult> {
	if (result.type !== "wizard") return result;
	const executor = new WizardExecutor({
		connection: ctx.host.session.connection,
		handlerRegistry: ctx.host.session.handlerRegistry ?? null,
	});
	try {
		const initDefaults = await executor.initialize(result.definition);
		const mergedDef = mergeInitDefaults(result.definition, initDefaults);
		return { ...result, definition: mergedDef };
	} catch (err) {
		if (err instanceof WizardInitAbortError) {
			return { type: "error", message: err.message };
		}
		// Other init failures are non-fatal — surface the wizard with
		// untouched defaults rather than swallowing.
		return result;
	}
}

function handleComplete(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "complete" }>,
): void {
	const result = ctx.host.session.complete(msg.line, msg.cursor);
	send(ctx, {
		kind: "completion",
		id: msg.id,
		payload: result
			? { items: result.items, from: result.from, to: result.to, label: result.label }
			: null,
	});
}

async function handleOpenFile(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "open-file" }>,
): Promise<void> {
	if (!ctx.host.session.loadScriptFile) {
		send(ctx, { kind: "error", id: msg.id, message: "loadScriptFile not wired" });
		return;
	}
	try {
		const content = await ctx.host.session.loadScriptFile(msg.path);
		send(ctx, { kind: "file-content", id: msg.id, path: msg.path, content });
	} catch (err) {
		send(ctx, {
			kind: "error",
			id: msg.id,
			message: `Failed to read ${msg.path}`,
			detail: String(err),
		});
	}
}

async function handleSaveFile(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "save-file" }>,
): Promise<void> {
	if (!ctx.host.session.saveScriptFile) {
		send(ctx, { kind: "error", id: msg.id, message: "saveScriptFile not wired" });
		return;
	}
	try {
		await ctx.host.session.saveScriptFile(msg.path, msg.content);
		send(ctx, { kind: "file-saved", id: msg.id, path: msg.path });
	} catch (err) {
		send(ctx, {
			kind: "error",
			id: msg.id,
			message: `Failed to save ${msg.path}`,
			detail: String(err),
		});
	}
}

// ── F5/F7: run + dry-run a .hsc script ──────────────────────────────

async function handleRunScript(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "run-script" | "dry-run-script" }>,
	dryRun: boolean,
): Promise<void> {
	const isScratch = msg.path === SCRATCH_PATH;
	if (!isScratch && !ctx.host.session.saveScriptFile) {
		send(ctx, { kind: "error", id: msg.id, message: "saveScriptFile not wired" });
		return;
	}
	try {
		if (!isScratch) {
			await ctx.host.session.saveScriptFile!(msg.path, msg.content);
			send(ctx, { kind: "file-saved", id: msg.id, path: msg.path });
		}

		const script = parseScript(msg.content);
		if (script.lines.length === 0) {
			send(ctx, {
				kind: "run-result",
				id: msg.id,
				result: { type: "text", content: "Script is empty (no executable lines)." },
			});
			return;
		}

		const validation = validateScript(script, ctx.host.session);
		if (!validation.ok) {
			send(ctx, {
				kind: "run-result",
				id: msg.id,
				result: { type: "error", message: formatValidationReport(validation) },
			});
			return;
		}

		if (dryRun) {
			const live = await ctx.host.withLock(() => dryRunScript(script, ctx.host.session));
			send(ctx, {
				kind: "run-result",
				id: msg.id,
				result: live.errors.length === 0
					? { type: "text", content: `✓ ${script.lines.length} lines validated.` }
					: {
						type: "error",
						message: `Dry-run found ${live.errors.length} issue(s)`,
						detail: live.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"),
					},
			});
			return;
		}

		const runResult = await ctx.host.withLock(() => executeScript(script, ctx.host.session));
		send(ctx, {
			kind: "run-result",
			id: msg.id,
			result: runReportResult(msg.content, runResult),
		});
	} catch (err) {
		send(ctx, {
			kind: "error",
			id: msg.id,
			message: "Run failed",
			detail: String(err),
		});
	}
}

// ── Document-aware completion (Monaco) ──────────────────────────────

function handleCompleteDocument(
	ctx: ConnectionContext,
	msg: Extract<ClientMsg, { kind: "complete-document" }>,
): void {
	// Compute the mode active at the cursor by replaying preceding lines
	// through buildModeMap. The mode determines which mode's completion
	// engine is invoked.
	const allLines = msg.document.split(/\r?\n/);
	// Lines 1-based in Monaco; clamp.
	const lineIdx = Math.max(0, Math.min(msg.line - 1, allLines.length - 1));
	const upTo = allLines.slice(0, lineIdx + 1);
	const map = buildModeMap(upTo);
	const entry = map[map.length - 1];
	const lineText = allLines[lineIdx] ?? "";
	const cursor = Math.max(0, msg.column - 1);

	// Temporarily push the active mode onto the session's stack so
	// session.complete() resolves in that context. This mirrors the TUI's
	// per-line behaviour.
	const session = ctx.host.session;
	const stash = [...session.modeStack];
	try {
		// For one-shot mode-entry lines, the post-keyword text is in the
		// mode but we don't push the stack permanently; same logic here.
		if (entry && entry.modeId !== "root" && entry.modeId !== session.currentModeId) {
			// The session has registered mode factories. Easiest: dispatch a
			// fake "/<mode>" entry to push onto the stack, then complete.
			// Skipped for v1 — fall back to current session mode for now.
		}
		const result = session.complete(lineText, cursor);
		send(ctx, {
			kind: "completion",
			id: msg.id,
			payload: result
				? { items: result.items, from: result.from, to: result.to, label: result.label }
				: null,
		});
	} finally {
		// Stack restoration not strictly needed since we didn't push, but
		// keep the structure for when we do.
		void stash;
	}
}

function lookupWizard(ctx: ConnectionContext, id: string): WizardDefinition | null {
	const reg = ctx.host.session.wizardRegistry;
	if (!reg) return null;
	return reg.get(id) ?? null;
}

// ── helpers ─────────────────────────────────────────────────────────

function send(ctx: ConnectionContext, msg: ServerMsg): void {
	ctx.client.send(encode(msg));
}
