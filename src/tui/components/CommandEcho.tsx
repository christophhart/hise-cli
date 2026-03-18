// ── CommandEcho — input prompt display with accent border ───────────

// Renders the "> command" echo with left edge border, darker background,
// prefix coloring, and optional syntax-highlighted spans. Self-contained
// block: includes top/bottom padding rows with border, plus a bottom
// margin for spacing from the next block.

import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme-context.js";
import { darkenHex } from "../theme.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";

export interface CommandEchoProps {
	input: string;
	accent: string;
	spans?: TokenSpan[];
}

export const CommandEcho = React.memo(function CommandEcho({
	input,
	accent,
	spans,
}: CommandEchoProps) {
	const { scheme, dimFactor } = useTheme();
	const darkerBg = scheme.backgrounds.darker;
	const border = "\u258E "; // ▎ + space
	// When rendered inside the dimmed overlay backdrop, darken the accent
	// color to match the dimmed theme (accent is baked into props at
	// creation time and wouldn't be affected by the dimmed ThemeProvider).
	const a = dimFactor > 0 ? darkenHex(accent, dimFactor) : accent;

	const textContent = spans && spans.length > 0
		? spans.map((span, i) => {
			const c = span.color || TOKEN_COLORS[span.token];
			return <Text key={i} color={dimFactor > 0 ? darkenHex(c, dimFactor) : c}>{span.text}</Text>;
		})
		: <Text color={a}>{input}</Text>;

	return (
		<Box flexDirection="column" backgroundColor={darkerBg}>
			<Text><Text color={a}>{border}</Text></Text>
			<Text>
				<Text color={a}>{border}</Text>
				<Text color={a}>{"> "}</Text>
				{textContent}
			</Text>
			<Text><Text color={a}>{border}</Text></Text>
		</Box>
	);
});
