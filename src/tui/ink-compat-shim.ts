// ── Shim: bridge ink-compat layout to yogaNode for @ink-tools/ink-mouse ─────
//
// ink-mouse reads positions via node.yogaNode.getComputedLayout() and walks
// node.parentNode. ink-compat stores layout as __inkLayout {x, y, w, h} and
// uses .parent instead of .parentNode. This shim patches nodes after each
// render frame so ink-mouse can compute hit testing.

interface CompatNode {
	yogaNode?: unknown;
	parentNode?: CompatNode | null;
	parent?: CompatNode | null;
	children?: CompatNode[];
	__inkLayout?: { x: number; y: number; w: number; h: number };
	__yogaShimmed?: boolean;
}

function shimNode(node: CompatNode): void {
	if (!node || typeof node !== "object") return;

	// Ensure parentNode is set (ink-mouse walks parentNode chain)
	if (!node.parentNode && node.parent) {
		node.parentNode = node.parent;
	}

	// Create a yogaNode shim that reads __inkLayout
	node.yogaNode = {
		getComputedLayout() {
			const layout = node.__inkLayout;
			if (!layout) return { left: 0, top: 0, width: 0, height: 0 };
			return {
				left: layout.x,
				top: layout.y,
				width: layout.w,
				height: layout.h,
			};
		},
	};
}

/** Walk the ink-compat node tree and shim yogaNode on every node. */
export function shimYogaNodes(rootNode: unknown): void {
	walkTree(rootNode as CompatNode);
}

function walkTree(node: CompatNode): void {
	if (!node) return;
	shimNode(node);
	if (node.children) {
		for (const child of node.children) {
			walkTree(child);
		}
	}
}
