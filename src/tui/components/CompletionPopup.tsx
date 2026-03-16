// ── CompletionPopup — dropdown above input ──────────────────────────

// Appears above the input line when tab completion is triggered.
// Max 8 visible items, scrollable, arrow-key navigable, mouse-wheel support.
// Tab/Enter accepts selected item, Escape dismisses.
// No border — just a filled rectangle with overlay background.

import React, { useRef } from "react";
import { Box, Text, useInput, type DOMElement } from "ink";
import { useOnWheel } from "@ink-tools/ink-mouse";
import type { CompletionItem } from "../../engine/modes/mode.js";
import type { ColorScheme } from "../theme.js";
import { brand } from "../theme.js";
import { scrollbarChar } from "./scrollbar.js";

// ── Types ───────────────────────────────────────────────────────────

export interface CompletionPopupProps {
	/** Completion candidates */
	items: CompletionItem[];
	/** Currently selected index */
	selectedIndex: number;
	/** Callback when selection changes */
	onSelect: (index: number) => void;
	/** Callback when an item is accepted (Tab or Enter) */
	onAccept: (item: CompletionItem) => void;
	/** Callback when popup is dismissed */
	onDismiss: () => void;
	/** Left offset for alignment (chars from left edge) */
	leftOffset: number;
	/** Color scheme */
	scheme: ColorScheme;
	/** Max visible items */
	maxVisible?: number;
	/** Total viewport rows (for absolute positioning) */
	rows?: number;
	/** Total viewport columns (for filling background) */
	columns?: number;
}

// ── Constants ───────────────────────────────────────────────────────

const DEFAULT_MAX_VISIBLE = 8;
const WHEEL_LINES = 3;

// ── Component ───────────────────────────────────────────────────────

export const CompletionPopup = React.memo(function CompletionPopup({
	items,
	selectedIndex,
	onSelect,
	onAccept,
	onDismiss,
	leftOffset,
	scheme,
	maxVisible = DEFAULT_MAX_VISIBLE,
	rows: viewportRows,
	columns: viewportColumns,
}: CompletionPopupProps) {
	const visibleCount = Math.min(items.length, maxVisible);

	// Calculate scroll window around selected index
	const scrollTop = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(visibleCount / 2),
			items.length - visibleCount,
		),
	);
	const visibleItems = items.slice(scrollTop, scrollTop + visibleCount);

	// Scrollbar: only shown when items overflow
	const showScrollbar = items.length > visibleCount;

	// Calculate column widths
	const maxLabelWidth = Math.max(
		...items.map((i) => i.label.length),
		8,
	);
	const maxDetailWidth = Math.max(
		...items.map((i) => (i.detail?.length ?? 0)),
		0,
	);
	const contentWidth = maxLabelWidth + 2 + (maxDetailWidth > 0 ? maxDetailWidth + 2 : 0);
	const innerWidth = Math.min(contentWidth, 50);

	// Keyboard input
	useInput((_input, key) => {
		if (key.escape) {
			onDismiss();
		} else if (key.upArrow) {
			const next = selectedIndex > 0 ? selectedIndex - 1 : items.length - 1;
			onSelect(next);
		} else if (key.downArrow) {
			const next = selectedIndex < items.length - 1 ? selectedIndex + 1 : 0;
			onSelect(next);
		} else if (key.return || key.tab) {
			if (items[selectedIndex]) {
				onAccept(items[selectedIndex]);
			}
		}
	});

	// Mouse wheel scrolling
	const boxRef = useRef<DOMElement>(null);
	useOnWheel(boxRef, (event) => {
		if (event.button === "wheel-up") {
			const next = Math.max(0, selectedIndex - WHEEL_LINES);
			onSelect(next);
		} else if (event.button === "wheel-down") {
			const next = Math.min(items.length - 1, selectedIndex + WHEEL_LINES);
			onSelect(next);
		}
	});

	// Absolute positioning: sit just above the input area.
	// Input section = 3 rows, statusbar = 1, gap = 1 → bottom anchor at rows - 5.
	// +1 to nudge one line down per user request.
	const popupHeight = visibleCount;
	const BOTTOM_OFFSET = 4; // input(3) + statusbar (shifted down by 1 vs old value of 5)
	const marginTop = viewportRows
		? Math.max(0, viewportRows - BOTTOM_OFFSET - popupHeight)
		: undefined;

	const totalCols = viewportColumns ?? 80;
	const bg = scheme.backgrounds.overlay;

	return (
		<Box
			ref={boxRef}
			flexDirection="column"
			{...(viewportRows ? { position: "absolute" as const, marginLeft: 0, marginTop: marginTop } : {})}
		>
			{visibleItems.map((item, i) => {
				const actualIndex = scrollTop + i;
				const isSelected = actualIndex === selectedIndex;
				const fgName = isSelected ? brand.signal : scheme.foreground.default;
				const fgDetail = isSelected ? scheme.foreground.bright : scheme.foreground.muted;

				const label = item.label.padEnd(maxLabelWidth);
				const detail = item.detail
					? "  " + (item.detail.length > innerWidth - maxLabelWidth - 4
						? item.detail.slice(0, innerWidth - maxLabelWidth - 5) + "\u2026"
						: item.detail)
					: "";
				const lineContent = " " + label + detail + " ";
				const scrollbarSpace = showScrollbar ? 1 : 0;
				const rightPad = Math.max(0, totalCols - leftOffset - lineContent.length - scrollbarSpace);

				// Scrollbar character for this row
				const sb = showScrollbar
					? scrollbarChar(i, visibleCount, items.length, scrollTop, scheme)
					: null;

				return (
					<Text key={actualIndex} backgroundColor={bg}>
						<Text backgroundColor={bg}>{" ".repeat(leftOffset)}</Text>
						<Text color={fgName}> {label}</Text>
						<Text color={fgDetail}>{detail} </Text>
						<Text>{" ".repeat(rightPad)}</Text>
						{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
					</Text>
				);
			})}
		</Box>
	);
});
