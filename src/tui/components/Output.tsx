// ── Output — scrollable output with component-based result blocks ────

// Renders command results as React component blocks inside ink-scroll-view.
// Each result (text, error, code, table, markdown) is a self-contained
// component. Scrolling is handled by ControlledScrollView. A vertical
// scrollbar (via @byteland/ink-scroll-bar) is always rendered on the
// right edge; its thumb is hidden when content fits the viewport.

import React, { useEffect, useState } from "react";
import { Box } from "ink";
import { ControlledScrollView } from "ink-scroll-view";
import type { ControlledScrollViewRef } from "ink-scroll-view";
import { ScrollBar } from "@byteland/ink-scroll-bar";
import type { CommandResult } from "../../engine/result.js";
import type { ColorScheme } from "../theme.js";
import { useTheme } from "../theme-context.js";
import { LandingLogo } from "./LandingLogo.js";
import { Markdown } from "./Markdown.js";
import { ErrorBlock } from "./ErrorBlock.js";

// ── Constants ───────────────────────────────────────────────────────

export const MAX_HISTORY_BLOCKS = 500;
const SCROLLBAR_WIDTH = 1;

// ── Result → markdown conversion helpers ────────────────────────────

/** Convert a table (headers + rows) to a markdown table string. */
function tableToMarkdown(headers: string[], rows: string[][]): string {
	const headerRow = "| " + headers.join(" | ") + " |";
	const divider = "| " + headers.map(h => "-".repeat(Math.max(h.length, 3))).join(" | ") + " |";
	const dataRows = rows.map(row => "| " + row.join(" | ") + " |");
	return [headerRow, divider, ...dataRows].join("\n");
}

/** Wrap code content in a fenced code block. */
function codeToMarkdown(content: string, language?: string): string {
	const lang = language || "hisescript";
	return "```" + lang + "\n" + content + "\n```";
}

// ── ResultBlock — renders a single CommandResult ────────────────────

export interface ResultBlockProps {
	result: CommandResult;
}

export const ResultBlock = React.memo(function ResultBlock({ result }: ResultBlockProps) {
	const { scheme } = useTheme();

	switch (result.type) {
		case "empty":
			return null;
		case "text":
			return (
				<Markdown scheme={scheme} accent={result.accent} context="output">
					{result.content}
				</Markdown>
			);
		case "error":
			return <ErrorBlock message={result.message} detail={result.detail} />;
		case "code":
			return (
				<Markdown scheme={scheme} accent={result.accent} context="output">
					{codeToMarkdown(result.content, result.language)}
				</Markdown>
			);
		case "table":
			return (
				<Markdown scheme={scheme} accent={result.accent} context="output">
					{tableToMarkdown(result.headers, result.rows)}
				</Markdown>
			);
		case "markdown":
			return (
				<Markdown scheme={scheme} accent={result.accent} context="output">
					{result.content}
				</Markdown>
			);
		case "overlay":
			// Handled by App — never rendered in Output
			return null;
		default:
			return null;
	}
});

// ── Output component ────────────────────────────────────────────────

export interface OutputProps {
	/** Array of React nodes to render in the scrollable area */
	blocks: React.ReactNode[];
	/** Viewport height in terminal rows */
	viewportHeight: number;
	/** Total viewport width */
	columns: number;
	/** Show the landing logo when no blocks */
	animate?: boolean;
	/** Ref to expose scroll control to parent */
	scrollRef?: React.RefObject<ControlledScrollViewRef | null>;
	/** Controlled scroll offset (managed by parent) */
	scrollOffset: number;
	/** Hide the scrollbar (e.g. when completion popup overlays it) */
	hideScrollbar?: boolean;
}

export const Output = React.memo(function Output({
	blocks,
	viewportHeight,
	columns,
	animate,
	scrollRef,
	scrollOffset,
	hideScrollbar,
}: OutputProps) {
	const { scheme, layout } = useTheme();

	// Track content height for the scrollbar (read from ControlledScrollView
	// after each render so the scrollbar thumb size stays in sync).
	const [contentHeight, setContentHeight] = useState(viewportHeight);
	useEffect(() => {
		const h = scrollRef?.current?.getContentHeight() ?? viewportHeight;
		setContentHeight(h);
	});

	if (blocks.length === 0) {
		return (
			<LandingLogo
				viewportHeight={viewportHeight}
				columns={columns}
				scheme={scheme}
				animate={animate}
			/>
		);
	}

	const pad = layout.horizontalPad;
	const contentCols = columns - SCROLLBAR_WIDTH;

	return (
		<Box flexDirection="row" width={columns} height={viewportHeight} backgroundColor={scheme.backgrounds.standard}>
			<ControlledScrollView
				ref={scrollRef}
				width={contentCols}
				height={viewportHeight}
				scrollOffset={scrollOffset}
			>
				<Box
					flexDirection="column"
					paddingX={pad}
					width={contentCols}
					backgroundColor={scheme.backgrounds.standard}
				>
					{blocks.map((block, i) => (
						<Box key={i} flexDirection="column" marginBottom={1}>
							{block}
						</Box>
					))}
				</Box>
			</ControlledScrollView>
			{hideScrollbar ? (
				<Box width={SCROLLBAR_WIDTH} />
			) : (
				<ScrollBar
					placement="inset"
					thumbChar={"\u2588"}
					trackChar={"\u2502"}
					contentHeight={contentHeight}
					viewportHeight={viewportHeight}
					scrollOffset={scrollOffset}
					color={scheme.foreground.muted}
				/>
			)}
		</Box>
	);
});
