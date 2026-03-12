import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhaseResult, SetupConfig } from "../../setup-core/types.js";
import { MONOKAI } from "../../theme.js";
import type { PhaseContext, SetupPhase } from "../phases.js";
import { SETUP_PHASES } from "../phases.js";
import { SetupLogger, runPhase } from "../runner.js";

interface RunScreenProps {
	config: SetupConfig;
	context: PhaseContext;
	onComplete: (results: PhaseResult[], logPath: string) => void;
	onAbort: () => void;
}

type PhaseUiStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface PhaseUiState {
	id: string;
	name: string;
	status: PhaseUiStatus;
	durationMs?: number;
}

const MAX_LOG_LINES = 50;

export function RunScreen({ config, context, onComplete, onAbort }: RunScreenProps) {
	const [phases, setPhases] = useState<PhaseUiState[]>(() =>
		SETUP_PHASES.map((p) => ({
			id: p.id,
			name: p.name,
			status: p.shouldSkip?.(config, context) ? "skipped" : "pending",
		}))
	);
	const [logLines, setLogLines] = useState<string[]>([]);
	const [currentPhase, setCurrentPhase] = useState<string | null>(null);
	const resultsRef = useRef<PhaseResult[]>([]);
	const abortControllerRef = useRef<AbortController | null>(null);
	const loggerRef = useRef<SetupLogger | null>(null);
	const startedRef = useRef(false);

	const appendLog = useCallback((line: string) => {
		setLogLines((prev) => {
			const next = [...prev, line];
			if (next.length > MAX_LOG_LINES) {
				return next.slice(next.length - MAX_LOG_LINES);
			}
			return next;
		});
	}, []);

	const updatePhaseStatus = useCallback(
		(id: string, status: PhaseUiStatus, durationMs?: number) => {
			setPhases((prev) =>
				prev.map((p) =>
					p.id === id
						? { ...p, status, durationMs: durationMs ?? p.durationMs }
						: p
				)
			);
		},
		[]
	);

	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;

		const controller = new AbortController();
		abortControllerRef.current = controller;

		const runAll = async () => {
			const logger = new SetupLogger();
			loggerRef.current = logger;
			appendLog(`Log file: ${logger.filePath}`);

			logger.write(`Config: ${JSON.stringify(config, null, 2)}`);
			logger.write(`Context: ${JSON.stringify(context, null, 2)}`);
			logger.write("");

			// Log skipped phases
			for (const p of SETUP_PHASES) {
				if (p.shouldSkip?.(config, context)) {
					logger.phaseSkipped(p.id, p.name);
				}
			}

			const activePhaseDefs = SETUP_PHASES.filter(
				(p) => !p.shouldSkip?.(config, context)
			);

			for (const phaseDef of activePhaseDefs) {
				if (controller.signal.aborted) break;

				setCurrentPhase(phaseDef.id);
				updatePhaseStatus(phaseDef.id, "running");
				appendLog(`--- ${phaseDef.name} ---`);

				const script = phaseDef.generateScript(config, context);

				const result = await runPhase({
					id: phaseDef.id,
					name: phaseDef.name,
					shell: script.shell,
					script: script.script,
					cwd: script.cwd,
					env: script.env,
					onStdout: appendLog,
					onStderr: (line) => appendLog(`[stderr] ${line}`),
					signal: controller.signal,
					logger,
				});

				resultsRef.current.push(result);

				if (result.status === "failed") {
					updatePhaseStatus(phaseDef.id, "failed", result.durationMs);
					appendLog(`FAILED: ${result.error || "Unknown error"}`);

					setCurrentPhase(null);
					logger.finish(false);
					onComplete(resultsRef.current, logger.filePath);
					return;
				}

				updatePhaseStatus(phaseDef.id, "done", result.durationMs);
			}

			setCurrentPhase(null);
			logger.finish(true);
			onComplete(resultsRef.current, logger.filePath);
		};

		void runAll();

		return () => {
			controller.abort();
		};
	}, [appendLog, config, context, onComplete, updatePhaseStatus]);

	const visibleLog = logLines.slice(-20);

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color={MONOKAI.cyan}>
					Running Setup
				</Text>
			</Box>

			{/* Phase list */}
			<Box flexDirection="column" marginBottom={1}>
				{phases.map((phase) => (
					<Box key={phase.id}>
						<Text color={phaseStatusColor(phase.status)}>
							{phaseStatusIcon(phase.status)}
						</Text>
						<Text
							color={
								phase.status === "running"
									? MONOKAI.foreground
									: phase.status === "done"
										? MONOKAI.green
										: phase.status === "failed"
											? MONOKAI.red
											: MONOKAI.comment
							}
						>
							{" "}
							{phase.name}
						</Text>
						{phase.durationMs != null && phase.status !== "running" && (
							<Text color={MONOKAI.comment}>
								{" "}({formatDuration(phase.durationMs)})
							</Text>
						)}
					</Box>
				))}
			</Box>

			{/* Log output */}
			<Box
				flexDirection="column"
				borderStyle="single"
				borderColor={MONOKAI.comment}
				paddingX={1}
			>
				{visibleLog.length === 0 ? (
					<Text color={MONOKAI.comment}>Waiting for output...</Text>
				) : (
					visibleLog.map((line, i) => (
						<Text
							key={i}
							color={
								line.startsWith("[stderr]")
									? MONOKAI.yellow
									: line.startsWith("FAILED")
										? MONOKAI.red
										: line.startsWith("---")
											? MONOKAI.cyan
											: MONOKAI.comment
							}
							wrap="truncate"
						>
							{line}
						</Text>
					))
				)}
			</Box>
		</Box>
	);
}

// ── Helpers ─────────────────────────────────────────────────────────

function phaseStatusIcon(status: PhaseUiStatus): string {
	switch (status) {
		case "done":
			return "[+]";
		case "running":
			return "[~]";
		case "failed":
			return "[x]";
		case "skipped":
			return "[-]";
		default:
			return "[ ]";
	}
}

function phaseStatusColor(status: PhaseUiStatus): string {
	switch (status) {
		case "done":
			return MONOKAI.green;
		case "running":
			return MONOKAI.yellow;
		case "failed":
			return MONOKAI.red;
		case "skipped":
			return MONOKAI.comment;
		default:
			return MONOKAI.comment;
	}
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return `${minutes}m ${remainingSeconds}s`;
}
