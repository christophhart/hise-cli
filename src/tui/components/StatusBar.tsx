// ── StatusBar — context hints + scroll position ─────────────────────

import React from "react";
import { Box, Text } from "ink";
import type { ConnectionStatus } from "../theme.js";
import { brand, statusDot } from "../theme.js";
import { useTheme } from "../theme-context.js";

export interface WizardProgressInfo {
	percent: number;
	message: string;
}

export interface StatusBarProps {
	connectionStatus: ConnectionStatus;
	modeHint: string;
	scrollInfo: string;
	columns: number;
	wizardProgress?: WizardProgressInfo | null;
}

export const StatusBar = React.memo(function StatusBar({
	connectionStatus,
	modeHint,
	scrollInfo,
	columns,
	wizardProgress,
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

	const bg = scheme.backgrounds.darker;

	// Center content: progress bar during wizard, hints otherwise
	const centerAvail = Math.max(0, columns - leftWidth - rightWidth - 2);
	let centerContent: React.ReactNode;

	if (wizardProgress) {
		const pct = Math.max(0, Math.min(100, wizardProgress.percent));
		const barWidth = Math.min(20, Math.max(8, Math.floor(centerAvail * 0.3)));
		const filled = Math.round((pct / 100) * barWidth);
		const empty = barWidth - filled;
		const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
		const pctStr = `${pct}%`;
		const label = wizardProgress.message || "";
		const cancelHint = "ESC ESC to cancel";

		// Fit: bar + pct + label + cancel hint
		const fixedWidth = barWidth + 1 + pctStr.length + 2 + cancelHint.length;
		const labelAvail = Math.max(0, centerAvail - fixedWidth - 2);
		const truncLabel = label.length > labelAvail ? label.slice(0, labelAvail - 1) + "\u2026" : label;

		centerContent = (
			<>
				<Text color={brand.signal}>{bar}</Text>
				<Text color={scheme.foreground.muted}> {pctStr}  </Text>
				<Text color={scheme.foreground.default}>{truncLabel}</Text>
				<Text>{" ".repeat(Math.max(0, centerAvail - fixedWidth - truncLabel.length))}</Text>
				<Text color={scheme.foreground.muted}>{cancelHint}</Text>
			</>
		);
	} else {
		let centerText = modeHint;
		if (centerText.length > centerAvail) {
			centerText = centerText.slice(0, centerAvail - 1) + "\u2026";
		}
		const centerPad = Math.max(0, centerAvail - centerText.length);
		centerContent = (
			<>
				<Text color={scheme.foreground.muted}>{centerText}</Text>
				<Text>{" ".repeat(centerPad)}</Text>
			</>
		);
	}

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
					<Text>  </Text>
					{centerContent}
					<Text color={scheme.foreground.muted}>{rightText}</Text>
				</Text>
			</Box>
		</Box>
	);
});
