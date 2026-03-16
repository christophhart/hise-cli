// ── Overlay — centered floating panel ───────────────────────────────

// Generic reusable overlay panel. Used by /help (Phase 3) and wizard
// (Phase 5). Renders centered over the REPL using absolute positioning.
// No borders — solid filled rectangle with overlay background, sized
// to OVERLAY_WIDTH and centered horizontally.
//
// Escape dismisses, Up/Down/PgUp/PgDn/mouse wheel scrolls body content.
// Captures all input while visible — parent must gate input.

import React, { useCallback, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { DOMElement } from "ink";
import { useOnWheel } from "@ink-tools/ink-mouse";
import type { ColorScheme } from "../theme.js";

// ── Types ───────────────────────────────────────────────────────────

export interface OverlayProps {
	/** Title shown in header row */
	title: string;
	/** Accent color (used for title text) */
	accent: string;
	/** Body content lines (pre-formatted text) */
	lines: string[];
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
}

// ── Constants ───────────────────────────────────────────────────────

const OVERLAY_WIDTH = 60;
const OVERLAY_HEIGHT = 20;
const H_PAD = 2; // horizontal inner padding (chars)
const SCROLL_WHEEL_LINES = 3;

// ── Component ───────────────────────────────────────────────────────

export const Overlay = React.memo(function Overlay({
	title,
	accent,
	lines,
	footer,
	onClose,
	columns,
	rows: viewportRows,
	scheme,
}: OverlayProps) {
	const [scrollOffset, setScrollOffset] = useState(0);
	const boxRef = useRef<DOMElement>(null);

	// Layout: pad-top(1) + header(1) + spacer(1) + body + spacer(1) + footer(1) + pad-bottom(1) = body + 6
	const bodyHeight = OVERLAY_HEIGHT - 6;
	const maxScroll = Math.max(0, lines.length - bodyHeight);
	// Usable content width inside horizontal padding
	const contentWidth = OVERLAY_WIDTH - H_PAD * 2;

	const scrollBy = useCallback(
		(delta: number) => {
			setScrollOffset((prev) =>
				Math.max(0, Math.min(maxScroll, prev + delta)),
			);
		},
		[maxScroll],
	);

	// Capture all keyboard input while overlay is visible
	useInput((_input, key) => {
		if (key.escape) {
			onClose();
		} else if (key.upArrow) {
			scrollBy(-1);
		} else if (key.downArrow) {
			scrollBy(1);
		} else if (key.pageUp) {
			scrollBy(-bodyHeight);
		} else if (key.pageDown) {
			scrollBy(bodyHeight);
		} else if (key.home) {
			setScrollOffset(0);
		} else if (key.end) {
			setScrollOffset(maxScroll);
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
	const topPad = viewportRows
		? Math.max(0, Math.floor((viewportRows - OVERLAY_HEIGHT) / 2))
		: 0;
	const leftMargin = Math.max(0, Math.floor((columns - OVERLAY_WIDTH) / 2));
	const pad = " ".repeat(H_PAD);

	// Header
	const escHint = "[Esc] Close";
	const titleSpace = contentWidth - escHint.length - 1;
	const truncTitle = title.length > titleSpace
		? title.slice(0, titleSpace - 1) + "\u2026"
		: title;
	const headerGap = Math.max(1, contentWidth - truncTitle.length - escHint.length);

	// Visible body
	const visibleLines = lines.slice(scrollOffset, scrollOffset + bodyHeight);
	while (visibleLines.length < bodyHeight) {
		visibleLines.push("");
	}

	// Scroll indicators
	const showUpArrow = scrollOffset > 0;
	const showDownArrow = scrollOffset < maxScroll;

	// Footer
	const footerText = footer ?? "";
	const footerGap = Math.max(1, contentWidth - footerText.length);

	// Helper: render a row that is exactly OVERLAY_WIDTH with bg, no left bleed
	const row = (content: React.ReactNode, key?: string | number) => (
		<Text key={key}>
			<Text backgroundColor={bg}>
				{pad}{content}{pad}
			</Text>
		</Text>
	);

	const emptyRow = (key: string) => row(
		<Text>{" ".repeat(contentWidth)}</Text>,
		key,
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
			{emptyRow("pad-top")}

			{/* Header row */}
			{row(
				<>
					<Text color={accent} bold>{truncTitle}</Text>
					<Text color={scheme.foreground.muted}>
						{" ".repeat(headerGap)}{escHint}
					</Text>
				</>,
				"header",
			)}

			{/* Spacer between header and body */}
			{emptyRow("spacer-top")}

			{/* Body lines */}
			{visibleLines.map((line, i) => {
				const truncLine = line.length > contentWidth - 2
					? line.slice(0, contentWidth - 3) + "\u2026"
					: line;

				let rightIndicator = " ";
				if (i === 0 && showUpArrow) rightIndicator = "\u25b2";
				else if (i === bodyHeight - 1 && showDownArrow) rightIndicator = "\u25bc";

				const innerPad = Math.max(0, contentWidth - truncLine.length - 1); // -1 for indicator

				return row(
					<>
						<Text color={scheme.foreground.default}>{truncLine}</Text>
						<Text color={scheme.foreground.muted}>
							{" ".repeat(innerPad)}{rightIndicator}
						</Text>
					</>,
					i,
				);
			})}

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
