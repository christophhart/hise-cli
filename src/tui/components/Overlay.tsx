// ── Overlay — centered floating panel ───────────────────────────────

// Generic reusable overlay panel. Used by /help. Renders centered over
// the REPL using absolute positioning.
// No borders — solid filled rectangle with overlay background, sized
// to OVERLAY_WIDTH and centered horizontally.
//
// Escape dismisses, Up/Down/PgUp/PgDn/mouse wheel scrolls body content.
// Captures all input while visible — parent must gate input.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useOnWheel } from "@ink-tools/ink-mouse";
import { ControlledScrollView } from "ink-scroll-view";
import type { ControlledScrollViewRef } from "ink-scroll-view";
import { ScrollBar } from "@byteland/ink-scroll-bar";
import type { ColorScheme } from "../theme.js";
import { Markdown } from "./Markdown.js";
import { darkenHex } from "../theme.js";

// ── Types ───────────────────────────────────────────────────────────

export type OverlaySize = "overlay_compact" | "overlay_standard";

export interface OverlayProps {
	/** Title shown in header row */
	title: string;
	/** Accent color (used for title text) */
	accent: string;
	/** Markdown content (preferred) */
	content?: string;
	/** Legacy plain text lines (fallback) */
	lines?: string[];
	/** Optional footer text (right-aligned) */
	footer?: string;
	/** Called when overlay is dismissed (Escape) */
	onClose: () => void;
	/** Total viewport width */
	columns: number;
	/** Total viewport height (rows). When provided, uses absolute positioning. */
	rows?: number;
	/** Color scheme */
	scheme: ColorScheme;
	/** Overlay size preset (defaults to overlay_standard) */
	size?: OverlaySize;
}

// ── Constants ───────────────────────────────────────────────────────

export const OVERLAY_SIZES = {
	overlay_compact: { width: 60, height: 20 },
	overlay_standard: { width: 90, height: 35 },
} as const;
const H_PAD = 2; // horizontal inner padding (chars)
const SCROLL_WHEEL_LINES = 3;
const PAGE_SCROLL_LINES = 10;

// ── Component ───────────────────────────────────────────────────────

export const Overlay = React.memo(function Overlay({
	title,
	accent,
	content,
	lines: legacyLines,
	footer,
	onClose,
	columns,
	rows: viewportRows,
	scheme,
	size,
}: OverlayProps) {
	const boxRef = useRef<DOMElement>(null);
	const scrollRef = useRef<ControlledScrollViewRef>(null);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [contentHeight, setContentHeight] = useState(0);

	// Track content height for the scrollbar
	useEffect(() => {
		setContentHeight(scrollRef.current?.getContentHeight() ?? 0);
	});

	// Get dimensions from size preset (defaults to overlay_standard)
	const { width: overlayWidth, height: overlayHeight } = OVERLAY_SIZES[size || "overlay_standard"];

	// Layout: pad-top(1) + header(1) + spacer(1) + content-pad(1) + body + spacer(1) + footer(1) + pad-bottom(1) = body + 7
	const bodyHeight = overlayHeight - 7;
	// Usable content width inside horizontal padding (used for header/footer)
	const contentWidth = overlayWidth - H_PAD * 2;
	// Body content width (narrower by 1 for scrollbar)
	const bodyContentWidth = contentWidth - 1;

	// Scroll with proper clamping to bottomOffset (workaround for ink-scroll-view bug)
	const scrollBy = useCallback((delta: number) => {
		const bottomOffset = scrollRef.current?.getBottomOffset() ?? 0;
		setScrollOffset(prev => Math.max(0, Math.min(prev + delta, bottomOffset)));
	}, []);

	// Capture all keyboard input while overlay is visible
	useInput((_input, key) => {
		if (key.escape) {
			onClose();
		} else if (key.upArrow) {
			scrollBy(-1);
		} else if (key.downArrow) {
			scrollBy(1);
		} else if (key.pageUp) {
			scrollBy(-PAGE_SCROLL_LINES);
		} else if (key.pageDown) {
			scrollBy(PAGE_SCROLL_LINES);
		} else if (key.home) {
			setScrollOffset(0);
		} else if (key.end) {
			const bottomOffset = scrollRef.current?.getBottomOffset() ?? 0;
			setScrollOffset(bottomOffset);
		}
	});

	// Mouse wheel scrolling
	useOnWheel(boxRef, (event) => {
		if (event.button === "wheel-up") {
			scrollBy(-SCROLL_WHEEL_LINES);
		} else if (event.button === "wheel-down") {
			scrollBy(SCROLL_WHEEL_LINES);
		}
	});

	const bg = scheme.backgrounds.overlay;
	const headerBg = darkenHex(bg, 0.85);
	const topPad = viewportRows
		? Math.max(0, Math.floor((viewportRows - overlayHeight) / 2))
		: 0;
	const leftMargin = Math.max(0, Math.floor((columns - overlayWidth) / 2));
	const pad = " ".repeat(H_PAD);

	// Header
	const escHint = "[Esc] Close";
	const titleSpace = contentWidth - escHint.length - 1;
	const truncTitle = title.length > titleSpace
		? title.slice(0, titleSpace - 1) + "\u2026"
		: title;
	const headerGap = Math.max(1, contentWidth - truncTitle.length - escHint.length);

	// Footer
	const footerText = footer ?? "";
	const footerGap = Math.max(1, contentWidth - footerText.length);

	// Helper: render a row that is exactly OVERLAY_WIDTH with bg
	const row = (content: React.ReactNode, key?: string | number, rowBg?: string) => (
		<Text key={key}>
			<Text backgroundColor={rowBg || bg}>
				{pad}{content}{pad}
			</Text>
		</Text>
	);

	const emptyRow = (key: string, rowBg?: string) => row(
		<Text>{" ".repeat(contentWidth)}</Text>,
		key,
		rowBg,
	);

	// Build body content
	const bodyContent = content
		? (
			<Markdown scheme={scheme} accent={accent} width={bodyContentWidth} context="overlay">
				{content}
			</Markdown>
		)
		: (
			<Text>{legacyLines?.join('\n') ?? ''}</Text>
		);

	return (
		<Box
			ref={boxRef}
			flexDirection="column"
			{...(viewportRows
				? { position: "absolute" as const, marginLeft: leftMargin, marginTop: topPad }
				: {}
			)}
		>
			{/* Top padding row */}
			{emptyRow("pad-top", headerBg)}

			{/* Header row */}
			{row(
				<>
					<Text color={accent} bold>{truncTitle}</Text>
					<Text color={scheme.foreground.muted}>
						{" ".repeat(headerGap)}{escHint}
					</Text>
				</>,
				"header",
				headerBg,
			)}

		{/* Spacer between header and content */}
		{emptyRow("spacer-top", headerBg)}

		{/* Content padding (1 line breathing room) */}
		{emptyRow("content-pad")}

		{/* Body - scrollable content with scrollbar */}
		<Box flexDirection="row" width={overlayWidth} height={bodyHeight} backgroundColor={bg}>
			<ControlledScrollView ref={scrollRef} scrollOffset={scrollOffset} width={overlayWidth - 1} height={bodyHeight}>
				<Box paddingX={H_PAD} width={overlayWidth - 1}>
					{bodyContent}
				</Box>
			</ControlledScrollView>
			<ScrollBar
				placement="inset"
				thumbChar={"\u2588"}
				trackChar={"\u2502"}
				contentHeight={contentHeight}
				viewportHeight={bodyHeight}
				scrollOffset={scrollOffset}
				color={scheme.foreground.muted}
			/>
		</Box>

			{/* Spacer between body and footer */}
			{emptyRow("spacer-bottom")}

			{/* Footer row */}
			{row(
				<Text color={scheme.foreground.muted}>
					{" ".repeat(footerGap)}{footerText}
				</Text>,
				"footer",
			)}

			{/* Bottom padding row */}
			{emptyRow("pad-bottom")}
		</Box>
	);
});
