import { useCallback, useEffect, useRef, useState } from "react";
import {
	PipeConnection,
	isFinalResponse,
	isProgressMessage,
	parseInput,
	responseToOutputLines,
	type OutputLine,
} from "../pipe.js";

const MAX_OUTPUT_LINES = 10_000;

export type ConnectionStatus = "connected" | "closed" | "error";

interface SendOptions {
	echo?: boolean;
	trackPending?: boolean;
	echoText?: string;
	suppressFinalOutput?: boolean;
	expectFinalResponse?: boolean;
}

interface PendingRequest {
	trackPending: boolean;
	suppressFinalOutput: boolean;
}

function clampProgress(progress: number): number {
	return Math.max(0, Math.min(1, progress));
}

export function usePipe(connection: PipeConnection) {
	const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
	const [commandPending, setCommandPending] = useState(false);
	const [progressMessage, setProgressMessage] = useState("");
	const [progressValue, setProgressValue] = useState<number | null>(null);
	const [projectName, setProjectName] = useState<string | null>(null);
	const [connectionStatus, setConnectionStatus] =
		useState<ConnectionStatus>("connected");

	const nextLineIdRef = useRef(1);
	const trackedPendingRef = useRef(0);
	const pendingRequestsRef = useRef<PendingRequest[]>([]);

	const nextLineId = useCallback(() => {
		const value = nextLineIdRef.current;
		nextLineIdRef.current += 1;
		return value;
	}, []);

	const appendLines = useCallback((lines: OutputLine[]) => {
		if (lines.length === 0) {
			return;
		}

		setOutputLines((previous: OutputLine[]) => {
			const merged = previous.concat(lines);
			if (merged.length <= MAX_OUTPUT_LINES) {
				return merged;
			}

			return merged.slice(merged.length - MAX_OUTPUT_LINES);
		});
	}, []);

	const appendLine = useCallback(
		(type: OutputLine["type"], text: string) => {
			appendLines([
				{
					id: nextLineId(),
					type,
					text,
					timestamp: Date.now(),
				},
			]);
		},
		[appendLines, nextLineId]
	);

	const clearOutput = useCallback(() => {
		setOutputLines([]);
	}, []);

	const sendRaw = useCallback(
		(json: string, options: SendOptions = {}) => {
			const {
				echo = false,
				trackPending = true,
				echoText = json,
				suppressFinalOutput = false,
				expectFinalResponse = true,
			} = options;

			if (echo) {
				appendLines([
					{
						id: nextLineId(),
						type: "info",
						text: "",
						timestamp: Date.now(),
					},
					{
						id: nextLineId(),
						type: "command",
						text: echoText,
						timestamp: Date.now(),
					},
					{
						id: nextLineId(),
						type: "info",
						text: "",
						timestamp: Date.now(),
					},
				]);
			}

			if (trackPending) {
				trackedPendingRef.current += 1;
				setCommandPending(true);
			}

			if (expectFinalResponse) {
				pendingRequestsRef.current.push({
					trackPending,
					suppressFinalOutput,
				});
			}

			try {
				connection.send(json);
			} catch (error) {
				appendLine("error", `Failed to send command: ${String(error)}`);
				trackedPendingRef.current = Math.max(0, trackedPendingRef.current - 1);
				setCommandPending(trackedPendingRef.current > 0);
				if (expectFinalResponse) {
					pendingRequestsRef.current.pop();
				}
			}
		},
		[appendLine, appendLines, connection, nextLineId]
	);

	const sendCommand = useCallback(
		(input: string): boolean => {
			const trimmed = input.trim();
			const parsed = parseInput(trimmed);

			if (parsed === null) {
				appendLine("error", "Invalid input. Use a command name or raw JSON.");
				return false;
			}

			sendRaw(parsed, {
				echo: true,
				echoText: trimmed,
				trackPending: true,
			});

			return true;
		},
		[appendLine, sendRaw]
	);

	useEffect(() => {
		const unlistenMessage = connection.onMessage(({ payload, raw }) => {
			if (!payload) {
				appendLine("info", raw);
				return;
			}

			if (isProgressMessage(payload)) {
				setProgressMessage(payload.message || "Working...");
				setProgressValue(
					typeof payload.progress === "number"
						? clampProgress(payload.progress)
						: null
				);
				return;
			}

			if (!isFinalResponse(payload)) {
				appendLine("info", raw);
				return;
			}

			const request = pendingRequestsRef.current.shift();

			if (request?.trackPending && trackedPendingRef.current > 0) {
				trackedPendingRef.current -= 1;
			}

			setCommandPending(trackedPendingRef.current > 0);
			setProgressMessage("");
			setProgressValue(null);

			if (payload.result && typeof payload.result.project === "string") {
				setProjectName(payload.result.project);
			}

			if (request?.suppressFinalOutput) {
				return;
			}

			appendLines(responseToOutputLines(payload, nextLineId));
		});

		const unlistenClose = connection.onClose(() => {
			setConnectionStatus("closed");
			setCommandPending(false);
			setProgressMessage("");
			setProgressValue(null);
			appendLine("info", "Connection closed by HISE.");
		});

		const unlistenError = connection.onError((error) => {
			setConnectionStatus("error");
			setCommandPending(false);
			setProgressMessage("");
			setProgressValue(null);
			appendLine("error", `Connection error: ${error.message}`);
		});

		sendRaw(JSON.stringify({ cmd: "status" }), {
			echo: false,
			trackPending: false,
			suppressFinalOutput: true,
		});

		return () => {
			unlistenMessage();
			unlistenClose();
			unlistenError();
		};
	}, [appendLine, appendLines, connection, nextLineId, sendRaw]);

	return {
		clearOutput,
		commandPending,
		connectionStatus,
		outputLines,
		progressMessage,
		progressValue,
		projectName,
		sendCommand,
		sendRaw,
	};
}
