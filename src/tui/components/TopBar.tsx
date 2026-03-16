// ── TopBar — brand + mode + project + connection status ─────────────

import React from "react";
import { Box, Text } from "ink";
import { brand, statusColor, statusDot, type BrandColors, type ColorScheme, type ConnectionStatus } from "../theme.js";

export interface TopBarProps {
	modeLabel: string;
	modeAccent: string;
	connectionStatus: ConnectionStatus;
	scheme: ColorScheme;
	columns: number;
	/** Override brand colors (used for dimmed overlay backdrop) */
	brandOverride?: BrandColors;
	/** Override status dot color */
	statusColorOverride?: string;
}

export const TopBar = React.memo(function TopBar({
	modeLabel,
	modeAccent,
	connectionStatus,
	scheme,
	columns,
	brandOverride,
	statusColorOverride,
}: TopBarProps) {
	const dot = statusDot(connectionStatus);
	const dotColor = statusColorOverride ?? statusColor(connectionStatus);
	const brandSignal = brandOverride?.signal ?? brand.signal;

	// Mode label: [builder], [script:Interface], etc.
	const modeDisplay = modeLabel === "root" ? "" : `[${modeLabel}]`;

	// Build the right side: status dot
	const rightContent = ` ${dot} `;
	const rightWidth = rightContent.length;

	// Build the left side content pieces
	const PAD = "  "; // 2 chars horizontal padding
	const brandText = "HISE CLI";
	const modeText = modeDisplay ? `  ${modeDisplay}` : "";
	const leftContentWidth = PAD.length + brandText.length + modeText.length;

	// Padding to fill the row
	const padWidth = Math.max(0, columns - leftContentWidth - rightWidth);

	return (
		<Box>
			<Text backgroundColor={scheme.backgrounds.darker}>
				<Text>{PAD}</Text>
				<Text color={brandSignal} bold>{brandText}</Text>
				{modeDisplay ? (
					<Text color={modeAccent} bold>{modeText}</Text>
				) : null}
				<Text>{" ".repeat(padWidth)}</Text>
				<Text color={dotColor}>{rightContent}</Text>
			</Text>
		</Box>
	);
});
