// ── TreeSidebar — navigable tree panel on the left ──────────────────

// Renders a TreeNode hierarchy as an indented, expandable tree.
// Chains are shown with [] brackets, modules with their type.
// Keyboard navigation is handled by the central key dispatcher in
// app.tsx — this component exposes imperative methods via ref.

import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useOnClick, useOnWheel, useElementPosition } from "@ink-tools/ink-mouse";
import type { TreeNode } from "../../engine/result.js";
import type { ColorScheme } from "../theme.js";
import { brand } from "../theme.js";
import { scrollbarChar } from "./scrollbar.js";

// ── Flattened row for rendering ─────────────────────────────────────

interface FlatRow {
	node: TreeNode;
	depth: number;
	path: string[];        // node id path from root
	hasChildren: boolean;
	expanded: boolean;
}

// ── Imperative handle ───────────────────────────────────────────────

export interface TreeSidebarHandle {
	/** Move cursor up one row */
	cursorUp(): void;
	/** Move cursor down one row */
	cursorDown(): void;
	/** Expand node, or select if leaf */
	expandOrSelect(): void;
	/** Collapse node, or move to parent */
	collapseOrParent(): void;
	/** Toggle expand/collapse */
	toggle(): void;
	/** Get the path of the currently focused node */
	getFocusedPath(): string[];
}

// ── Props ───────────────────────────────────────────────────────────

/** Persistent sidebar state that survives close/reopen. Stored in a
 *  ref in app.tsx and passed to TreeSidebar as initial + sync target. */
export interface TreeSidebarState {
	expandedPaths: Set<string>;
	cursorIndex: number;
	scrollOffset: number;
}

export interface TreeSidebarProps {
	tree: TreeNode | null;
	selectedPath: string[];
	width: number;
	height: number;
	focused: boolean;
	accent: string;
	scheme: ColorScheme;
	onSelect: (path: string[]) => void;
	sidebarRef?: React.Ref<TreeSidebarHandle>;
	/** Persistent state from a previous mount. When provided, the sidebar
	 *  restores expand/cursor/scroll state from this instead of defaults. */
	persistedState?: TreeSidebarState;
	/** Called whenever internal state changes, so the parent can persist it. */
	onStateChange?: (state: TreeSidebarState) => void;
	/** Called when the sidebar wants focus (e.g. on mouse click). */
	onFocus?: () => void;
}

// ── Constants ───────────────────────────────────────────────────────

const INDENT_WIDTH = 2;
const GAP_WIDTH = 1; // single char gap between sidebar and output

// ── Icons ───────────────────────────────────────────────────────────

function nodeIcon(node: TreeNode, expanded: boolean): string {
	const hasChildren = node.children && node.children.length > 0;
	if (node.nodeKind === "chain") {
		return hasChildren ? (expanded ? "▾ " : "▸ ") : "  ";
	}
	return hasChildren ? (expanded ? "▾ " : "▸ ") : "  ";
}

function nodeLabel(node: TreeNode): string {
	if (node.nodeKind === "chain") {
		return `[${node.label}]`;
	}
	return node.label;
}

// ── Flatten tree into visible rows ──────────────────────────────────

function flattenTree(
	node: TreeNode,
	depth: number,
	parentPath: string[],
	expandedSet: Set<string>,
	rows: FlatRow[],
): void {
	const path = [...parentPath, node.id ?? node.label];
	const pathKey = path.join(".");
	const hasChildren = !!(node.children && node.children.length > 0);
	const expanded = hasChildren && expandedSet.has(pathKey);

	rows.push({ node, depth, path, hasChildren, expanded });

	if (expanded && node.children) {
		for (const child of node.children) {
			flattenTree(child, depth + 1, path, expandedSet, rows);
		}
	}
}

// ── Component ───────────────────────────────────────────────────────

export const TreeSidebar = React.memo(function TreeSidebar({
	tree,
	selectedPath,
	width,
	height,
	focused,
	accent,
	scheme,
	onSelect,
	sidebarRef,
	persistedState,
	onStateChange,
	onFocus,
}: TreeSidebarProps) {
	const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
		if (persistedState) return new Set(persistedState.expandedPaths);
		// Auto-expand root and selected path on mount
		const initial = new Set<string>();
		if (tree) {
			const rootKey = tree.id ?? tree.label;
			initial.add(rootKey);
			// Expand along the selected path
			let pathSoFar = rootKey;
			for (const seg of selectedPath) {
				pathSoFar += "." + seg;
				initial.add(pathSoFar);
			}
		}
		return initial;
	});
	const [cursorIndex, setCursorIndex] = useState(persistedState?.cursorIndex ?? 0);
	const [scrollOffset, setScrollOffset] = useState(persistedState?.scrollOffset ?? 0);

	// Persist state changes back to parent
	useEffect(() => {
		onStateChange?.({ expandedPaths: expandedSet, cursorIndex, scrollOffset });
	}, [expandedSet, cursorIndex, scrollOffset]);

	// Flatten tree
	const rows: FlatRow[] = [];
	if (tree) {
		flattenTree(tree, 0, [], expandedSet, rows);
	}

	// Clamp cursor
	const clampedCursor = Math.max(0, Math.min(cursorIndex, rows.length - 1));
	if (clampedCursor !== cursorIndex) {
		setCursorIndex(clampedCursor);
	}

	// Selected path key for highlighting
	const selectedKey = selectedPath.length > 0
		? [tree?.id ?? tree?.label, ...selectedPath].filter(Boolean).join(".")
		: tree?.id ?? tree?.label ?? "";

	// When focus enters the sidebar, jump cursor to the selected node
	// and ensure it's expanded/visible
	useEffect(() => {
		if (!focused || rows.length === 0) return;
		const targetIndex = rows.findIndex((r) => r.path.join(".") === selectedKey);
		if (targetIndex >= 0) {
			setCursorIndex(targetIndex);
		}
	}, [focused]); // intentionally only on focus change

	// Scrolling
	const contentWidth = width - GAP_WIDTH; // space for darker gap
	const visibleRows = height;
	const totalRows = rows.length;
	const showScrollbar = totalRows > visibleRows;

	// Keep cursor in view
	let adjScroll = scrollOffset;
	if (clampedCursor < adjScroll) {
		adjScroll = clampedCursor;
	} else if (clampedCursor >= adjScroll + visibleRows) {
		adjScroll = clampedCursor - visibleRows + 1;
	}
	if (adjScroll !== scrollOffset) {
		setScrollOffset(adjScroll);
	}

	// Imperative handle
	useImperativeHandle(sidebarRef, () => ({
		cursorUp: () => {
			setCursorIndex((prev) => Math.max(0, prev - 1));
		},
		cursorDown: () => {
			setCursorIndex((prev) => Math.min(rows.length - 1, prev + 1));
		},
		expandOrSelect: () => {
			const row = rows[clampedCursor];
			if (!row) return;
			const pathKey = row.path.join(".");
			if (row.hasChildren && !row.expanded) {
				// Expand
				setExpandedSet((prev) => new Set(prev).add(pathKey));
			} else {
				// Select (navigate to this node)
				// Strip the root from the path for selectNode/cd
				const navPath = row.path.slice(1);
				onSelect(navPath);
			}
		},
		collapseOrParent: () => {
			const row = rows[clampedCursor];
			if (!row) return;
			const pathKey = row.path.join(".");
			if (row.expanded) {
				// Collapse
				setExpandedSet((prev) => {
					const next = new Set(prev);
					next.delete(pathKey);
					return next;
				});
			} else if (row.depth > 0) {
				// Move to parent
				const parentPath = row.path.slice(0, -1);
				const parentIndex = rows.findIndex(
					(r) => r.path.join(".") === parentPath.join("."),
				);
				if (parentIndex >= 0) {
					setCursorIndex(parentIndex);
				}
			}
		},
		toggle: () => {
			const row = rows[clampedCursor];
			if (!row || !row.hasChildren) return;
			const pathKey = row.path.join(".");
			setExpandedSet((prev) => {
				const next = new Set(prev);
				if (next.has(pathKey)) {
					next.delete(pathKey);
				} else {
					next.add(pathKey);
				}
				return next;
			});
		},
		getFocusedPath: () => {
			const row = rows[clampedCursor];
			return row ? row.path.slice(1) : [];
		},
	}), [rows, clampedCursor, expandedSet, onSelect]);

	// ── Mouse interaction ──────────────────────────────────────

	const boxRef = useRef<DOMElement>(null);
	const elementPos = useElementPosition(boxRef);

	// Single click: move cursor + grab focus (instant, no debounce).
	// Double click: navigate into node (cd).
	// Expand/collapse is keyboard-only (Space, Right, Left).
	const DOUBLE_CLICK_MS = 300;
	const lastClickRef = useRef<{ row: number; time: number } | null>(null);

	useOnClick(boxRef, (event) => {
		const relRow = event.y - elementPos.top;
		const rowIndex = relRow + adjScroll;
		const row = rows[rowIndex];
		if (!row) return;

		// Always grab focus and move cursor immediately
		onFocus?.();
		setCursorIndex(rowIndex);

		// Double-click detection
		const now = Date.now();
		const last = lastClickRef.current;

		if (last && last.row === rowIndex && now - last.time < DOUBLE_CLICK_MS) {
			// Double-click — navigate into node
			lastClickRef.current = null;
			const navPath = row.path.slice(1);
			onSelect(navPath);
		} else {
			lastClickRef.current = { row: rowIndex, time: now };
		}
	});

	// Scroll wheel
	const WHEEL_LINES = 3;
	useOnWheel(boxRef, (event) => {
		if (event.button === "wheel-up") {
			setScrollOffset((prev) => Math.max(0, prev - WHEEL_LINES));
		} else if (event.button === "wheel-down") {
			const maxScroll = Math.max(0, totalRows - visibleRows);
			setScrollOffset((prev) => Math.min(maxScroll, prev + WHEEL_LINES));
		}
	});

	// ── Render ──────────────────────────────────────────────────

	if (!tree) {
		// No tree — render empty sidebar
		const emptyRows: React.ReactNode[] = [];
		for (let i = 0; i < height; i++) {
			emptyRows.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{" ".repeat(contentWidth)}
					</Text>
					<Text backgroundColor={scheme.backgrounds.darker}>
						{" ".repeat(GAP_WIDTH)}
					</Text>
				</Box>,
			);
		}
		return <Box ref={boxRef} flexDirection="column">{emptyRows}</Box>;
	}

	const visibleSlice = rows.slice(adjScroll, adjScroll + visibleRows);
	const renderedRows: React.ReactNode[] = [];

	for (let i = 0; i < visibleRows; i++) {
		const row = visibleSlice[i];
		if (!row) {
			// Empty row below content
			const sb = showScrollbar
				? scrollbarChar(i, visibleRows, totalRows, adjScroll, scheme)
				: null;
			const pad = contentWidth - (sb ? 1 : 0);
			renderedRows.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{" ".repeat(Math.max(0, pad))}
						{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
					</Text>
					<Text backgroundColor={scheme.backgrounds.darker}>
						{" ".repeat(GAP_WIDTH)}
					</Text>
				</Box>,
			);
			continue;
		}

		const pathKey = row.path.join(".");
		const isSelected = pathKey === selectedKey;
		const isCursorRow = (adjScroll + i) === clampedCursor;

		// Build indented label
		const indent = " ".repeat(row.depth * INDENT_WIDTH);
		const icon = nodeIcon(row.node, row.expanded);
		const label = nodeLabel(row.node);
		const fullText = indent + icon + label;

		// Truncate to content width (minus scrollbar)
		const scrollbarSpace = showScrollbar ? 1 : 0;
		const maxLabelWidth = contentWidth - scrollbarSpace;
		const displayText = fullText.length > maxLabelWidth
			? fullText.slice(0, maxLabelWidth - 1) + "\u2026"
			: fullText;
		const padRight = Math.max(0, maxLabelWidth - displayText.length);

		// Colors
		let fg = scheme.foreground.default;
		let bg = scheme.backgrounds.sidebar;

		if (isCursorRow && focused) {
			fg = brand.signal;
			bg = scheme.backgrounds.raised;
		} else if (isSelected) {
			fg = accent;
		} else if (row.node.nodeKind === "chain") {
			fg = scheme.foreground.muted;
		}

		// Scrollbar
		const sb = showScrollbar
			? scrollbarChar(i, visibleRows, totalRows, adjScroll, scheme)
			: null;

		renderedRows.push(
			<Box key={i}>
				<Text backgroundColor={bg}>
					<Text color={fg}>{displayText}</Text>
					<Text>{" ".repeat(padRight)}</Text>
					{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
				</Text>
				<Text backgroundColor={scheme.backgrounds.darker}>
					{" ".repeat(GAP_WIDTH)}
				</Text>
			</Box>,
		);
	}

	return <Box ref={boxRef} flexDirection="column">{renderedRows}</Box>;
});
