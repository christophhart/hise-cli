import { Box, Text, useApp, useInput, useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header.js";
import { Input } from "./components/Input.js";
import { Output } from "./components/Output.js";
import { Progress } from "./components/Progress.js";
import { useCommands } from "./hooks/useCommands.js";
import { usePipe } from "./hooks/usePipe.js";
import type { PipeConnection } from "./pipe.js";
import { MONOKAI } from "./theme.js";

interface AppProps {
	connection: PipeConnection;
	pipeName: string;
}

const INPUT_SECTION_ROWS = 3;
const STATUS_BAR_ROWS = 1;
const PROGRESS_ROWS = 1;
const DISCONNECTED_HINT_ROWS = 1;
const OUTPUT_INPUT_GAP_ROWS = 1;

export function App({ connection, pipeName }: AppProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();
	const {
		clearOutput,
		commandPending,
		connectionStatus,
		outputLines,
		progressMessage,
		progressValue,
		projectName,
		sendCommand,
		sendRaw,
	} = usePipe(connection);
	const { historyDown, historyUp, setValue, submit, value } =
		useCommands(sendCommand);
	const isExitingRef = useRef(false);
	const [scrollOffset, setScrollOffset] = useState(0);

	const handleExit = useCallback(() => {
		if (isExitingRef.current) {
			return;
		}

		isExitingRef.current = true;
		sendRaw(JSON.stringify({ cmd: "quit" }), {
			echo: false,
			trackPending: false,
			expectFinalResponse: false,
		});
		connection.destroy();
		exit();
	}, [connection, exit, sendRaw]);

	useEffect(() => {
		const onSignal = () => {
			handleExit();
		};

		process.on("SIGINT", onSignal);
		process.on("SIGHUP", onSignal);

		return () => {
			process.off("SIGINT", onSignal);
			process.off("SIGHUP", onSignal);
		};
	}, [handleExit]);

	const inputDisabled = commandPending || connectionStatus !== "connected";
	const columns = Math.max(1, stdout.columns || 80);
	const rows = Math.max(6, stdout.rows || 24);
	const reservedRows =
		OUTPUT_INPUT_GAP_ROWS +
		INPUT_SECTION_ROWS +
		STATUS_BAR_ROWS +
		(commandPending ? PROGRESS_ROWS : 0) +
		(connectionStatus !== "connected" ? DISCONNECTED_HINT_ROWS : 0);
	const outputRows = Math.max(1, rows - reservedRows);
	const maxScrollOffset = Math.max(0, outputLines.length - outputRows);

	useEffect(() => {
		setScrollOffset((previous) => Math.min(previous, maxScrollOffset));
	}, [maxScrollOffset]);

	useInput((
		input: string,
		key: { ctrl?: boolean; pageUp?: boolean; pageDown?: boolean }
	) => {
		if (key.ctrl && input.toLowerCase() === "c") {
			handleExit();
			return;
		}

		if (key.ctrl && input.toLowerCase() === "l") {
			clearOutput();
			setScrollOffset(0);
			return;
		}

		if (key.pageUp) {
			const step = Math.max(1, Math.floor(outputRows * 0.8));
			setScrollOffset((previous) => Math.min(maxScrollOffset, previous + step));
			return;
		}

		if (key.pageDown) {
			const step = Math.max(1, Math.floor(outputRows * 0.8));
			setScrollOffset((previous) => Math.max(0, previous - step));
		}
	});

	return (
		<Box
			flexDirection="column"
			height={rows}
			width={columns}
			backgroundColor={MONOKAI.background}
		>
			<Box
				flexDirection="column"
				height={outputRows}
				width={columns}
				backgroundColor={MONOKAI.background}
			>
				<Output
					lines={outputLines}
					width={columns}
					maxLines={outputRows}
					scrollOffset={scrollOffset}
					maxScrollOffset={maxScrollOffset}
				/>
			</Box>
			{commandPending && (
				<Progress message={progressMessage} value={progressValue} width={columns} />
			)}
			<Box width={columns} backgroundColor={MONOKAI.background}>
				<Text color={MONOKAI.background} backgroundColor={MONOKAI.background}>
					{" ".repeat(columns)}
				</Text>
			</Box>
			<Box width={columns} backgroundColor={MONOKAI.backgroundRaised}>
				<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundRaised}>
					{" ".repeat(columns)}
				</Text>
			</Box>
			<Box width={columns} flexDirection="column" backgroundColor={MONOKAI.backgroundRaised}>
				<Input
					width={columns}
					value={value}
					disabled={inputDisabled}
					onChange={setValue}
					onSubmit={submit}
					onHistoryUp={historyUp}
					onHistoryDown={historyDown}
				/>
				<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundRaised}>
					{" ".repeat(columns)}
				</Text>
			</Box>
			{connectionStatus !== "connected" && (
				<Box
					paddingX={1}
					backgroundColor={MONOKAI.backgroundDarker}
					width={columns}
				>
					<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundDarker}>
						Press Ctrl+C to exit.
					</Text>
				</Box>
			)}
			<Header
				pipeName={pipeName}
				projectName={projectName}
				status={connectionStatus}
				width={columns}
				scrollOffset={scrollOffset}
				maxScrollOffset={maxScrollOffset}
			/>
		</Box>
	);
}
