// ── StatusBar — context hints + scroll position ─────────────────────

import React from "react";
import { Box, Text } from "ink";
import type { ColorScheme, ConnectionStatus } from "../theme.js";
import { statusColor, statusDot } from "../theme.js";

export interface StatusBarProps {
	connectionStatus: ConnectionStatus;
	modeHint: string;
	scrollInfo: string;
	scheme: ColorScheme;
	columns: number;
}

export const StatusBar = React.memo(function StatusBar({
	connectionStatus,
	modeHint,
	scrollInfo,
	scheme,
	columns,
}: StatusBarProps) {
	const dot = statusDot(connectionStatus);
	const dotColor = statusColor(connectionStatus);
	const statusLabel = connectionStatus === "connected" ? "connected"
		: connectionStatus === "warning" ? "degraded"
		: "disconnected";

	const PAD = "  "; // 2 chars horizontal padding

	// Left: dot + status label
	const leftText = `${dot} ${statusLabel}`;
	const leftWidth = PAD.length + leftText.length;

	// Right side: scroll info
	const rightText = scrollInfo ? `${scrollInfo}  ` : PAD;
	const rightWidth = rightText.length;

	// Center: mode hints
	const centerAvail = Math.max(0, columns - leftWidth - rightWidth - 2); // 2 for gap
	let centerText = modeHint;
	if (centerText.length > centerAvail) {
		centerText = centerText.slice(0, centerAvail - 1) + "\u2026";
	}
	const centerPad = Math.max(0, centerAvail - centerText.length);

	return (
		<Box>
			<Text backgroundColor={scheme.backgrounds.darker}>
				<Text>{PAD}</Text>
				<Text color={dotColor}>{dot}</Text>
				<Text color={scheme.foreground.muted}> {statusLabel}</Text>
				<Text color={scheme.foreground.muted}>  {centerText}</Text>
				<Text>{" ".repeat(centerPad)}</Text>
				<Text color={scheme.foreground.muted}>{rightText}</Text>
			</Text>
		</Box>
	);
});
