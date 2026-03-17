// ── TopBar — tree label + brand + mode + connection status ──────────

import React from "react";
import { Box, Text } from "ink";
import { statusDot, type ConnectionStatus } from "../theme.js";
import { useTheme } from "../theme-context.js";

export interface TopBarProps {
	modeLabel: string;
	modeAccent: string;
	connectionStatus: ConnectionStatus;
	columns: number;
	/** Tree sidebar content label (e.g. "Module Tree"). Only shown when provided. */
	treeLabel?: string;
}

export const TopBar = React.memo(function TopBar({
	modeLabel,
	modeAccent,
	connectionStatus,
	columns,
	treeLabel,
}: TopBarProps) {
	const { scheme, brand, statusColor, layout } = useTheme();

	const dot = statusDot(connectionStatus);
	const dotColor = statusColor(connectionStatus);

	const pad = " ".repeat(layout.horizontalPad);

	// ── Left side: tree label (accent colored, only when provided) ──
	const leftText = treeLabel ?? "";
	const leftWidth = leftText ? pad.length + leftText.length : 0;

	// ── Right side: brand + [mode] + dot ──
	const brandText = "HISE CLI";
	const modeDisplay = modeLabel === "root" ? "" : ` [${modeLabel}]`;
	const rightContent = `${brandText}${modeDisplay} ${dot} `;
	const rightWidth = rightContent.length + pad.length;

	// Fill between left and right
	const fillWidth = Math.max(0, columns - leftWidth - rightWidth);

	const bg = scheme.backgrounds.darker;
	const barPadRow = layout.barVerticalPad > 0
		? <Text backgroundColor={bg}>{" ".repeat(columns)}</Text>
		: null;

	return (
		<Box flexDirection="column">
			<Box>
				<Text backgroundColor={bg}>
					{leftText ? (
						<>
							<Text>{pad}</Text>
							<Text color={modeAccent} bold>{leftText}</Text>
						</>
					) : null}
					<Text>{" ".repeat(fillWidth)}</Text>
					<Text>{pad}</Text>
					<Text color={brand.signal} bold>{brandText}</Text>
					{modeDisplay ? (
						<Text color={modeAccent} bold>{modeDisplay}</Text>
					) : null}
					<Text> </Text>
					<Text color={dotColor}>{dot}</Text>
					<Text> </Text>
				</Text>
			</Box>
			{barPadRow}
		</Box>
	);
});
