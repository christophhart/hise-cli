import { Box, Text } from "ink";
import { MONOKAI } from "../theme.js";

type ConnectionStatus = "connected" | "closed" | "error";

interface HeaderProps {
	pipeName: string;
	projectName: string | null;
	status: ConnectionStatus;
	width: number;
	scrollOffset: number;
	maxScrollOffset: number;
}

function statusColor(status: ConnectionStatus): string {
	if (status === "connected") {
		return MONOKAI.green;
	}

	if (status === "closed") {
		return MONOKAI.yellow;
	}

	return MONOKAI.red;
}

export function Header({
	pipeName,
	projectName,
	status,
	width,
	scrollOffset,
	maxScrollOffset,
}: HeaderProps) {
	const title = "HISE REPL";
	const project = projectName ?? "connecting...";
	const statusText = status;
	const scrollText =
		scrollOffset > 0
			? `history ${scrollOffset}/${maxScrollOffset}`
			: "live";
	const plain = `${title} | ${project} | ${pipeName} | ${statusText} | ${scrollText}`;
	const trailing = Math.max(0, width - plain.length);

	return (
		<Box width={width} backgroundColor={MONOKAI.backgroundDarker}>
			<Text bold color={MONOKAI.cyan} backgroundColor={MONOKAI.backgroundDarker}>
				HISE REPL
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				 |
			</Text>
			<Text
				color={projectName ? MONOKAI.foreground : MONOKAI.comment}
				backgroundColor={MONOKAI.backgroundDarker}
			>
				{projectName ?? "connecting..."}
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				 |
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				{pipeName}
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				 |
			</Text>
			<Text color={statusColor(status)} backgroundColor={MONOKAI.backgroundDarker}>
				{status}
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				 |
			</Text>
			<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
				{scrollText}
			</Text>
			<Text backgroundColor={MONOKAI.backgroundDarker}>{" ".repeat(trailing)}</Text>
		</Box>
	);
}
