// ── CompletionPopup — dropdown above input ──────────────────────────

// Appears above the input line when tab completion is triggered.
// Max 8 visible items, scrollable, arrow-key navigable, mouse-wheel support.
// Tab/Enter accepts selected item, Escape dismisses.
// No border — just a filled rectangle with overlay background.

import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
// Note: useInput intentionally NOT imported — CompletionPopup is fully
// controlled by the central key dispatcher in app.tsx via callbacks.
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
	/** Header label (e.g. "Slash commands", "Module types") */
	label?: string;
	/** Max visible items */
	maxVisible?: number;
	/** Max inner width of the popup content */
	maxWidth?: number;
	/** Total viewport rows (for absolute positioning) */
	rows?: number;
	/** Total viewport columns (for filling background) */
	columns?: number;
	/** Rows consumed below the popup anchor (input + statusbar chrome).
	 *  Defaults to 4 for backward compatibility (compact: input=3 + statusbar=1). */
	bottomOffset?: number;
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
	label,
	maxVisible = DEFAULT_MAX_VISIBLE,
	maxWidth: maxWidthProp,
	rows: viewportRows,
	columns: viewportColumns,
	bottomOffset = 4,
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
	const innerWidth = Math.min(contentWidth, maxWidthProp ?? 50);

	// Note: keyboard input is handled by the central key dispatcher
	// in app.tsx which calls onSelect/onAccept/onDismiss as needed.
	// This component only handles mouse wheel scrolling.

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
	// bottomOffset accounts for input section + statusbar chrome height.
	const headerRows = label ? 1 : 0;
	const popupHeight = visibleCount + headerRows;
	const marginTop = viewportRows
		? Math.max(0, viewportRows - bottomOffset - popupHeight)
		: undefined;

	const totalCols = viewportColumns ?? 80;
	const bg = scheme.backgrounds.overlay;

	return (
		<Box
			ref={boxRef}
			flexDirection="column"
			{...(viewportRows ? { position: "absolute" as const, marginLeft: 0, marginTop: marginTop } : {})}
		>
			{label ? (
				<Text backgroundColor={bg}>
					<Text backgroundColor={bg}>{" ".repeat(leftOffset)}</Text>
					<Text color={scheme.foreground.muted}> {label}</Text>
					<Text>{" ".repeat(Math.max(0, totalCols - leftOffset - label.length - 2))}</Text>
				</Text>
			) : null}
			{visibleItems.map((item, i) => {
				const actualIndex = scrollTop + i;
				const isSelected = actualIndex === selectedIndex;
				const fgName = isSelected ? brand.signal : scheme.foreground.default;
				const fgDetail = isSelected ? scheme.foreground.bright : scheme.foreground.muted;

				const paddedLabel = item.label.padEnd(maxLabelWidth);
				const detail = item.detail
					? "  " + (item.detail.length > innerWidth - maxLabelWidth - 4
						? item.detail.slice(0, innerWidth - maxLabelWidth - 5) + "\u2026"
						: item.detail)
					: "";
				const lineContent = " " + paddedLabel + detail + " ";
				const scrollbarSpace = showScrollbar ? 1 : 0;
				const rightPad = Math.max(0, totalCols - leftOffset - lineContent.length - scrollbarSpace);

				// Scrollbar character for this row
				const sb = showScrollbar
					? scrollbarChar(i, visibleCount, items.length, scrollTop, scheme)
					: null;

				return (
					<Text key={actualIndex} backgroundColor={bg}>
						<Text backgroundColor={bg}>{" ".repeat(leftOffset)}</Text>
						<Text color={fgName}> {paddedLabel}</Text>
						<Text color={fgDetail}>{detail} </Text>
						<Text>{" ".repeat(rightPad)}</Text>
						{sb ? <Text color={sb.color}>{sb.char}</Text> : null}
					</Text>
				);
			})}
		</Box>
	);
});
