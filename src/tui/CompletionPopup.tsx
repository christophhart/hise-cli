// ── CompletionPopup — dropdown above input ──────────────────────────

// Appears above the input line when tab completion is triggered.
// Max 8 visible items, scrollable, arrow-key navigable, mouse-wheel support.
// Tab/Enter accepts selected item, Escape dismisses.

import React, { useRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useOnWheel } from "@ink-tools/ink-mouse";
import type { CompletionItem } from "../engine/modes/mode.js";
import type { ColorScheme } from "./theme.js";
import { brand } from "./theme.js";

export interface CompletionPopupProps {
	items: CompletionItem[];
	selectedIndex: number;
	onSelect: (index: number) => void;
	onAccept: (item: CompletionItem) => void;
	onDismiss: () => void;
	leftOffset: number;
	scheme: ColorScheme;
	label?: string;
	maxVisible?: number;
	columns?: number;
}

const DEFAULT_MAX_VISIBLE = 8;
const WHEEL_LINES = 3;

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
	columns: viewportColumns,
}: CompletionPopupProps) {
	const visibleCount = Math.min(items.length, maxVisible);

	const scrollTop = Math.max(
		0,
		Math.min(
			selectedIndex - Math.floor(visibleCount / 2),
			items.length - visibleCount,
		),
	);
	const visibleItems = items.slice(scrollTop, scrollTop + visibleCount);

	const totalCols = viewportColumns ?? 80;

	const maxLabelWidth = Math.max(
		...items.map((i) => i.label.length),
		8,
	);
	const maxDetailWidth = Math.max(
		...items.map((i) => (i.detail?.length ?? 0)),
		0,
	);
	const availableWidth = totalCols - leftOffset;
	const contentWidth = maxLabelWidth + 2 + (maxDetailWidth > 0 ? maxDetailWidth + 2 : 0);
	const innerWidth = Math.min(contentWidth, availableWidth);

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

	const bg = scheme.backgrounds.overlay;

	return (
		<Box ref={boxRef} flexDirection="column">
			{label ? (
				<Text backgroundColor={bg}>
					<Text backgroundColor={bg}>{" ".repeat(Math.max(0, leftOffset - 1))}</Text>
					<Text color={scheme.foreground.muted}> {label}</Text>
					<Text>{" ".repeat(Math.max(0, totalCols - leftOffset - label.length - 1))}</Text>
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
						? item.detail.slice(0, innerWidth - maxLabelWidth - 5) + "…"
						: item.detail)
					: "";
				const lineContent = " " + paddedLabel + detail + " ";
				const rightPad = Math.max(0, totalCols - leftOffset - lineContent.length);

				return (
					<Text key={actualIndex} backgroundColor={bg}>
						<Text backgroundColor={bg}>{" ".repeat(Math.max(0, leftOffset - 1))}</Text>
						<Text color={fgName}> {paddedLabel}</Text>
						<Text color={fgDetail}>{detail} </Text>
						<Text>{" ".repeat(rightPad)}</Text>
					</Text>
				);
			})}
		</Box>
	);
});
