// ── Tests for TreeSidebar filtering logic ───────────────────────────

import { describe, it, expect } from "vitest";
import type { TreeNode } from "../../engine/result.js";
import { computeVisibleSet, flattenTree, type FlatRow } from "./TreeSidebar.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Build flat rows from a tree (root always expanded, children collapsed). */
function buildRows(tree: TreeNode, expandedPaths?: Set<string>): FlatRow[] {
	const expanded = expandedPaths ?? new Set<string>();
	// Always expand root
	expanded.add(tree.id ?? tree.label);
	const rows: FlatRow[] = [];
	flattenTree(tree, 0, [], expanded, rows, true, []);
	return rows;
}

/** Expand all nodes in the tree. */
function expandAll(tree: TreeNode, set?: Set<string>, parentPath?: string[]): Set<string> {
	const s = set ?? new Set<string>();
	const path = [...(parentPath ?? []), tree.id ?? tree.label];
	s.add(path.join("."));
	if (tree.children) {
		for (const child of tree.children) {
			expandAll(child, s, path);
		}
	}
	return s;
}

// ── Test tree ───────────────────────────────────────────────────────

const testTree: TreeNode = {
	label: "Master Chain",
	id: "Master",
	children: [
		{
			label: "MIDI Processor Chain",
			id: "midi",
			nodeKind: "chain",
			children: [
				{ label: "Interface", id: "Interface", nodeKind: "module" },
			],
		},
		{
			label: "Gain Modulation",
			id: "gain",
			nodeKind: "chain",
			children: [
				{ label: "LFO", id: "LFO", nodeKind: "module" },
				{ label: "AHDSR", id: "AHDSR", nodeKind: "module" },
			],
		},
		{
			label: "FX Chain",
			id: "fx",
			nodeKind: "chain",
			children: [
				{ label: "SimpleReverb", id: "SimpleReverb", nodeKind: "module" },
				{ label: "Analyser", id: "Analyser", nodeKind: "module" },
			],
		},
	],
};

// ── Tests ───────────────────────────────────────────────────────────

describe("computeVisibleSet", () => {
	it("returns null when filter is empty", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		expect(computeVisibleSet(rows, "")).toBeNull();
	});

	it("root is always visible regardless of filter", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		const visible = computeVisibleSet(rows, "zzz_no_match");
		expect(visible).not.toBeNull();
		// Root row (index 0) should be visible
		expect(visible!.has(0)).toBe(true);
		// Only root should be visible since nothing matches
		expect(visible!.size).toBe(1);
	});

	it("matches substring case-insensitively", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		const visible = computeVisibleSet(rows, "lfo");
		expect(visible).not.toBeNull();
		// Should include: root, gain chain (ancestor), LFO itself
		const visibleLabels = [...visible!].map((i) => rows[i]!.node.label);
		expect(visibleLabels).toContain("Master Chain");
		expect(visibleLabels).toContain("Gain Modulation");
		expect(visibleLabels).toContain("LFO");
		// Should NOT include unrelated items
		expect(visibleLabels).not.toContain("Interface");
		expect(visibleLabels).not.toContain("FX Chain");
		expect(visibleLabels).not.toContain("SimpleReverb");
	});

	it("includes all ancestors of matching nodes", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		const visible = computeVisibleSet(rows, "Analyser");
		expect(visible).not.toBeNull();
		const visibleLabels = [...visible!].map((i) => rows[i]!.node.label);
		// Analyser is in FX Chain, which is in Master
		expect(visibleLabels).toContain("Master Chain");
		expect(visibleLabels).toContain("FX Chain");
		expect(visibleLabels).toContain("Analyser");
		// Sibling should not be visible
		expect(visibleLabels).not.toContain("SimpleReverb");
	});

	it("matches multiple items across different branches", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		// "a" matches: "Master Chain", "Gain Modulation", "AHDSR", "FX Chain" (no),
		// "Interface" (no), "Analyser"
		const visible = computeVisibleSet(rows, "a");
		expect(visible).not.toBeNull();
		const visibleLabels = [...visible!].map((i) => rows[i]!.node.label);
		// Everything with "a" in the label should match
		expect(visibleLabels).toContain("Master Chain"); // root (always) + matches
		expect(visibleLabels).toContain("Gain Modulation"); // matches "a"
		expect(visibleLabels).toContain("AHDSR"); // matches "a"
		expect(visibleLabels).toContain("Analyser"); // matches "a"
		expect(visibleLabels).toContain("FX Chain"); // ancestor of Analyser
		expect(visibleLabels).toContain("MIDI Processor Chain"); // contains "a" in "Chain"
		expect(visibleLabels).toContain("Interface"); // child of matching "MIDI Processor Chain"? No — only ancestors of matches are shown, not children
	});

	it("collapsed nodes are not in rows so not searchable", () => {
		// Only root expanded — children of chains are not in rows
		const rows = buildRows(testTree);
		// Rows should only contain: Master, midi, gain, fx (chains are depth-1, not expanded)
		expect(rows.length).toBe(4);
		const visible = computeVisibleSet(rows, "LFO");
		expect(visible).not.toBeNull();
		// LFO is not in the rows because gain chain is collapsed
		expect(visible!.size).toBe(1); // only root
	});

	it("filter matching root label still shows root", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		const visible = computeVisibleSet(rows, "Master");
		expect(visible).not.toBeNull();
		expect(visible!.has(0)).toBe(true);
	});

	it("partial match works on any part of the label", () => {
		const rows = buildRows(testTree, expandAll(testTree));
		const visible = computeVisibleSet(rows, "Reverb");
		expect(visible).not.toBeNull();
		const visibleLabels = [...visible!].map((i) => rows[i]!.node.label);
		expect(visibleLabels).toContain("SimpleReverb");
		expect(visibleLabels).toContain("FX Chain"); // ancestor
		expect(visibleLabels).toContain("Master Chain"); // root
	});
});
