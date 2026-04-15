// ── Shared tree navigation utilities ─────────────────────────────────

import type { TreeNode } from "./result.js";

/** Find a TreeNode by its id (processorId for modules, label for chains). Case-insensitive. */
export function findNodeById(tree: TreeNode | null, id: string): TreeNode | null {
	if (!tree) return null;
	if (tree.id?.toLowerCase() === id.toLowerCase()) return tree;
	if (tree.children) {
		for (const child of tree.children) {
			const found = findNodeById(child, id);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Walk a path of node IDs from the tree root, returning the node at the end.
 * Each segment matches a direct child's id at that level (case-insensitive).
 */
export function resolveNodeByPath(tree: TreeNode | null, path: string[]): TreeNode | null {
	if (!tree || path.length === 0) return tree;
	let current: TreeNode = tree;
	for (const seg of path) {
		if (!current.children) return null;
		const lower = seg.toLowerCase();
		const child = current.children.find((c) => c.id?.toLowerCase() === lower);
		if (!child) return null;
		current = child;
	}
	return current;
}
