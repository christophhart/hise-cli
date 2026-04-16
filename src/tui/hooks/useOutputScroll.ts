// ── Output blocks + scroll state hook ────────────────────────────────

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { PrerenderedBlock } from "../components/prerender.js";
import {
	MAX_HISTORY_BLOCKS,
	flattenBlocks,
	totalLineCount,
} from "../components/Output.js";
import { truncateAnsi } from "../components/prerender.js";
import type { LayoutDensity } from "../layout.js";

export interface OutputScrollState {
	/** Current output blocks. */
	outputBlocks: PrerenderedBlock[];
	/** Direct setter for output blocks (used by handleSubmit for clear, inline updates, etc.). */
	setOutputBlocks: React.Dispatch<React.SetStateAction<PrerenderedBlock[]>>;
	/** Ref snapshot of outputBlocks (for async callbacks). */
	outputBlocksRef: React.RefObject<PrerenderedBlock[]>;
	/** Current scroll offset (lines from top). */
	scrollOffset: number;
	/** Direct setter for scroll offset. */
	setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
	/** Ref snapshot of scrollOffset (for async callbacks). */
	scrollOffsetRef: React.RefObject<number>;
	/** Flattened line array (recomputed on block change). */
	allLines: string[];
	/** Total line count across all blocks. */
	totalLines: number;
	/** Whether user has manually scrolled away from bottom. */
	userScrolledRef: React.RefObject<boolean>;
	/** Max scroll offset for current content/viewport. */
	maxScrollOffset: () => number;
	/** Scroll by delta lines. */
	scrollBy: (delta: number) => void;
	/** Scroll to bottom (auto-scroll position). */
	scrollToBottom: () => void;
	/** Scroll to top. */
	scrollToTop: () => void;
	/** Append blocks to output (trims to MAX_HISTORY_BLOCKS). */
	addBlocks: (newBlocks: PrerenderedBlock[]) => void;
	/** Re-wrap output blocks after content width change. */
	rewrapBlocks: (innerW: number) => void;
}

export function useOutputScroll(
	outputHeight: number,
	sidebarVisible: boolean,
	contentColumns: number,
	layout: { horizontalPad: number },
): OutputScrollState {
	const [outputBlocks, setOutputBlocks] = useState<PrerenderedBlock[]>([]);
	const [scrollOffset, setScrollOffset] = useState(0);
	const userScrolledRef = useRef(false);

	// Refs for async snapshot access
	const outputBlocksRef = useRef(outputBlocks);
	outputBlocksRef.current = outputBlocks;
	const scrollOffsetRef = useRef(scrollOffset);
	scrollOffsetRef.current = scrollOffset;

	// Derived
	const allLines = useMemo(() => flattenBlocks(outputBlocks), [outputBlocks]);
	const totalLines = useMemo(() => totalLineCount(outputBlocks), [outputBlocks]);
	const totalLinesRef = useRef(totalLines);
	totalLinesRef.current = totalLines;

	// Scroll helpers
	const maxScrollOffset = useCallback(
		() => Math.max(0, totalLinesRef.current - outputHeight),
		[outputHeight],
	);

	const scrollBy = useCallback(
		(delta: number) => {
			setScrollOffset((prev) => {
				const max = maxScrollOffset();
				const next = Math.max(0, Math.min(max, prev + delta));
				userScrolledRef.current = next < max;
				return next;
			});
		},
		[maxScrollOffset],
	);

	const scrollToBottom = useCallback(() => {
		const max = maxScrollOffset();
		setScrollOffset(max);
		userScrolledRef.current = false;
	}, [maxScrollOffset]);

	const scrollToTop = useCallback(() => {
		setScrollOffset(0);
		userScrolledRef.current = outputBlocks.length > 0;
	}, [outputBlocks.length]);

	const addBlocks = useCallback((newBlocks: PrerenderedBlock[]) => {
		setOutputBlocks((prev) => {
			const combined = [...prev, ...newBlocks];
			if (combined.length > MAX_HISTORY_BLOCKS) {
				combined.splice(0, combined.length - MAX_HISTORY_BLOCKS);
			}
			return combined;
		});
	}, []);

	// Auto-scroll to bottom when new content arrives
	useEffect(() => {
		if (!userScrolledRef.current) {
			setScrollOffset(maxScrollOffset());
		}
	}, [totalLines, maxScrollOffset]);

	// Re-wrap output blocks when sidebar visibility toggles
	const sidebarMountedRef = useRef(true);
	const rewrapBlocks = useCallback((innerW: number) => {
		setOutputBlocks((prev) =>
			prev.map((block) => ({
				lines: block.lines.map((l) => truncateAnsi(l, innerW)),
				height: block.height,
			})),
		);
	}, []);

	useEffect(() => {
		if (sidebarMountedRef.current) {
			sidebarMountedRef.current = false;
			return;
		}
		const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
		rewrapBlocks(innerW);
	}, [sidebarVisible]);

	return {
		outputBlocks,
		setOutputBlocks,
		outputBlocksRef,
		scrollOffset,
		setScrollOffset,
		scrollOffsetRef,
		allLines,
		totalLines,
		userScrolledRef,
		maxScrollOffset,
		scrollBy,
		scrollToBottom,
		scrollToTop,
		addBlocks,
		rewrapBlocks,
	};
}
