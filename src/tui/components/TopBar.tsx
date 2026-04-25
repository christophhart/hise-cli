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
	/** Project name for display (e.g. "Demo Project"). */
	projectName?: string;
	/** Folder path for display (project folder or CWD). */
	projectPath?: string;
	/** Key press label to show in a badge (e.g. "Tab", "Ctrl+B"). */
	keyLabel?: string;
}

export const TopBar = React.memo(function TopBar({
	modeLabel,
	modeAccent,
	connectionStatus,
	columns,
	treeLabel,
	projectName,
	projectPath,
	keyLabel,
}: TopBarProps) {
	const { scheme, brand, statusColor, layout } = useTheme();

	const dot = statusDot(connectionStatus);
	const dotColor = statusColor(connectionStatus);

	const pad = " ".repeat(layout.horizontalPad);

	// ── Left side: tree label (accent colored, only when provided) ──
	const leftText = treeLabel ?? "";
	const leftWidth = leftText ? pad.length + leftText.length : 0;

	// ── Project info: "Name | Path" or just path ──
	const projectDisplay = projectName && projectPath
		? `${projectName} | ${projectPath}`
		: projectPath ?? "";
	const projectWidth = projectDisplay ? pad.length + projectDisplay.length : 0;

	// ── Right side: brand + [mode] + dot ──
	const brandText = "HISE CLI";
	const modeDisplay = modeLabel === "root" ? "" : ` [${modeLabel}]`;
	const rightContent = `${brandText}${modeDisplay} ${dot} `;
	const rightWidth = rightContent.length + pad.length;

	// Fill between left and right
	const fillWidth = Math.max(0, columns - leftWidth - projectWidth - rightWidth);

	const bg = scheme.backgrounds.darker;

	// ── Second row: centered key badge or empty padding ──
	let barPadRow: React.ReactNode = null;
	if (layout.barVerticalPad > 0) {
		if (keyLabel) {
			const badgeText = ` ${keyLabel} `;
			const badgeWidth = badgeText.length;
			const leftPad = Math.max(0, Math.floor((columns - badgeWidth) / 2));
			const rightPad = Math.max(0, columns - leftPad - badgeWidth);
			barPadRow = (
				<Text backgroundColor={bg}>
					{" ".repeat(leftPad)}
					<Text color={scheme.backgrounds.darker} backgroundColor={modeAccent} bold>{badgeText}</Text>
					{" ".repeat(rightPad)}
				</Text>
			);
		} else {
			barPadRow = <Text backgroundColor={bg}>{" ".repeat(columns)}</Text>;
		}
	}

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
					{projectDisplay ? (
						<>
							<Text>{pad}</Text>
							{projectName ? (
								<>
									<Text bold>{projectName}</Text>
									<Text color={scheme.foreground.muted}>{" | "}{projectPath}</Text>
								</>
							) : (
								<Text color={scheme.foreground.muted}>{projectPath}</Text>
							)}
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
