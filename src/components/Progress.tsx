import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { MONOKAI } from "../theme.js";

interface ProgressProps {
	message: string;
	value: number | null;
	width: number;
}

const BAR_WIDTH = 20;

function renderProgressBar(value: number): string {
	const filled = Math.round(value * BAR_WIDTH);
	const empty = BAR_WIDTH - filled;
	const percentage = `${Math.round(value * 100)}`.padStart(3, " ");
	const bar = `${"#".repeat(filled)}${"-".repeat(empty)}`;

	return `[${bar}] ${percentage}%`;
}

export function Progress({ message, value, width }: ProgressProps) {
	const text = message || "Working...";

	if (typeof value === "number") {
		return (
			<Box width={width} paddingX={1} backgroundColor={MONOKAI.backgroundDarker}>
				<Text color={MONOKAI.green} backgroundColor={MONOKAI.backgroundDarker}>
					{renderProgressBar(value)}
				</Text>
				<Text> </Text>
				<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
					{text}
				</Text>
			</Box>
		);
	}

	return (
		<Box width={width} paddingX={1} backgroundColor={MONOKAI.backgroundDarker}>
			<Text color={MONOKAI.yellow} backgroundColor={MONOKAI.backgroundDarker}>
				<Spinner type="dots" /> {text}
			</Text>
		</Box>
	);
}
