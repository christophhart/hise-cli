import { useRef, useState } from "react";
import type { TreeNode } from "../../../engine/result.js";
import { useStore } from "../state/store.js";
import { CustomScrollbar } from "./CustomScrollbar.js";
import { send } from "../ws-client.js";

let nextId = 0;
const newId = () => `tree-${++nextId}`;

function selectNode(node: TreeNode) {
	if (!node.id) return;
	send({ kind: "select-tree-node", id: newId(), nodeId: node.id });
}

export function TreeSidebar() {
	const tree = useStore((s) => s.tree);
	const ref = useRef<HTMLDivElement | null>(null);
	if (!tree) return null;
	return (
		<aside className="tree-sidebar-wrap">
			<div ref={ref} className="tree-sidebar">
				<TreeRow node={tree} depth={0} />
			</div>
			<CustomScrollbar target={ref} />
		</aside>
	);
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
	const [open, setOpen] = useState(true);
	const hasChildren = (node.children?.length ?? 0) > 0;
	const dot = renderDot(node);
	const indent = depth * 12;
	return (
		<div className="tree-row-group">
			<div
				className={`tree-row ${node.dimmed ? "dimmed" : ""} diff-${node.diff ?? "none"}`}
				style={{ paddingLeft: indent }}
				onClick={() => hasChildren && setOpen((o) => !o)}
				onDoubleClick={(e) => {
					e.stopPropagation();
					selectNode(node);
				}}
			>
				{hasChildren && (
					<span className="caret">{open ? "▾" : "▸"}</span>
				)}
				{dot && (
					<span className="dot" style={{ color: node.colour ?? undefined }}>
						{dot}
					</span>
				)}
				<span className="label">{node.label}</span>
				{node.badge && (
					<span className="badge" style={{ color: node.badge.colour }}>
						{node.badge.text}
					</span>
				)}
			</div>
			{open &&
				node.children?.map((c, i) => (
					<TreeRow key={c.id ?? `${c.label}-${i}`} node={c} depth={depth + 1} />
				))}
		</div>
	);
}

function renderDot(node: TreeNode): string | null {
	if (node.filledDot === undefined) return null;
	return node.filledDot ? "●" : "○";
}
