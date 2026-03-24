// ── TreeSidebar — navigable tree panel on the left ──────────────────

// Renders a TreeNode hierarchy as an indented, expandable tree with
// ASCII connector lines (├─ └─ │). Chains are shown with [] brackets.
// Keyboard navigation is handled by the central key dispatcher in
// app.tsx — this component exposes imperative methods via ref.

import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useOnClick, useOnWheel, useElementPosition } from "@ink-tools/ink-mouse";
import type { TreeNode } from "../../engine/result.js";
import type { ColorScheme } from "../theme.js";
import { brand, darkenHex, mix } from "../theme.js";
import { useTheme } from "../theme-context.js";
import { scrollbarChar } from "./scrollbar.js";
import type { LayoutScale } from "../layout.js";

// ── Flattened row for rendering ─────────────────────────────────────

export interface FlatRow {
	node: TreeNode;
	depth: number;
	path: string[];           // node id path from root
	hasChildren: boolean;
	expanded: boolean;
	isLast: boolean;           // is this the last child of its parent?
	ancestorIsLast: boolean[]; // for each depth 0..depth-1, was the ancestor the last child?
	/** When true, this is a blank separator row with connector lines only.
	 *  Inserted before nodes with topMargin when layout.sidebarTopMargin is enabled. */
	separator?: boolean;
}

// ── Imperative handle ───────────────────────────────────────────────

export interface TreeSidebarHandle {
	/** Move cursor up one row */
	cursorUp(): void;
	/** Move cursor down one row */
	cursorDown(): void;
	/** Expand a collapsed node. No-op on leaves or already-expanded nodes. */
	expand(): void;
	/** Navigate into the focused node (auto-expands if collapsed). */
	selectAsRoot(): void;
	/** Collapse node (no-op on root), or move to parent */
	collapseOrParent(): void;
	/** Toggle expand/collapse (no-op on root) */
	toggle(): void;
	/** Get the path of the currently focused node */
	getFocusedPath(): string[];
	/** Expand all nodes whose label matches the glob pattern. Returns match count. */
	expandMatching(pattern: string): number;
	/** Collapse all nodes whose label matches the glob pattern. Returns match count.
	 *  Root node is never collapsed. */
	collapseMatching(pattern: string): number;
	/** Jump cursor to the first visible (non-separator, non-hidden) row. Returns true if found. */
	jumpToFirstMatch(): boolean;
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
	/** Whether the search bar is focused (key dispatch is in app.tsx). */
	searchFocused?: boolean;
	/** Current search text (managed by app.tsx key dispatcher). */
	searchText?: string;
}

// ── Constants ───────────────────────────────────────────────────────

const GAP_WIDTH = 1; // single char gap between sidebar and output

// ── Diff rendering constants ────────────────────────────────────────

/** How much of the status color to mix into the sidebar background.
 *  0.9 = 10% status color, 90% sidebar bg. */
const DIFF_BG_ALPHA = 0.9;

const DIFF_CHARS: Record<string, string> = {
	added: "+",
	removed: "-",
	modified: "*",
};

const DIFF_COLORS: Record<string, string> = {
	added: brand.ok,       // #4E8E35 green
	removed: brand.error,  // #BB3434 red
	modified: brand.warning, // #FFBA00 amber
};

// ── Connector characters ────────────────────────────────────────────

const CONN_BRANCH = "├─"; // has siblings below
const CONN_LAST   = "└─"; // last child
const CONN_VERT   = "│ "; // continuation from ancestor
const CONN_SPACE  = "  "; // no continuation (ancestor was last child)

// ── Simple glob matcher ─────────────────────────────────────────────
// Supports only * as wildcard (matches any sequence of characters).
// Case-insensitive. No need for picomatch for this simple use case.

function globMatch(pattern: string, text: string): boolean {
	const p = pattern.toLowerCase();
	const t = text.toLowerCase();
	if (p === "*") return true;
	// Convert glob pattern to regex: escape special chars, replace * with .*
	const escaped = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
	return new RegExp("^" + escaped + "$").test(t);
}

// ── Icons ───────────────────────────────────────────────────────────

function nodeLabel(node: TreeNode): string {
	return node.label;
}

// ── Flatten tree into visible rows ──────────────────────────────────

export function flattenTree(
	node: TreeNode,
	depth: number,
	parentPath: string[],
	expandedSet: Set<string>,
	rows: FlatRow[],
	isLast: boolean,
	ancestorIsLast: boolean[],
): void {
	const path = [...parentPath, node.id ?? node.label];
	const pathKey = path.join(".");
	const hasChildren = !!(node.children && node.children.length > 0);
	// Root node (depth 0) is always expanded
	const expanded = hasChildren && (depth === 0 || expandedSet.has(pathKey));

	rows.push({ node, depth, path, hasChildren, expanded, isLast, ancestorIsLast });

	if (expanded && node.children) {
		const childAncestors = [...ancestorIsLast, isLast];
		for (let i = 0; i < node.children.length; i++) {
			const child = node.children[i]!;
			const childIsLast = i === node.children.length - 1;
			flattenTree(child, depth + 1, path, expandedSet, rows, childIsLast, childAncestors);
		}
	}
}

/**
 * Insert visual spacing rows based on the layout scale.
 * - sidebarTopPad: blank rows before the root node
 * - sidebarTopMargin: blank connector rows before nodes with topMargin: true
 * - sidebarBottomPad: blank rows after the last node
 * Separator rows have `separator: true` and carry the same connector context
 * as the node they precede, so vertical lines render correctly.
 */
function insertSpacingRows(rows: FlatRow[], layout: LayoutScale): FlatRow[] {
	if (layout.sidebarTopPad === 0 && !layout.sidebarTopMargin && layout.sidebarBottomPad === 0) {
		return rows;
	}

	const result: FlatRow[] = [];
	const emptyNode: TreeNode = { label: "" };

	// Top padding
	for (let i = 0; i < layout.sidebarTopPad; i++) {
		result.push({
			node: emptyNode, depth: 0, path: ["__top_pad_" + i],
			hasChildren: false, expanded: false, isLast: true, ancestorIsLast: [],
			separator: true,
		});
	}

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;

		// Insert separator before nodes with topMargin (skip root at index 0)
		if (layout.sidebarTopMargin && row.node.topMargin && i > 0) {
			result.push({
				node: emptyNode,
				depth: row.depth,
				path: ["__sep_" + i],
				hasChildren: false,
				expanded: false,
				isLast: row.isLast,
				ancestorIsLast: row.ancestorIsLast,
				separator: true,
			});
		}

		result.push(row);
	}

	// Bottom padding
	for (let i = 0; i < layout.sidebarBottomPad; i++) {
		result.push({
			node: emptyNode, depth: 0, path: ["__bot_pad_" + i],
			hasChildren: false, expanded: false, isLast: true, ancestorIsLast: [],
			separator: true,
		});
	}

	return result;
}

// ── Search filter: compute which rows are visible ───────────────────

/**
 * Given a list of flat rows, a case-insensitive filter string, and the
 * selected key (current root), return the set of row indices that should
 * be visible. Returns null when there is no active filter (all visible).
 *
 * Visibility rules:
 * 1. The root (depth 0) row is always visible.
 * 2. A row matches if its label contains the filter substring (case-insensitive).
 * 3. All ancestors of a matching row are visible (to preserve tree structure).
 * 4. Separator rows are visible if an adjacent non-separator row is visible.
 */
export function computeVisibleSet(
	rows: FlatRow[],
	filter: string,
): Set<number> | null {
	if (!filter) return null; // no filter → all visible

	const lower = filter.toLowerCase();
	const visible = new Set<number>();

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!;
		if (row.separator) continue;

		// Root is always visible
		if (row.depth === 0) {
			visible.add(i);
			continue;
		}

		// Check match
		if (row.node.label.toLowerCase().includes(lower)) {
			visible.add(i);
			// Make all ancestors visible by walking backwards
			const pathPrefix = row.path.slice(0, -1);
			for (let j = i - 1; j >= 0; j--) {
				const ancestor = rows[j]!;
				if (ancestor.separator) continue;
				if (visible.has(j)) break; // already processed this branch
				// Check if this row is an ancestor (its path is a prefix of the match's path)
				if (pathPrefix.length >= ancestor.path.length &&
					ancestor.path.every((seg, idx) => seg === pathPrefix[idx])) {
					visible.add(j);
				}
			}
		}
	}

	// Make separator rows visible if the row they precede is visible
	for (let i = 0; i < rows.length; i++) {
		if (rows[i]?.separator) {
			// Find next non-separator
			let next = i + 1;
			while (next < rows.length && rows[next]?.separator) next++;
			if (next < rows.length && visible.has(next)) {
				visible.add(i);
			}
		}
	}

	return visible;
}

// ── Search bar icon ─────────────────────────────────────────────────
const SEARCH_ICON = "⌕";

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
	searchFocused = false,
	searchText = "",
}: TreeSidebarProps) {
	const [expandedSet, setExpandedSet] = useState<Set<string>>(() => {
		if (persistedState) return new Set(persistedState.expandedPaths);
		// Fully expand the entire tree on first open so users see
		// the complete hierarchy without manual expand clicks.
		const initial = new Set<string>();
		if (tree) {
			function expandAll(node: TreeNode, parentPath: string[]): void {
				const key = [...parentPath, node.id ?? node.label].join(".");
				initial.add(key);
				if (node.children) {
					for (const child of node.children) {
						expandAll(child, [...parentPath, node.id ?? node.label]);
					}
				}
			}
			expandAll(tree, []);
		}
		return initial;
	});
	const [cursorIndex, setCursorIndex] = useState(persistedState?.cursorIndex ?? 0);
	const [scrollOffset, setScrollOffset] = useState(persistedState?.scrollOffset ?? 0);

	// Persist state changes back to parent
	useEffect(() => {
		onStateChange?.({ expandedPaths: expandedSet, cursorIndex, scrollOffset });
	}, [expandedSet, cursorIndex, scrollOffset]);

	// Layout scale from theme context
	const { layout } = useTheme();

	// ── Search filter debounce ─────────────────────────────────
	const [filterPattern, setFilterPattern] = useState("");
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		if (searchText === "") {
			setFilterPattern(""); // immediate clear
			return;
		}
		debounceRef.current = setTimeout(() => {
			setFilterPattern(searchText);
		}, 500);
		return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
	}, [searchText]);

	// ── Search bar visibility ─────────────────────────────────
	// Compact: only show if search is focused or filter is active
	// Standard/spacious: always show
	const searchBarVisible = true;
	const searchBarHeight = searchBarVisible ? 1 : 0;
	const treeHeight = height - searchBarHeight;

	// Flatten tree and insert spacing rows
	const rawRows: FlatRow[] = [];
	if (tree) {
		flattenTree(tree, 0, [], expandedSet, rawRows, true, []);
	}
	const rows = insertSpacingRows(rawRows, layout);

	// Compute visible set based on active filter
	const visibleSet = computeVisibleSet(rows, filterPattern);

	// Helper: does a row directly match the filter (not just visible as ancestor)?
	const lowerFilter = filterPattern.toLowerCase();
	const isFilterMatch = (idx: number): boolean => {
		if (filterPattern === "") return true; // no filter = everything matches
		const row = rows[idx];
		if (!row || row.separator) return false;
		if (row.depth === 0) return true; // root always navigable
		return row.node.label.toLowerCase().includes(lowerFilter);
	};

	// Helper: is a row navigable (not separator, not hidden, not ancestor-only)?
	const isNavigable = (idx: number): boolean => {
		if (idx < 0 || idx >= rows.length) return false;
		if (rows[idx]?.separator) return false;
		if (visibleSet && !visibleSet.has(idx)) return false;
		if (!isFilterMatch(idx)) return false;
		return true;
	};

	// Clamp cursor (skip separator rows and hidden rows)
	let clampedCursor = Math.max(0, Math.min(cursorIndex, rows.length - 1));
	while (clampedCursor < rows.length && !isNavigable(clampedCursor)) clampedCursor++;
	if (clampedCursor >= rows.length) {
		clampedCursor = rows.length - 1;
		while (clampedCursor > 0 && !isNavigable(clampedCursor)) clampedCursor--;
	}
	clampedCursor = Math.max(0, clampedCursor);
	if (clampedCursor !== cursorIndex) {
		setCursorIndex(clampedCursor);
	}

	// Selected path key for highlighting
	const selectedKey = selectedPath.length > 0
		? [tree?.id ?? tree?.label, ...selectedPath].filter(Boolean).join(".")
		: tree?.id ?? tree?.label ?? "";

	// Flag: when jumpToFirstMatch sets the cursor, suppress the next
	// focus-enter effect (which would override it back to the selected root).
	const skipFocusJumpRef = useRef(false);

	// When focus enters the sidebar, jump cursor to the selected node
	useEffect(() => {
		if (!focused || rows.length === 0) return;
		if (skipFocusJumpRef.current) {
			skipFocusJumpRef.current = false;
			return;
		}
		const targetIndex = rows.findIndex((r) => !r.separator && r.path.join(".") === selectedKey);
		if (targetIndex >= 0) {
			setCursorIndex(targetIndex);
		}
	}, [focused]); // intentionally only on focus change

	// Scrolling
	const sidebarLeftPad = layout.sidebarLeftPad;
	const contentWidth = width - GAP_WIDTH - sidebarLeftPad;
	const viewportRows = treeHeight;

	// Build array of visible row indices (respecting filter)
	const visibleIndices: number[] = [];
	for (let i = 0; i < rows.length; i++) {
		if (!visibleSet || visibleSet.has(i)) {
			visibleIndices.push(i);
		}
	}
	const totalVisibleRows = visibleIndices.length;
	const showScrollbar = totalVisibleRows > viewportRows;

	// Keep cursor in view — use visible position, not raw row index
	const cursorVisiblePos = visibleIndices.indexOf(clampedCursor);
	let adjScroll = scrollOffset;
	if (cursorVisiblePos >= 0) {
		if (cursorVisiblePos < adjScroll) {
			adjScroll = cursorVisiblePos;
		} else if (cursorVisiblePos >= adjScroll + viewportRows) {
			adjScroll = cursorVisiblePos - viewportRows + 1;
		}
	}
	if (adjScroll !== scrollOffset) {
		setScrollOffset(adjScroll);
	}

	// ── Helper: auto-expand target and navigate ────────────────
	const navigateToNode = (row: FlatRow) => {
		// Auto-expand if collapsed
		const pathKey = row.path.join(".");
		if (row.hasChildren && !expandedSet.has(pathKey)) {
			setExpandedSet((prev) => new Set(prev).add(pathKey));
		}
		// Navigate (cd)
		const navPath = row.path.slice(1);
		onSelect(navPath);
	};

	// Imperative handle
	useImperativeHandle(sidebarRef, () => ({
		cursorUp: () => {
			setCursorIndex((prev) => {
				let next = prev - 1;
				// Skip separator rows and hidden rows
				while (next >= 0 && !isNavigable(next)) next--;
				return Math.max(0, next);
			});
		},
		cursorDown: () => {
			setCursorIndex((prev) => {
				let next = prev + 1;
				// Skip separator rows and hidden rows
				while (next < rows.length && !isNavigable(next)) next++;
				return next < rows.length ? next : prev;
			});
		},
		expand: () => {
			const row = rows[clampedCursor];
			if (!row || row.separator) return;
			if (row.hasChildren && !row.expanded) {
				const pathKey = row.path.join(".");
				setExpandedSet((prev) => new Set(prev).add(pathKey));
			}
			// No-op on leaves or already-expanded nodes
		},
		selectAsRoot: () => {
			const row = rows[clampedCursor];
			if (!row || row.separator) return;
			// Always navigate (auto-expand if collapsed)
			navigateToNode(row);
		},
		collapseOrParent: () => {
			const row = rows[clampedCursor];
			if (!row || row.separator) return;
			// Root node (depth 0) cannot be collapsed
			if (row.depth === 0) return;
			const pathKey = row.path.join(".");
			if (row.expanded) {
				// Collapse
				setExpandedSet((prev) => {
					const next = new Set(prev);
					next.delete(pathKey);
					return next;
				});
			} else {
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
			if (!row || row.separator || !row.hasChildren) return;
			// Root node (depth 0) cannot be collapsed
			if (row.depth === 0) return;
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
			return (row && !row.separator) ? row.path.slice(1) : [];
		},
		expandMatching: (pattern: string) => {
			if (!tree) return 0;
			const toExpand: string[] = [];
			const walk = (node: TreeNode, parentPath: string[]) => {
				const path = [...parentPath, node.id ?? node.label];
				const pathKey = path.join(".");
				if (node.children && node.children.length > 0) {
					if (globMatch(pattern, node.id ?? node.label)) {
						toExpand.push(pathKey);
					}
					for (const child of node.children) {
						walk(child, path);
					}
				}
			};
			walk(tree, []);
			if (toExpand.length > 0) {
				setExpandedSet((prev) => {
					const next = new Set(prev);
					for (const key of toExpand) next.add(key);
					return next;
				});
			}
			return toExpand.length;
		},
		collapseMatching: (pattern: string) => {
			if (!tree) return 0;
			const toCollapse: string[] = [];
			const walk = (node: TreeNode, parentPath: string[], depth: number) => {
				const path = [...parentPath, node.id ?? node.label];
				const pathKey = path.join(".");
				if (node.children && node.children.length > 0) {
					// Root node (depth 0) is never collapsed
					if (depth > 0 && globMatch(pattern, node.id ?? node.label)) {
						toCollapse.push(pathKey);
					}
					for (const child of node.children) {
						walk(child, path, depth + 1);
					}
				}
			};
			walk(tree, [], 0);
			if (toCollapse.length > 0) {
				setExpandedSet((prev) => {
					const next = new Set(prev);
					for (const key of toCollapse) next.delete(key);
					return next;
				});
			}
			return toCollapse.length;
		},
		jumpToFirstMatch: () => {
			// Suppress the focus-enter effect that would override cursor
			skipFocusJumpRef.current = true;
			// Find the first navigable row after root (skip depth 0)
			for (let i = 0; i < rows.length; i++) {
				if (isNavigable(i) && rows[i]!.depth > 0) {
					setCursorIndex(i);
					return true;
				}
			}
			// Fall back to root
			if (rows.length > 0 && isNavigable(0)) {
				setCursorIndex(0);
				return true;
			}
			return false;
		},
	}), [rows, clampedCursor, expandedSet, onSelect, tree, visibleSet]);

	// ── Mouse interaction ──────────────────────────────────────

	const boxRef = useRef<DOMElement>(null);
	const elementPos = useElementPosition(boxRef);

	// Single click: move cursor + grab focus (instant).
	// Double click: navigate into node (cd + auto-expand).
	const DOUBLE_CLICK_MS = 300;
	const lastClickRef = useRef<{ row: number; time: number } | null>(null);

	useOnClick(boxRef, (event) => {
		const relRow = event.y - elementPos.top;
		// Account for search bar taking the first row
		const treeRelRow = relRow - searchBarHeight;
		if (treeRelRow < 0) return; // clicked on search bar
		// Map viewport row to actual row index via visibleIndices
		const visiblePos = treeRelRow + adjScroll;
		const rowIndex = visibleIndices[visiblePos];
		if (rowIndex == null) return;
		const row = rows[rowIndex];
		if (!row || row.separator) return;

		// Always grab focus and move cursor immediately
		onFocus?.();
		setCursorIndex(rowIndex);

		// Double-click detection
		const now = Date.now();
		const last = lastClickRef.current;

		if (last && last.row === rowIndex && now - last.time < DOUBLE_CLICK_MS) {
			// Double-click — navigate into node (auto-expand + cd)
			lastClickRef.current = null;
			navigateToNode(row);
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
			const maxScroll = Math.max(0, totalVisibleRows - viewportRows);
			setScrollOffset((prev) => Math.min(maxScroll, prev + WHEEL_LINES));
		}
	});

	// ── Render ──────────────────────────────────────────────────

	// Connector line color — dimmer than foreground.muted
	const connectorColor = darkenHex(scheme.foreground.muted, 0.5);
	const leftPad = sidebarLeftPad > 0 ? " ".repeat(sidebarLeftPad) : "";

	if (!tree) {
		// No tree — render empty sidebar with search bar and "no items" placeholder
		const emptyRows: React.ReactNode[] = [];
		for (let i = 0; i < treeHeight; i++) {
			if (i === 0) {
				// "no items" placeholder in dimmed text
				const label = "no items";
				const padRight = Math.max(0, contentWidth - leftPad.length - label.length);
				emptyRows.push(
					<Box key={i}>
						<Text backgroundColor={scheme.backgrounds.sidebar}>
							{leftPad}<Text color={scheme.foreground.muted}>{label}</Text>{" ".repeat(padRight)}
						</Text>
						<Text backgroundColor={scheme.backgrounds.sidebar}>
							{" ".repeat(GAP_WIDTH)}
						</Text>
					</Box>,
				);
			} else {
				emptyRows.push(
					<Box key={i}>
						<Text backgroundColor={scheme.backgrounds.sidebar}>
							{leftPad}{" ".repeat(contentWidth)}
						</Text>
						<Text backgroundColor={scheme.backgrounds.sidebar}>
							{" ".repeat(GAP_WIDTH)}
						</Text>
					</Box>,
				);
			}
		}
		// Build a minimal search bar for the empty state
		const emptySearchBg = scheme.backgrounds.sidebar;
		const emptyIconColor = scheme.foreground.muted;
		const emptySearchRow = (
			<Box key="search-bar">
				<Text backgroundColor={emptySearchBg}>
					{leftPad}
					<Text color={emptyIconColor}>{SEARCH_ICON} </Text>
					<Text>{" ".repeat(Math.max(0, contentWidth - SEARCH_ICON.length - 1))}</Text>
				</Text>
				<Text backgroundColor={scheme.backgrounds.darker}>
					{" ".repeat(GAP_WIDTH)}
				</Text>
			</Box>
		);
		return <Box ref={boxRef} flexDirection="column">{emptySearchRow}{emptyRows}</Box>;
	}

	// Slice visible indices for the current scroll window
	const slicedIndices = visibleIndices.slice(adjScroll, adjScroll + viewportRows);
	const renderedRows: React.ReactNode[] = [];

	for (let i = 0; i < viewportRows; i++) {
		const rowIndex = slicedIndices[i];
		const row = rowIndex != null ? rows[rowIndex] : undefined;
		if (!row) {
			// Empty row below content
			const sb = showScrollbar
				? scrollbarChar(i, viewportRows, totalVisibleRows, adjScroll, scheme)
				: null;
			const padW = contentWidth - (sb ? 1 : 0);
			renderedRows.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{leftPad}{" ".repeat(Math.max(0, padW))}
						{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
					</Text>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{" ".repeat(GAP_WIDTH)}
					</Text>
				</Box>,
			);
			continue;
		}

		// ── Separator row: connector lines only ────────────────
		if (row.separator) {
			const sb = showScrollbar
				? scrollbarChar(i, viewportRows, totalVisibleRows, adjScroll, scheme)
				: null;
			const scrollbarSpace = sb ? 1 : 0;

			// Build connector-only content: column 0 space + ancestor connectors
			const segments: Array<{ text: string; color: string }> = [];
			segments.push({ text: " ", color: scheme.foreground.default }); // column 0 (no diff/indicator)
			for (let d = 1; d < row.depth; d++) {
				const ancestorLast = row.ancestorIsLast[d] ?? false;
				segments.push({
					text: ancestorLast ? CONN_SPACE : CONN_VERT,
					color: connectorColor,
				});
			}
			// At the depth of the node this separator precedes, show vertical
			// continuation if the node is not the last child of its parent
			if (row.depth > 0) {
				segments.push({
					text: row.isLast ? CONN_SPACE : CONN_VERT,
					color: connectorColor,
				});
			}

			const segLen = segments.reduce((sum, s) => sum + s.text.length, 0);
			const padW = Math.max(0, contentWidth - scrollbarSpace - segLen);

			renderedRows.push(
				<Box key={i}>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{leftPad}
						{segments.map((seg, si) => (
							<Text key={si} color={seg.color}>{seg.text}</Text>
						))}
						<Text>{" ".repeat(padW)}</Text>
						{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
					</Text>
					<Text backgroundColor={scheme.backgrounds.sidebar}>
						{" ".repeat(GAP_WIDTH)}
					</Text>
				</Box>,
			);
			continue;
		}

		const pathKey = row.path.join(".");
		const isCurrentRoot = pathKey === selectedKey;
		const isCursorRow = rowIndex === clampedCursor;

		// ── Build row content as segments ──────────────────────

		// Determine colors
		let fg = scheme.foreground.default;
		let bg = scheme.backgrounds.sidebar;

		// Diff tinted background (applied before cursor check so cursor wins)
		if (row.node.diff && DIFF_COLORS[row.node.diff]) {
			bg = mix(DIFF_COLORS[row.node.diff]!, scheme.backgrounds.sidebar, DIFF_BG_ALPHA);
		}

		// When filter is active, dim ancestor-only rows (visible but not matching)
		const isFilterAncestorOnly = filterPattern !== "" && rowIndex != null
			&& !row.node.label.toLowerCase().includes(filterPattern.toLowerCase())
			&& row.depth > 0; // root is always full brightness

		if (isCursorRow && (focused || searchFocused)) {
			fg = brand.signal;
			bg = scheme.backgrounds.raised;
		} else if (isCurrentRoot) {
			fg = scheme.foreground.bright;
		} else if (isFilterAncestorOnly) {
			fg = scheme.foreground.muted;
		} else if (row.node.dimmed) {
			fg = scheme.foreground.muted;
		}

		const isBold = isCurrentRoot;

		// Segments: array of { text, color, bold? } to render
		const segments: Array<{ text: string; color: string; bold?: boolean }> = [];

		if (row.depth === 0) {
			// Root node: > if current root, diff char, or expand triangle
			if (isCurrentRoot) {
				segments.push({ text: ">", color: fg, bold: true });
			} else if (row.node.diff && DIFF_CHARS[row.node.diff]) {
				segments.push({ text: DIFF_CHARS[row.node.diff]!, color: DIFF_COLORS[row.node.diff]! });
			} else {
				const icon = row.expanded ? "▾" : "▸";
				segments.push({ text: icon, color: fg });
			}
			// Root dot (sound generators typically have no dot, but respect data)
			if (row.node.colour != null && row.node.filledDot != null) {
				const dot = row.node.filledDot ? " ● " : " ○ ";
				segments.push({ text: dot, color: row.node.colour });
			} else {
				segments.push({ text: " ", color: fg });
			}
		} else {
			// Non-root: column 0 is > indicator, diff char, or space
			if (isCurrentRoot) {
				segments.push({ text: ">", color: fg, bold: true });
			} else if (row.node.diff && DIFF_CHARS[row.node.diff]) {
				segments.push({ text: DIFF_CHARS[row.node.diff]!, color: DIFF_COLORS[row.node.diff]! });
			} else {
				segments.push({ text: " ", color: fg });
			}

			// Connector lines for depths 1..depth-1 (ancestor continuation)
			for (let d = 1; d < row.depth; d++) {
				// ancestorIsLast[d] tells us if the ancestor at depth d was the last child
				const ancestorLast = row.ancestorIsLast[d] ?? false;
				segments.push({
					text: ancestorLast ? CONN_SPACE : CONN_VERT,
					color: connectorColor,
				});
			}

			// Own connector (branch or last)
			segments.push({
				text: row.isLast ? CONN_LAST : CONN_BRANCH,
				color: connectorColor,
			});

			// Expand icon
			if (row.hasChildren) {
				segments.push({ text: row.expanded ? "▾ " : "▸ ", color: fg });
			} else {
				segments.push({ text: "  ", color: fg });
			}
		}

		// Dot indicator (data-driven: filledDot + colour set by propagateChainColors)
		if (row.node.colour != null && row.node.filledDot != null) {
			const dot = row.node.filledDot ? "● " : "○ ";
			const dotColor = row.node.dimmed ? darkenHex(row.node.colour, 0.7) : row.node.colour;
			segments.push({ text: dot, color: dotColor });
		} else {
			// No dot (sound generator not in a chain) — alignment spacing
			segments.push({ text: "  ", color: fg });
		}

		// Label
		const label = nodeLabel(row.node);
		segments.push({ text: label, color: fg, bold: isBold });

		// Compute total text length
		const totalTextLen = segments.reduce((sum, s) => sum + s.text.length, 0);

		// Truncate if needed
		const scrollbarSpace = showScrollbar ? 1 : 0;
		const maxWidth = contentWidth - scrollbarSpace;
		let truncated = false;
		if (totalTextLen > maxWidth) {
			// Truncate the last segment (label)
			const overflow = totalTextLen - maxWidth + 1; // +1 for …
			const lastSeg = segments[segments.length - 1]!;
			if (lastSeg.text.length > overflow) {
				lastSeg.text = lastSeg.text.slice(0, lastSeg.text.length - overflow) + "\u2026";
			}
			truncated = true;
		}
		const renderedLen = segments.reduce((sum, s) => sum + s.text.length, 0);
		const padRight = Math.max(0, maxWidth - renderedLen);

		// Scrollbar
		const sb = showScrollbar
			? scrollbarChar(i, viewportRows, totalVisibleRows, adjScroll, scheme)
			: null;

		renderedRows.push(
			<Box key={i}>
				<Text backgroundColor={bg}>
					{leftPad}
					{segments.map((seg, si) => (
						<Text key={si} color={seg.color} bold={seg.bold}>{seg.text}</Text>
					))}
					<Text>{" ".repeat(padRight)}</Text>
					{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
				</Text>
				<Text backgroundColor={scheme.backgrounds.darker}>
					{" ".repeat(GAP_WIDTH)}
				</Text>
			</Box>,
		);
	}

	// ── Search bar row ─────────────────────────────────────────
	const searchBarRow = searchBarVisible ? (() => {
		const iconColor = searchFocused
			? brand.signal
			: filterPattern
				? scheme.foreground.default
				: scheme.foreground.muted;
		const searchBg = searchFocused
			? scheme.backgrounds.raised
			: scheme.backgrounds.sidebar;
		const textColor = searchFocused
			? scheme.foreground.bright
			: scheme.foreground.muted;

		// Render search text with cursor
		const displayText = searchText;
		const iconStr = SEARCH_ICON + " ";
		const maxTextLen = Math.max(0, contentWidth - iconStr.length);
		const truncText = displayText.length > maxTextLen
			? displayText.slice(displayText.length - maxTextLen)
			: displayText;
		const padLen = Math.max(0, contentWidth - iconStr.length - truncText.length);

		// Match count (shown when filter is active and not focused)
		let countStr = "";
		if (filterPattern && !searchFocused) {
			const matchCount = visibleSet ? visibleSet.size : 0;
			countStr = ` ${matchCount}`;
		}
		const padWithCount = Math.max(0, padLen - countStr.length);

		return (
			<Box key="search-bar">
				<Text backgroundColor={searchBg}>
					{leftPad}
					<Text color={iconColor}>{iconStr}</Text>
					<Text color={textColor}>{truncText}</Text>
					{searchFocused && <Text backgroundColor={scheme.foreground.bright}>{" "}</Text>}
					<Text>{" ".repeat(Math.max(0, searchFocused ? padWithCount - 1 : padWithCount))}</Text>
					{countStr ? <Text color={scheme.foreground.muted}>{countStr}</Text> : null}
				</Text>
				<Text backgroundColor={scheme.backgrounds.darker}>
					{" ".repeat(GAP_WIDTH)}
				</Text>
			</Box>
		);
	})() : null;

	return (
		<Box ref={boxRef} flexDirection="column">
			{searchBarRow}
			{renderedRows}
		</Box>
	);
});
