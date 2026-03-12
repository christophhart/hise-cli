import { Box, Text } from "ink";
import type { OutputLine } from "../pipe.js";
import { MONOKAI } from "../theme.js";

interface OutputProps {
	lines: OutputLine[];
	width: number;
	maxLines: number;
	scrollOffset: number;
	maxScrollOffset: number;
}

function colorForLine(type: OutputLine["type"]): string {
	switch (type) {
		case "command":
			return MONOKAI.yellow;
		case "result":
			return MONOKAI.cyan;
		case "error":
			return MONOKAI.red;
		default:
			return MONOKAI.comment;
	}
}

function fitToWidth(text: string, width: number): string {
	if (width <= 0) {
		return "";
	}

	if (text.length > width) {
		return text.slice(0, width);
	}

	return text.padEnd(width, " ");
}

function linePrefix(type: OutputLine["type"]): string {
	switch (type) {
		case "command":
			return "> ";
		default:
			return "";
	}
}

function lineBackground(type: OutputLine["type"]): string {
	if (type === "command") {
		return MONOKAI.backgroundDarker;
	}

	return MONOKAI.background;
}

export function Output({
	lines,
	width,
	maxLines,
	scrollOffset,
	maxScrollOffset,
}: OutputProps) {
	const safeWidth = Math.max(1, width);
	const safeMaxLines = Math.max(1, maxLines);
	const clampedOffset = Math.max(0, scrollOffset);
	const hasScrollbar = maxScrollOffset > 0;
	const horizontalPadding = 2;
	const contentWidth = Math.max(
		0,
		safeWidth - (hasScrollbar ? 1 : 0) - horizontalPadding * 2
	);
	const leftPad = " ".repeat(horizontalPadding);
	const rightPad = " ".repeat(horizontalPadding);
	const end = Math.max(0, lines.length - clampedOffset);
	const start = Math.max(0, end - safeMaxLines);
	const visibleLines = lines.slice(start, end);
	const emptyRows = Math.max(0, safeMaxLines - visibleLines.length);
	const thumbHeight = hasScrollbar
		? Math.max(1, Math.round((safeMaxLines * safeMaxLines) / Math.max(lines.length, 1)))
		: 0;
	const maxThumbTop = Math.max(0, safeMaxLines - thumbHeight);
	const thumbTop = hasScrollbar
		? Math.round(
				(1 - clampedOffset / Math.max(maxScrollOffset, 1)) * maxThumbTop
			)
		: 0;

	const scrollbarAtRow = (row: number): string => {
		if (!hasScrollbar) {
			return "";
		}

		if (row >= thumbTop && row < thumbTop + thumbHeight) {
			return "█";
		}

		return "|";
	};

	return (
		<Box flexDirection="column" backgroundColor={MONOKAI.background}>
			{Array.from({ length: emptyRows }).map((_, index) => (
				<Box key={`empty-${index}`} backgroundColor={MONOKAI.background}>
					<Text backgroundColor={MONOKAI.background}>{leftPad}</Text>
					<Text backgroundColor={MONOKAI.background}>{" ".repeat(contentWidth)}</Text>
					<Text backgroundColor={MONOKAI.background}>{rightPad}</Text>
					{hasScrollbar && (
						<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
							{scrollbarAtRow(index)}
						</Text>
					)}
				</Box>
			))}
			{visibleLines.map((line: OutputLine, index) => (
				<Box key={line.id} backgroundColor={lineBackground(line.type)}>
					<Text backgroundColor={lineBackground(line.type)}>{leftPad}</Text>
					<Text
						color={colorForLine(line.type)}
						backgroundColor={lineBackground(line.type)}
					>
						{fitToWidth(`${linePrefix(line.type)}${line.text}`, contentWidth)}
					</Text>
					<Text backgroundColor={lineBackground(line.type)}>{rightPad}</Text>
					{hasScrollbar && (
						<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
							{scrollbarAtRow(emptyRows + index)}
						</Text>
					)}
				</Box>
			))}
		</Box>
	);
}
