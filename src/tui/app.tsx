// ── TUI App — main shell wiring Session to components ───────────────

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";
import { MouseProvider, useOnWheel } from "@ink-tools/ink-mouse";
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
	spacerLine,
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
const GAP_ROWS = 2; // 1 gap after topbar + 1 gap before input
const BOTTOM_BAR_ROWS = 1;
const INPUT_SECTION_ROWS = 3; // top border + input + bottom border
const MIN_OUTPUT_ROWS = 4;
const SCROLL_WHEEL_LINES = 3; // lines per mouse wheel tick

// ── App props ───────────────────────────────────────────────────────

export interface AppProps {
	connection: HiseConnection | null;
	dataLoader?: DataLoader;
	scheme?: ColorScheme;
}

// ── App component ───────────────────────────────────────────────────

export function App(props: AppProps) {
	return (
		<MouseProvider autoEnable={true}>
			<AppInner {...props} />
		</MouseProvider>
	);
}

function AppInner({ connection, dataLoader, scheme: schemeProp }: AppProps) {
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
	const [disabled, setDisabled] = useState(false);
	const [scrollOffset, setScrollOffset] = useState(0);
	const outputRef = useRef<DOMElement>(null);

	// Track whether user has scrolled away from bottom
	const userScrolledRef = useRef(false);

	// Viewport height for output
	const outputHeight = Math.max(
		MIN_OUTPUT_ROWS,
		rows - TOP_BAR_ROWS - GAP_ROWS - BOTTOM_BAR_ROWS - INPUT_SECTION_ROWS,
	);

	// ── Scroll helpers ──────────────────────────────────────────────

	const maxScrollOffset = useCallback(
		(lineCount?: number) => {
			const total = lineCount ?? outputLines.length;
			return Math.max(0, total - outputHeight);
		},
		[outputLines.length, outputHeight],
	);

	const scrollBy = useCallback(
		(delta: number) => {
			setScrollOffset((prev) => {
				const max = maxScrollOffset();
				const next = Math.max(0, Math.min(max, prev + delta));
				userScrolledRef.current = next < max;
				return next;
			});
		},
		[maxScrollOffset],
	);

	const scrollToBottom = useCallback(() => {
		const max = maxScrollOffset();
		setScrollOffset(max);
		userScrolledRef.current = false;
	}, [maxScrollOffset]);

	const scrollToTop = useCallback(() => {
		setScrollOffset(0);
		userScrolledRef.current = outputLines.length > outputHeight;
	}, [outputLines.length, outputHeight]);

	// ── Keyboard scrolling ──────────────────────────────────────────

	useInput((_input, key) => {
		if (key.pageUp) {
			scrollBy(-outputHeight);
		} else if (key.pageDown) {
			scrollBy(outputHeight);
		} else if (key.home) {
			scrollToTop();
		} else if (key.end) {
			scrollToBottom();
		} else if (key.shift && key.upArrow) {
			scrollBy(-1);
		} else if (key.shift && key.downArrow) {
			scrollBy(1);
		}
	});

	// ── Mouse wheel scrolling ───────────────────────────────────────

	useOnWheel(outputRef, (event) => {
		if (event.button === "wheel-up") {
			scrollBy(-SCROLL_WHEEL_LINES);
		} else if (event.button === "wheel-down") {
			scrollBy(SCROLL_WHEEL_LINES);
		}
	});

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
		// Layout per message:
		//   ▎                            ← 1. accent spacer (darker bg)
		//   ▎ > input                    ← 2. echo (darker bg, accent border)
		//   ▎                            ← 3. accent spacer (darker bg)
		//                                ← 4. plain spacer (standard bg)
		//   result line(s)               ← 5. result (standard bg, no border)
		//                                ← 6. plain spacer (standard bg)
		const mode = session.currentMode();
		const accent = mode.accent;
		const darkerBg = scheme.backgrounds.darker;
		const plainSpacer = spacerLine(scheme);
		const darkAccentSpacer = spacerLine(scheme, accent, darkerBg);
		const echo = commandEchoLine(input, accent, scheme);
		addLines([darkAccentSpacer, echo, darkAccentSpacer, plainSpacer]);

		setDisabled(true);

		try {
			const result: CommandResult = await session.handleInput(input);

			if (result.type === "empty" && input.startsWith("/")) {
				// Slash commands that produce empty result (mode switches, clear)
				// Check if it was /clear
				if (input.trim() === "/clear") {
					setOutputLines([]);
					setScrollOffset(0);
					userScrolledRef.current = false;
				}
			} else if (result.type !== "empty") {
				const lines = resultToLines(result, scheme);
				//   result line(s)            ← result (standard bg, no border)
				//   [spacer]                  ← plain spacer after result
				addLines([...lines, plainSpacer]);
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

		// Auto-scroll to bottom if user hasn't manually scrolled up
		if (!userScrolledRef.current) {
			setOutputLines((current) => {
				const newOffset = Math.max(0, current.length - outputHeight);
				setScrollOffset(newOffset);
				return current;
			});
		}
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

	const scrollHint = totalLines > outputHeight ? "PgUp/PgDn scroll" : "";
	const modeHint = currentMode.id === "root"
		? `/help for commands  /script /builder /inspect to enter modes${scrollHint ? `  ${scrollHint}` : ""}`
		: `/exit to leave ${currentMode.name}  /help for commands${scrollHint ? `  ${scrollHint}` : ""}`;

	return (
		<Box flexDirection="column" height={rows}>
			<TopBar
				modeLabel={modeLabel}
				modeAccent={modeAccent}
				connectionStatus={connectionStatus}
				scheme={scheme}
				columns={columns}
			/>
			<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(columns)}</Text>
			<Box ref={outputRef} flexDirection="column" flexGrow={1}>
				<Output
					lines={outputLines}
					scrollOffset={scrollOffset}
					viewportHeight={outputHeight}
					scheme={scheme}
					columns={columns}
				/>
			</Box>
			<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(columns)}</Text>
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
