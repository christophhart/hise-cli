// Undo contract — normalizes HISE undo history and diff responses.
//
// History from GET /api/undo/history returns a flat list of entries
// with a cursor position. Diff from GET /api/undo/diff returns
// accumulated changes scoped to the current group or root.

import type { TreeNode } from "../../engine/result.js";
import type { DiffEntry } from "./builder.js";

// ── Types ────────────────────────────────────────────────────────────

export interface UndoHistoryEntry {
	index: number;
	type: "group";
	name: string;
	count: number;
}

export interface UndoHistoryResponse {
	scope: string;
	groupName: string;
	cursor: number;
	history: UndoHistoryEntry[];
}

/** Re-export shared DiffEntry for undo-specific code. */
export type UndoDiffEntry = DiffEntry;

export interface UndoDiffResponse {
	scope: string;
	groupName: string;
	diff: DiffEntry[];
}

// ── Normalizers ──────────────────────────────────────────────────────

export function normalizeUndoHistoryResponse(
	raw: unknown,
): UndoHistoryResponse | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	return {
		scope: String(r.scope ?? "group"),
		groupName: String(r.groupName ?? "root"),
		cursor: typeof r.cursor === "number" ? r.cursor : -1,
		history: Array.isArray(r.history)
			? r.history.map(normalizeHistoryEntry).filter(Boolean) as UndoHistoryEntry[]
			: [],
	};
}

function normalizeHistoryEntry(raw: unknown): UndoHistoryEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	return {
		index: typeof r.index === "number" ? r.index : 0,
		type: "group",
		name: String(r.name ?? ""),
		count: typeof r.count === "number" ? r.count : 0,
	};
}

export function normalizeUndoDiffResponse(
	raw: unknown,
): UndoDiffResponse | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	return {
		scope: String(r.scope ?? "group"),
		groupName: String(r.groupName ?? "root"),
		diff: Array.isArray(r.diff)
			? r.diff.map(normalizeDiffEntry).filter(Boolean) as UndoDiffEntry[]
			: [],
	};
}

function normalizeDiffEntry(raw: unknown): UndoDiffEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const action = String(r.action ?? "");
	if (action !== "+" && action !== "-" && action !== "*") return null;
	return {
		domain: String(r.domain ?? ""),
		action,
		target: String(r.target ?? ""),
	};
}

// ── Tree builders ────────────────────────────────────────────────────

const DIFF_ACTION_LABELS: Record<string, string> = {
	"+": "+",
	"-": "−",
	"*": "∗",
};

const DIFF_ACTION_TO_TREE: Record<string, "added" | "removed" | "modified"> = {
	"+": "added",
	"-": "removed",
	"*": "modified",
};

/**
 * Build a TreeNode hierarchy from undo history + diff for sidebar display.
 *
 * Layout:
 * - Past entries: flat nodes with labels like "+ SineSynth"
 * - Active plan group: parent node with nested diff children
 * - Cursor position tracked for selectedPath
 */
export function buildHistoryTree(
	history: UndoHistoryResponse,
	planDiff: UndoDiffEntry[] | null,
	planName: string | null,
): TreeNode {
	const root: TreeNode = {
		label: "Undo History",
		id: "history",
		children: [],
	};

	for (const entry of history.history) {
		const label = entry.name || `Action ${entry.index}`;
		root.children!.push({
			label,
			id: `h${entry.index}`,
			nodeKind: "module",
		});
	}

	// Active plan group — nested with diff children
	if (planName && planDiff) {
		const planNode: TreeNode = {
			label: planName,
			id: "plan",
			nodeKind: "module",
			children: planDiff.map((d, i) => ({
				label: `${DIFF_ACTION_LABELS[d.action] ?? d.action} ${d.target}`,
				id: `plan-${i}`,
				diff: DIFF_ACTION_TO_TREE[d.action],
				nodeKind: "module" as const,
			})),
		};
		root.children!.push(planNode);
	}

	return root;
}

/**
 * Return the selected path for the current history cursor position.
 */
export function historySelectedPath(cursor: number): string[] {
	if (cursor < 0) return [];
	return [`h${cursor}`];
}
