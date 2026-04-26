// ── Output — virtualized viewport slicer for pre-rendered blocks ────
//
// Renders command results as pre-rendered ANSI string lines. On each
// scroll tick, only the visible line slice is joined and rendered as a
// single <Text> element. No ControlledScrollView, no Yoga layout of
// off-screen content. The ScrollBar component sits alongside.
//
// Performance: scroll renders cost <1ms React + minimal Ink overhead
// because the component tree is always just one Box + one Text + one
// ScrollBar, regardless of content size.

import React from "react";
import { Box, Text } from "ink";
import { ScrollBar } from "@byteland/ink-scroll-bar";
import { useTheme } from "../theme-context.js";
import { LandingLogo } from "./LandingLogo.js";
import type { PrerenderedBlock } from "./prerender.js";

// ── Constants ───────────────────────────────────────────────────────

export const MAX_HISTORY_BLOCKS = 500;
const SCROLLBAR_WIDTH = 1;
/** Empty line between blocks (spacing margin) */
const BLOCK_GAP = 1;

// ── Line buffer helpers ─────────────────────────────────────────────

/** Flatten blocks into a single line array with gap lines between blocks. */
export function flattenBlocks(blocks: PrerenderedBlock[]): string[] {
	if (blocks.length === 0) return [];
	const result: string[] = [];
	for (let i = 0; i < blocks.length; i++) {
		if (i > 0) {
			// Gap between blocks
			for (let g = 0; g < BLOCK_GAP; g++) result.push("");
		}
		for (const line of blocks[i]!.lines) {
			result.push(line);
		}
	}
	return result;
}

/** Compute total line count for blocks with gaps. */
export function totalLineCount(blocks: PrerenderedBlock[]): number {
	if (blocks.length === 0) return 0;
	let count = 0;
	for (const block of blocks) count += block.height;
	// Add gaps between blocks
	count += (blocks.length - 1) * BLOCK_GAP;
	return count;
}

// ── Output component ────────────────────────────────────────────────

export interface OutputProps {
	/** Pre-rendered blocks */
	blocks: PrerenderedBlock[];
	/** Flattened line buffer (computed by parent, avoids re-flattening on scroll) */
	allLines: string[];
	/** Total line count */
	totalLines: number;
	/** Viewport height in terminal rows */
	viewportHeight: number;
	/** Total viewport width */
	columns: number;
	/** Show the landing logo when no blocks */
	animate?: boolean;
	/** Controlled scroll offset (line index) */
	scrollOffset: number;
	/** Hide the scrollbar (e.g. when completion popup overlays it) */
	hideScrollbar?: boolean;
	/** When set, shows an "update available" line below the version on the landing logo. */
	updateInfo?: { latest: string } | null;
}

export const Output = React.memo(function Output({
	blocks,
	allLines,
	totalLines,
	viewportHeight,
	columns,
	animate,
	scrollOffset,
	hideScrollbar,
	updateInfo,
}: OutputProps) {
	const { scheme, layout } = useTheme();

	if (blocks.length === 0) {
		return (
			<LandingLogo
				viewportHeight={viewportHeight}
				columns={columns}
				scheme={scheme}
				animate={animate}
				updateInfo={updateInfo}
			/>
		);
	}

	const contentCols = columns - SCROLLBAR_WIDTH;
	const pad = layout.horizontalPad;

	// Slice visible lines from the flat buffer
	const visibleSlice = allLines.slice(scrollOffset, scrollOffset + viewportHeight);
	// Pad with empty lines if content is shorter than viewport
	while (visibleSlice.length < viewportHeight) {
		visibleSlice.push("");
	}

	return (
		<Box flexDirection="row" width={columns} height={viewportHeight} backgroundColor={scheme.backgrounds.standard}>
			<Box flexDirection="column" width={contentCols} height={viewportHeight} paddingX={pad}>
				{visibleSlice.map((line, i) => (
					<Text key={i}>{line || " "}</Text>
				))}
			</Box>
			{hideScrollbar ? (
				<Box width={SCROLLBAR_WIDTH} />
			) : (
				<ScrollBar
					placement="inset"
					thumbChar={"\u2588"}
					trackChar={"\u2502"}
					contentHeight={totalLines}
					viewportHeight={viewportHeight}
					scrollOffset={scrollOffset}
					color={scheme.foreground.muted}
				/>
			)}
		</Box>
	);
});
