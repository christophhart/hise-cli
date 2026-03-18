// ── ErrorBlock — error message with ✗ prefix ────────────────────────

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-context.js";
import { brand } from "../theme.js";

export interface ErrorBlockProps {
	message: string;
	detail?: string;
}

export const ErrorBlock = React.memo(function ErrorBlock({
	message,
	detail,
}: ErrorBlockProps) {
	const { scheme } = useTheme();

	return (
		<Box flexDirection="column">
			<Text>
				<Text color={brand.error}>{"\u2717 "}</Text>
				<Text color={brand.error}>{message}</Text>
			</Text>
			{detail && detail.split("\n").map((line, i) => (
				<Text key={i} color={scheme.foreground.muted}>{line}</Text>
			))}
		</Box>
	);
});
