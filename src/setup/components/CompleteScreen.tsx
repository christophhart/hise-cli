import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import type { PhaseResult, SetupConfig } from "../../setup-core/types.js";
import { MONOKAI } from "../../theme.js";

interface CompleteScreenProps {
	config: SetupConfig;
	results: PhaseResult[];
	logPath?: string;
	onExit: () => void;
}

export function CompleteScreen({ config, results, logPath, onExit }: CompleteScreenProps) {
	const { exit } = useApp();
	const allPassed = results.every(
		(r) => r.status === "done" || r.status === "skipped"
	);
	const failedPhase = results.find((r) => r.status === "failed");
	const totalTime = results.reduce((sum, r) => sum + r.durationMs, 0);

	const actions = allPassed
		? [
				{ label: "Exit", handler: () => { onExit(); exit(); } },
			]
		: [
				{ label: "Exit", handler: () => { onExit(); exit(); } },
			];

	const [cursor, setCursor] = useState(0);

	useInput((_input, key) => {
		if (key.upArrow) {
			setCursor((prev) => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setCursor((prev) => Math.min(actions.length - 1, prev + 1));
			return;
		}
		if (key.return) {
			actions[cursor].handler();
		}
	});

	if (allPassed) {
		return (
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				<Box marginBottom={1} flexDirection="column">
					<Text bold color={MONOKAI.green}>
						Setup Complete!
					</Text>
					<Text color={MONOKAI.comment}>
						Total time: {formatDuration(totalTime)}
					</Text>
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					<Text color={MONOKAI.foreground}>
						HISE installed to: <Text color={MONOKAI.cyan}>{config.installPath}</Text>
					</Text>
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					<Text bold color={MONOKAI.foreground}>
						Next steps:
					</Text>
					<Text color={MONOKAI.comment}>
						{"  "}1. Open a new terminal window
					</Text>
					<Text color={MONOKAI.comment}>
						{"  "}2. Run: <Text color={MONOKAI.cyan}>HISE --help</Text>
					</Text>
				</Box>

				{logPath && (
					<Box marginBottom={1}>
						<Text color={MONOKAI.comment}>
							Log file: <Text color={MONOKAI.cyan}>{logPath}</Text>
						</Text>
					</Box>
				)}

				<Box flexDirection="column" marginBottom={1}>
					<Text bold color={MONOKAI.foreground}>
						Resources:
					</Text>
					<Text color={MONOKAI.comment}>
						{"  "}- Docs: <Text color={MONOKAI.cyan}>https://docs.hise.dev</Text>
					</Text>
					<Text color={MONOKAI.comment}>
						{"  "}- Forum: <Text color={MONOKAI.cyan}>https://forum.hise.audio</Text>
					</Text>
				</Box>

				<Box flexDirection="column">
					{actions.map((action, index) => (
						<Box key={action.label}>
							<Text
								color={index === cursor ? MONOKAI.orange : MONOKAI.foreground}
								bold={index === cursor}
							>
								{index === cursor ? "> " : "  "}
								{action.label}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		);
	}

	// Failure screen
	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1} flexDirection="column">
				<Text bold color={MONOKAI.red}>
					Setup Failed
				</Text>
				{failedPhase && (
					<Text color={MONOKAI.red}>
						Failed at: {failedPhase.id}
					</Text>
				)}
			</Box>

			{failedPhase?.error && (
				<Box marginBottom={1}>
					<Text color={MONOKAI.yellow}>
						Error: {failedPhase.error}
					</Text>
				</Box>
			)}

			{failedPhase?.stderr && (
				<Box flexDirection="column" marginBottom={1}>
					<Text bold color={MONOKAI.foreground}>
						Last stderr output:
					</Text>
					{failedPhase.stderr
						.split("\n")
						.slice(-10)
						.map((line, i) => (
							<Text key={i} color={MONOKAI.comment} wrap="truncate">
								{line}
							</Text>
						))}
				</Box>
			)}

			{logPath && (
				<Box marginBottom={1}>
					<Text color={MONOKAI.comment}>
						Full log: <Text color={MONOKAI.cyan}>{logPath}</Text>
					</Text>
				</Box>
			)}

			<Box flexDirection="column" marginBottom={1}>
				<Text color={MONOKAI.comment}>
					You can retry by running: <Text color={MONOKAI.cyan}>hise-cli setup</Text>
				</Text>
			</Box>

			<Box flexDirection="column">
				{actions.map((action, index) => (
					<Box key={action.label}>
						<Text
							color={index === cursor ? MONOKAI.orange : MONOKAI.foreground}
							bold={index === cursor}
						>
							{index === cursor ? "> " : "  "}
							{action.label}
						</Text>
					</Box>
				))}
			</Box>
		</Box>
	);
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}
