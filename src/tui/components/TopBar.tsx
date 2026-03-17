// ── TopBar — brand + mode + project + connection status ─────────────

import React from "react";
import { Box, Text } from "ink";
import { statusDot, type ConnectionStatus } from "../theme.js";
import { useTheme } from "../theme-context.js";

export interface TopBarProps {
	modeLabel: string;
	modeAccent: string;
	connectionStatus: ConnectionStatus;
	columns: number;
}

export const TopBar = React.memo(function TopBar({
	modeLabel,
	modeAccent,
	connectionStatus,
	columns,
}: TopBarProps) {
	const { scheme, brand, statusColor, layout } = useTheme();

	const dot = statusDot(connectionStatus);
	const dotColor = statusColor(connectionStatus);

	// Mode label: [builder], [script:Interface], etc.
	const modeDisplay = modeLabel === "root" ? "" : `[${modeLabel}]`;

	// Build the right side: status dot
	const rightContent = ` ${dot} `;
	const rightWidth = rightContent.length;

	// Build the left side content pieces
	const pad = " ".repeat(layout.horizontalPad);
	const brandText = "HISE CLI";
	const modeText = modeDisplay ? `  ${modeDisplay}` : "";
	const leftContentWidth = pad.length + brandText.length + modeText.length;

	// Padding to fill the row
	const padWidth = Math.max(0, columns - leftContentWidth - rightWidth);

	const bg = scheme.backgrounds.darker;
	const barPadRow = layout.barVerticalPad > 0
		? <Text backgroundColor={bg}>{" ".repeat(columns)}</Text>
		: null;

	return (
		<Box flexDirection="column">
			<Box>
				<Text backgroundColor={bg}>
					<Text>{pad}</Text>
					<Text color={brand.signal} bold>{brandText}</Text>
					{modeDisplay ? (
						<Text color={modeAccent} bold>{modeText}</Text>
					) : null}
					<Text>{" ".repeat(padWidth)}</Text>
					<Text color={dotColor}>{rightContent}</Text>
				</Text>
			</Box>
			{barPadRow}
		</Box>
	);
});
