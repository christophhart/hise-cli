// ── StatusBar — context hints + scroll position ─────────────────────

import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus } from "../theme.js";
import { statusDot } from "../theme.js";
import { useTheme } from "../theme-context.js";

export interface StatusBarProps {
	connectionStatus: ConnectionStatus;
	modeHint: string;
	scrollInfo: string;
	columns: number;
}

export const StatusBar = React.memo(function StatusBar({
	connectionStatus,
	modeHint,
	scrollInfo,
	columns,
}: StatusBarProps) {
	const { scheme, statusColor, layout } = useTheme();

	const dot = statusDot(connectionStatus);
	const dotColor = statusColor(connectionStatus);
	const statusLabel = connectionStatus === "connected" ? "connected"
		: connectionStatus === "warning" ? "degraded"
		: "disconnected";

	const pad = " ".repeat(layout.horizontalPad);

	// Left: dot + status label
	const leftText = `${dot} ${statusLabel}`;
	const leftWidth = pad.length + leftText.length;

	// Right side: scroll info
	const rightText = scrollInfo ? `${scrollInfo}${pad}` : pad;
	const rightWidth = rightText.length;

	// Center: mode hints
	const centerAvail = Math.max(0, columns - leftWidth - rightWidth - 2); // 2 for gap
	let centerText = modeHint;
	if (centerText.length > centerAvail) {
		centerText = centerText.slice(0, centerAvail - 1) + "\u2026";
	}
	const centerPad = Math.max(0, centerAvail - centerText.length);

	const bg = scheme.backgrounds.darker;
	const barPadRow = layout.barVerticalPad > 0
		? <Text backgroundColor={bg}>{" ".repeat(columns)}</Text>
		: null;

	return (
		<Box flexDirection="column">
			{barPadRow}
			<Box>
				<Text backgroundColor={bg}>
					<Text>{pad}</Text>
					<Text color={dotColor}>{dot}</Text>
					<Text color={scheme.foreground.muted}> {statusLabel}</Text>
					<Text color={scheme.foreground.muted}>  {centerText}</Text>
					<Text>{" ".repeat(centerPad)}</Text>
					<Text color={scheme.foreground.muted}>{rightText}</Text>
				</Text>
			</Box>
		</Box>
	);
});
