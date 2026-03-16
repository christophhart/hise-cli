// ── TUI App — main shell wiring Session to components ───────────────

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, useApp, useStdout } from "ink";
import { Session } from "../engine/session.js";
import type { CommandResult } from "../engine/result.js";
import type { HiseConnection } from "../engine/hise.js";
import type { DataLoader } from "../engine/data.js";
import { ScriptMode } from "../engine/modes/script.js";
import { InspectMode } from "../engine/modes/inspect.js";
import { BuilderMode } from "../engine/modes/builder.js";
import { TopBar } from "./components/TopBar.js";
import {
	Output,
	resultToLines,
	commandEchoLine,
	MAX_HISTORY_LINES,
	type OutputLine,
} from "./components/Output.js";
import { Input } from "./components/Input.js";
import { StatusBar } from "./components/StatusBar.js";
import {
	defaultScheme,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";

// ── Layout constants ────────────────────────────────────────────────

const TOP_BAR_ROWS = 1;
const BOTTOM_BAR_ROWS = 1;
const INPUT_SECTION_ROWS = 3; // separator + input + bottom border
const MIN_OUTPUT_ROWS = 4;

// ── App props ───────────────────────────────────────────────────────

export interface AppProps {
	connection: HiseConnection | null;
	dataLoader?: DataLoader;
	scheme?: ColorScheme;
}

// ── App component ───────────────────────────────────────────────────

export function App({ connection, dataLoader, scheme: schemeProp }: AppProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();

	const scheme = schemeProp ?? defaultScheme;
	const columns = stdout?.columns ?? 80;
	const rows = stdout?.rows ?? 24;

	// Session — created once, stored in ref
	const sessionRef = useRef<Session | null>(null);
	if (!sessionRef.current) {
		const session = new Session(connection);
		// Register available modes
		session.registerMode("script", (ctx) => new ScriptMode(ctx));
		session.registerMode("inspect", () => new InspectMode());
		session.registerMode("builder", () => new BuilderMode());
		sessionRef.current = session;
	}
	const session = sessionRef.current;

	// State
	const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
		connection ? "connected" : "error",
	);
	const [projectName, setProjectName] = useState<string | null>(null);
	const [disabled, setDisabled] = useState(false);
	const scrollOffsetRef = useRef(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [, forceUpdate] = useState(0);

	// Viewport height for output
	const outputHeight = Math.max(
		MIN_OUTPUT_ROWS,
		rows - TOP_BAR_ROWS - BOTTOM_BAR_ROWS - INPUT_SECTION_ROWS,
	);

	// ── Connection probe ────────────────────────────────────────────

	useEffect(() => {
		if (!connection) return;

		let cancelled = false;

		async function probe() {
			if (!connection || cancelled) return;
			try {
				const alive = await connection.probe();
				if (!cancelled) {
					setConnectionStatus(alive ? "connected" : "error");
				}
			} catch {
				if (!cancelled) setConnectionStatus("error");
			}
		}

		void probe();
		const interval = setInterval(probe, 5000);

		return () => {
			cancelled = true;
			clearInterval(interval);
		};
	}, [connection]);

	// ── Load module data for builder mode ───────────────────────────

	useEffect(() => {
		if (!dataLoader) return;
		let cancelled = false;

		async function load() {
			if (!dataLoader || cancelled) return;
			try {
				const moduleList = await dataLoader.loadModuleList();
				if (!cancelled) {
					// Update builder mode instances with module data
					for (const mode of session.modeStack) {
						if (mode instanceof BuilderMode) {
							mode.setModuleList(moduleList);
						}
					}
				}
			} catch {
				// Module data not available — builder validation will be skipped
			}
		}

		void load();

		return () => { cancelled = true; };
	}, [dataLoader, session]);

	// ── Input handler ───────────────────────────────────────────────

	const addLines = useCallback((newLines: OutputLine[]) => {
		setOutputLines((prev) => {
			const combined = [...prev, ...newLines];
			if (combined.length > MAX_HISTORY_LINES) {
				combined.splice(0, combined.length - MAX_HISTORY_LINES);
			}
			return combined;
		});
	}, []);

	const handleSubmit = useCallback(async (input: string) => {
		// Add command echo
		const mode = session.currentMode();
		const echo = commandEchoLine(input, mode.accent, scheme);
		addLines([echo]);

		setDisabled(true);

		try {
			const result: CommandResult = await session.handleInput(input);

			if (result.type === "empty" && input.startsWith("/")) {
				// Slash commands that produce empty result (mode switches, clear)
				// Check if it was /clear
				if (input.trim() === "/clear") {
					setOutputLines([]);
					scrollOffsetRef.current = 0;
					setScrollOffset(0);
				}
			} else if (result.type !== "empty") {
				const resultMode = session.currentMode();
				const lines = resultToLines(result, resultMode.accent, scheme);
				addLines(lines);
			}

			// Check for quit
			if (session.shouldQuit) {
				exit();
				return;
			}
		} catch (err) {
			addLines([{
				text: String(err),
				color: scheme.foreground.muted,
			}]);
		} finally {
			setDisabled(false);
		}

		// Auto-scroll to bottom
		setOutputLines((current) => {
			const newOffset = Math.max(0, current.length - outputHeight);
			scrollOffsetRef.current = newOffset;
			setScrollOffset(newOffset);
			return current;
		});
	}, [session, scheme, addLines, outputHeight, exit]);

	// ── Mode label ──────────────────────────────────────────────────

	const currentMode = session.currentMode();
	const modeLabel = currentMode.id === "root"
		? "root"
		: currentMode.prompt.replace(/[\[\]>]/g, "").trim();
	const modeAccent = currentMode.accent || scheme.foreground.default;

	// ── Scroll info ─────────────────────────────────────────────────

	const totalLines = outputLines.length;
	const isAtBottom = scrollOffset >= totalLines - outputHeight;
	const scrollInfo = totalLines <= outputHeight
		? ""
		: isAtBottom
			? "live"
			: `\u2191 ${totalLines - scrollOffset - outputHeight} lines`;

	// ── Mode hints ──────────────────────────────────────────────────

	const modeHint = currentMode.id === "root"
		? "/help for commands  /script /builder /inspect to enter modes"
		: `/exit to leave ${currentMode.name}  /help for commands`;

	return (
		<Box flexDirection="column" height={rows}>
			<TopBar
				modeLabel={modeLabel}
				modeAccent={modeAccent}
				projectName={projectName}
				connectionStatus={connectionStatus}
				scheme={scheme}
				columns={columns}
			/>
			<Output
				lines={outputLines}
				scrollOffset={scrollOffset}
				viewportHeight={outputHeight}
				scheme={scheme}
				columns={columns}
			/>
			<Input
				modeLabel={modeLabel}
				modeAccent={modeAccent}
				scheme={scheme}
				columns={columns}
				disabled={disabled}
				onSubmit={(v) => void handleSubmit(v)}
			/>
			<StatusBar
				connectionStatus={connectionStatus}
				modeHint={modeHint}
				scrollInfo={scrollInfo}
				scheme={scheme}
				columns={columns}
			/>
		</Box>
	);
}
