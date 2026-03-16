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

	const leftContent = `${dot} ${statusLabel}`;
	const leftWidth = leftContent.length;

	// Right side: scroll info
	const rightContent = scrollInfo ? `  ${scrollInfo}` : "";
	const rightWidth = rightContent.length;

	// Center: mode hints
	const centerWidth = Math.max(0, columns - leftWidth - rightWidth - 4); // 4 for padding
	let centerText = modeHint;
	if (centerText.length > centerWidth) {
		centerText = centerText.slice(0, centerWidth - 1) + "\u2026";
	}
	const centerPad = Math.max(0, centerWidth - centerText.length);

	return (
		<Box>
			<Text backgroundColor={scheme.backgrounds.darker}>
				<Text> </Text>
				<Text color={dotColor}>{dot}</Text>
				<Text color={scheme.foreground.muted}> {statusLabel}</Text>
				<Text color={scheme.foreground.muted}>  {centerText}</Text>
				<Text>{" ".repeat(centerPad)}</Text>
				<Text color={scheme.foreground.muted}>{rightContent}</Text>
				<Text> </Text>
			</Text>
		</Box>
	);
});
