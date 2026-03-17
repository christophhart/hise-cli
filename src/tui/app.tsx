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
	darkenOutputLines,
	MAX_HISTORY_LINES,
	type OutputLine,
} from "./components/Output.js";
import { Input, type InputHandle } from "./components/Input.js";
import { StatusBar } from "./components/StatusBar.js";
import { Overlay } from "./components/Overlay.js";
import { CompletionPopup } from "./components/CompletionPopup.js";
import { TreeSidebar, type TreeSidebarHandle, type TreeSidebarState } from "./components/TreeSidebar.js";
import { CompletionEngine } from "../engine/completion/engine.js";
import type { CompletionItem, CompletionResult } from "../engine/modes/mode.js";
import {
	defaultScheme,
	darkenHex,
	darkenBrand,
	darkenScheme,
	statusColor as defaultStatusColor,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";
import { ThemeProvider } from "./theme-context.js";

// ── Layout constants ────────────────────────────────────────────────

const TOP_BAR_ROWS = 1;
const GAP_ROWS = 2; // 1 gap after topbar + 1 gap before input
const BOTTOM_BAR_ROWS = 1;
const INPUT_SECTION_ROWS = 3; // top border + input + bottom border
const MIN_OUTPUT_ROWS = 4;
const SCROLL_WHEEL_LINES = 3; // lines per mouse wheel tick
const DIM_FACTOR = 0.65; // overlay backdrop brightness (0 = black, 1 = normal)

// ── Overlay backdrop snapshot ───────────────────────────────────────

interface OverlaySnapshot {
	outputLines: OutputLine[];
	scrollOffset: number;
	modeLabel: string;
	modeAccent: string;
	contextLabel: string;
	connectionStatus: ConnectionStatus;
	modeHint: string;
	scrollInfo: string;
	// Pre-computed dimmed values:
	dimScheme: ColorScheme;
	dimOutputLines: OutputLine[];
	dimModeAccent: string;
	dimStatusColor: (status: ConnectionStatus) => string;
}

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

	// Completion engine — created once, stored in ref
	const engineRef = useRef<CompletionEngine | null>(null);
	if (!engineRef.current) {
		engineRef.current = new CompletionEngine();
	}
	const completionEngine = engineRef.current;

	// Session — created once, stored in ref
	const sessionRef = useRef<Session | null>(null);
	if (!sessionRef.current) {
		const session = new Session(connection, completionEngine);
		// Register available modes with completion engine
		session.registerMode("script", (ctx) => new ScriptMode(ctx, completionEngine));
		session.registerMode("inspect", () => new InspectMode(completionEngine));
		session.registerMode("builder", (ctx) => new BuilderMode(undefined, completionEngine, ctx));
		sessionRef.current = session;
	}
	const session = sessionRef.current;

	// Input imperative handle
	const inputHandleRef = useRef<InputHandle>(null);

	// Tree sidebar
	const treeSidebarRef = useRef<TreeSidebarHandle>(null);
	const [sidebarVisible, setSidebarVisible] = useState(false);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	// Persistent sidebar state survives close/reopen
	const sidebarStateRef = useRef<TreeSidebarState | undefined>(undefined);
	const handleSidebarStateChange = useCallback((state: TreeSidebarState) => {
		sidebarStateRef.current = state;
	}, []);

	// State
	const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
		connection ? "connected" : "error",
	);
	const [disabled, setDisabled] = useState(false);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Refs tracking latest state values (for snapshot capture in async callbacks)
	const outputLinesRef = useRef(outputLines);
	outputLinesRef.current = outputLines;
	const scrollOffsetRef = useRef(scrollOffset);
	scrollOffsetRef.current = scrollOffset;
	const [overlayData, setOverlayData] = useState<{
		title: string;
		lines: string[];
		footer?: string;
	} | null>(null);
	const snapshotRef = useRef<OverlaySnapshot | null>(null);
	const [completionState, setCompletionState] = useState<{
		result: CompletionResult;
		selectedIndex: number;
		visible: boolean;
		ghostText?: string;
		forValue?: string;
	} | null>(null);
	const outputRef = useRef<DOMElement>(null);

	// Track whether user has scrolled away from bottom
	const userScrolledRef = useRef(false);

	// Sidebar width: responsive 20-35% of terminal, min 20, max 40
	const sidebarWidth = sidebarVisible
		? Math.max(20, Math.min(40, Math.floor(columns * 0.25)))
		: 0;
	// Content width available for output/input (minus sidebar)
	const contentColumns = columns - sidebarWidth;

	// Full height between TopBar and StatusBar — sidebar spans all of this
	const mainAreaHeight = Math.max(
		MIN_OUTPUT_ROWS + GAP_ROWS + INPUT_SECTION_ROWS,
		rows - TOP_BAR_ROWS - BOTTOM_BAR_ROWS,
	);

	// Viewport height for output (within the main area)
	const outputHeight = Math.max(
		MIN_OUTPUT_ROWS,
		mainAreaHeight - GAP_ROWS - INPUT_SECTION_ROWS,
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

	// ── Central key dispatcher — single useInput, priority chain ────
	//
	// Every keystroke goes through one handler chain. Each handler can
	// consume the event (return true) or pass it to the next handler
	// (return false). This guarantees exactly one action per keystroke.
	//
	// Priority: Overlay > Global hotkeys > CompletionPopup >
	//           TreeSidebar (focused) > Input > App (scroll)

	// Regex to detect mouse escape sequence remnants. Ink's useInput strips
	// the leading \x1b from unrecognized CSI sequences, so mouse events
	// arrive as input strings like "[<64;15;10M" or "[<0;15;10m".
	const MOUSE_SEQ_RE = /^\[?<\d+;\d+;\d+[Mm]$/;

	useInput((input, key) => {
		// ── Priority 1: Overlay (consumes everything when visible) ──
		if (overlayData) {
			if (key.escape || key.return) {
				handleOverlayClose();
			}
			return; // overlay eats all keys
		}

		if (disabled) return;

		// ── Priority 2: Global hotkeys ────────────────────────────
		// Ctrl+B — toggle tree sidebar
		if (key.ctrl && input === "b") {
			setSidebarVisible((prev) => {
				if (prev) {
					// Closing sidebar — return focus to input
					setSidebarFocused(false);
				} else {
					// Opening sidebar — grab focus immediately
					setSidebarFocused(true);
				}
				return !prev;
			});
			return;
		}

		// Tab — switch focus between sidebar and input (when sidebar visible)
		if (key.tab && sidebarVisible && !completionState?.visible) {
			setSidebarFocused((prev) => !prev);
			return;
		}

		// ── Priority 3: Completion popup (when visible) ────────────
		if (completionState?.visible) {
			if (key.return || key.tab) {
				const item = completionState.result.items[completionState.selectedIndex];
				if (item) {
					acceptCompletion(item, completionState.result);
				}
				return; // consumed
			}
			if (key.upArrow) {
				const next = completionState.selectedIndex > 0
					? completionState.selectedIndex - 1
					: completionState.result.items.length - 1;
				handleCompletionSelect(next);
				return; // consumed
			}
			if (key.downArrow) {
				const next = completionState.selectedIndex < completionState.result.items.length - 1
					? completionState.selectedIndex + 1
					: 0;
				handleCompletionSelect(next);
				return; // consumed
			}
			if (key.escape) {
				setCompletionState(null);
				return; // consumed
			}
			// All other keys fall through to tree/input
		}

		// ── Priority 4: Tree sidebar (when focused) ───────────────
		if (sidebarFocused && sidebarVisible) {
			const tree = treeSidebarRef.current;
			if (tree) {
				if (key.upArrow) {
					tree.cursorUp();
					return;
				}
				if (key.downArrow) {
					tree.cursorDown();
					return;
				}
				if (key.return || key.rightArrow) {
					tree.expandOrSelect();
					return;
				}
				if (key.leftArrow) {
					tree.collapseOrParent();
					return;
				}
				if (input === " " && !key.ctrl && !key.meta) {
					tree.toggle();
					return;
				}
				if (key.escape) {
					// Escape in tree → return focus to input
					setSidebarFocused(false);
					return;
				}
			}

			// Character input while tree focused → auto-switch to input
			if (input && !key.ctrl && !key.meta) {
				const code = input.charCodeAt(0);
				if (code >= 0x20 && code !== 0x7f && !MOUSE_SEQ_RE.test(input)) {
					setSidebarFocused(false);
					const handle = inputHandleRef.current;
					if (handle) handle.insertChar(input);
					return;
				}
			}
		}

		// ── Priority 5: Input ─────────────────────────────────────
		const handle = inputHandleRef.current;
		if (!handle) return;

		if (key.return) {
			setCompletionState(null);
			handle.submit();
			return;
		}

		if (key.escape) {
			// Popup not visible — toggle open with all completions
			handleEscape();
			return;
		}

		// Shift+arrows → output scrolling (handled below in Priority 6)
		if (key.shift && (key.upArrow || key.downArrow)) {
			// fall through to scroll handler
		}
		// Meta+Arrow → jump to start/end of line
		else if (key.meta && key.leftArrow) {
			handle.moveCursor("home");
			return;
		}
		else if (key.meta && key.rightArrow) {
			handle.moveCursor("end");
			return;
		}
		// Option+Left/Right — word boundary jump (macOS: ESC+b / ESC+f)
		else if (key.meta && input === "b") {
			handle.moveCursor("wordLeft");
			return;
		}
		else if (key.meta && input === "f") {
			handle.moveCursor("wordRight");
			return;
		}
		// Ctrl+A / Ctrl+E — start/end of line (readline style)
		else if (key.ctrl && input === "a") {
			handle.moveCursor("home");
			return;
		}
		else if (key.ctrl && input === "e") {
			handle.moveCursor("end");
			return;
		}
		// Home / End
		else if (key.home) {
			handle.moveCursor("home");
			return;
		}
		else if (key.end) {
			handle.moveCursor("end");
			return;
		}
		// Up/Down — history navigation (only when popup not visible)
		else if (key.upArrow) {
			handle.historyUp();
			return;
		}
		else if (key.downArrow) {
			handle.historyDown();
			return;
		}
		// Left/Right — cursor movement
		else if (key.leftArrow) {
			handle.moveCursor("left");
			return;
		}
		else if (key.rightArrow) {
			handle.moveCursor("right");
			return;
		}
		// Backspace / Delete
		else if (key.backspace || key.delete) {
			handle.deleteBackward();
			return;
		}
		// Tab — trigger/accept completion (when sidebar not visible)
		else if (key.tab) {
			handleTab();
			return;
		}
		// Regular character input
		else if (input && !key.ctrl && !key.meta) {
			const code = input.charCodeAt(0);
			if (code < 0x20 || code === 0x7f) return;
			if (MOUSE_SEQ_RE.test(input)) return;
			handle.insertChar(input);
			return;
		}

		// ── Priority 6: App-level scroll (fallback) ───────────────
		if (key.pageUp) {
			scrollBy(-outputHeight);
		} else if (key.pageDown) {
			scrollBy(outputHeight);
		} else if (key.shift && key.upArrow) {
			scrollBy(-1);
		} else if (key.shift && key.downArrow) {
			scrollBy(1);
		}
	});

	// ── Mouse wheel scrolling ───────────────────────────────────────

	useOnWheel(outputRef, (event) => {
		if (overlayData || completionState?.visible) return;
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

	// ── Load data for builder mode and completion engine ────────────

	useEffect(() => {
		if (!dataLoader) return;
		let cancelled = false;

		async function load() {
			if (!dataLoader || cancelled) return;
			try {
				// Load datasets for completion engine
				await completionEngine.init(dataLoader);

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
	}, [dataLoader, session, completionEngine]);

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
		const echoSpans = mode.tokenizeInput?.(input);
		const echo = commandEchoLine(input, accent, scheme, echoSpans);
		addLines([darkAccentSpacer, echo, darkAccentSpacer, plainSpacer]);

		setDisabled(true);

		try {
			const result: CommandResult = await session.handleInput(input);

			if (result.type === "overlay") {
				// Capture a snapshot of the current UI for the dimmed backdrop.
				// Read from refs to get latest state (closure may be stale).
				const snapLines = outputLinesRef.current;
				const snapScroll = scrollOffsetRef.current;
				const snapMode = session.currentMode();
				const snapModeLabel = snapMode.id === "root"
					? "root"
					: snapMode.prompt.replace(/[\[\]>]/g, "").trim();
				const snapModeAccent = snapMode.accent || scheme.foreground.default;
				const snapScrollHint = snapLines.length > outputHeight ? "PgUp/PgDn scroll" : "";
				const snapModeHint = snapMode.id === "root"
					? `/help for commands  /script /builder /inspect to enter modes${snapScrollHint ? `  ${snapScrollHint}` : ""}`
					: `/exit to leave ${snapMode.name}  /help for commands${snapScrollHint ? `  ${snapScrollHint}` : ""}`;
				const snapTotalLines = snapLines.length;
				const snapIsAtBottom = snapScroll >= snapTotalLines - outputHeight;
				const snapScrollInfo = snapTotalLines <= outputHeight
					? ""
					: snapIsAtBottom ? "live" : `\u2191 ${snapTotalLines - snapScroll - outputHeight} lines`;

				const dimScheme = darkenScheme(scheme, DIM_FACTOR);

				snapshotRef.current = {
					outputLines: [...snapLines],
					scrollOffset: snapScroll,
					modeLabel: snapModeLabel,
					modeAccent: snapModeAccent,
					contextLabel: snapMode.contextLabel ?? "",
					connectionStatus,
					modeHint: snapModeHint,
					scrollInfo: snapScrollInfo,
					dimScheme,
					dimOutputLines: darkenOutputLines(snapLines, DIM_FACTOR),
					dimModeAccent: darkenHex(snapModeAccent, DIM_FACTOR),
					dimStatusColor: (status: ConnectionStatus) =>
						darkenHex(defaultStatusColor(status), DIM_FACTOR),
				};

				// Show overlay
				setOverlayData({
					title: result.title,
					lines: result.lines,
					footer: result.footer,
				});
			} else if (result.type === "empty" && input.startsWith("/")) {
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
	const contextLabel = currentMode.contextLabel ?? "";

	// Syntax highlighting tokenizer from current mode (bound to avoid context loss)
	const modeTokenizer = currentMode.tokenizeInput
		? (v: string) => currentMode.tokenizeInput!(v)
		: undefined;

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

	const handleOverlayClose = useCallback(() => {
		setOverlayData(null);
		snapshotRef.current = null;
	}, []);

	// ── Completion handlers ────────────────────────────────────────

	// Compute ghost text from the current input value and completion result.
	// Extracted as a pure helper so it can be called from multiple places
	// (value change, selection change) with the same input value, avoiding
	// the stale-ref timing bug from queueMicrotask.
	const computeGhostText = useCallback(
		(value: string, result: CompletionResult, selectedIndex: number): string | undefined => {
			const item = result.items[selectedIndex];
			if (!item) return undefined;
			const insertText = item.insertText ?? item.label;
			const prefix = value.slice(result.from);
			if (insertText.toLowerCase().startsWith(prefix.toLowerCase())) {
				return insertText.slice(prefix.length);
			}
			return undefined;
		},
		[],
	);

	const handleInputValueChange = useCallback((value: string, cursorPos: number) => {
		if (overlayData) return; // Don't complete while overlay is visible

		if (value.length < 1) {
			setCompletionState(null);
			return;
		}

		// Only show completions when cursor is at end of input
		// (editing mid-string should not trigger the popup)
		if (cursorPos < value.length) {
			setCompletionState(null);
			return;
		}

		const result = session.complete(value, cursorPos);
		if (result.items.length > 0) {
			// Auto-close: if any item exactly matches the typed token,
			// dismiss the popup — Enter will submit normally. This handles
			// cases like "/exit" where fuzzy matching also returns "/quit".
			const token = value.slice(result.from);
			if (token.length > 0 && result.items.some((item) => {
				const itemText = item.insertText ?? item.label;
				return token === itemText;
			})) {
				setCompletionState(null);
				return;
			}

			const ghostText = computeGhostText(value, result, 0);
			setCompletionState({
				result,
				selectedIndex: 0,
				visible: true,
				ghostText,
				forValue: value,
			});
		} else {
			setCompletionState(null);
		}
	}, [session, overlayData, computeGhostText]);

	const handleTab = useCallback(() => {
		if (!completionState) {
			// No completion results — try to compute
			const value = inputHandleRef.current?.getValue() ?? "";
			if (value.length === 0) return;

			const result = session.complete(value, value.length);
			if (result.items.length > 0) {
				if (result.items.length === 1) {
					// Single match — accept immediately
					acceptCompletion(result.items[0], result);
				} else {
				const ghost = computeGhostText(value, result, 0);
				setCompletionState({
						result,
						selectedIndex: 0,
						visible: true,
						ghostText: ghost,
						forValue: value,
					});
				}
			}
			return;
		}

		// Popup visible — Tab accepts selected item
		const item = completionState.result.items[completionState.selectedIndex];
		if (item) {
			acceptCompletion(item, completionState.result);
		}
	}, [completionState, session, computeGhostText]);

	const acceptCompletion = useCallback((item: CompletionItem, result: CompletionResult) => {
		const handle = inputHandleRef.current;
		if (!handle) return;

		const currentValue = handle.getValue();
		const insertText = item.insertText ?? item.label;
		const newValue =
			currentValue.slice(0, result.from) + insertText;
		handle.setValue(newValue);
		setCompletionState(null);
	}, []);

	const handleCompletionSelect = useCallback((index: number) => {
		setCompletionState((prev) => {
			if (!prev) return null;
			const value = inputHandleRef.current?.getValue() ?? "";
			const ghost = computeGhostText(value, prev.result, index);
			return { ...prev, selectedIndex: index, ghostText: ghost, forValue: value };
		});
	}, [computeGhostText]);

	const handleCompletionAccept = useCallback((item: CompletionItem) => {
		if (completionState) {
			acceptCompletion(item, completionState.result);
		}
	}, [completionState, acceptCompletion]);

	const handleCompletionDismiss = useCallback(() => {
		setCompletionState(null);
	}, []);

	// Escape toggles the completion popup: close if visible, open if hidden.
	const handleEscape = useCallback(() => {
		if (completionState?.visible) {
			setCompletionState(null);
			return;
		}
		// Open: compute completions for current input
		const handle = inputHandleRef.current;
		if (!handle) return;
		const value = handle.getValue();
		const cursorPos = handle.getCursorPos();
		// In root mode with empty input, query slash commands
		const query = (value.length === 0 && session.currentModeId === "root") ? "/" : value;
		const qCursor = (value.length === 0 && session.currentModeId === "root") ? 1 : cursorPos;
		const result = session.complete(query, qCursor);
		if (result.items.length > 0) {
			const ghost = computeGhostText(value, result, 0);
			setCompletionState({
				result,
				selectedIndex: 0,
				visible: true,
				ghostText: ghost,
				forValue: value,
			});
		}
	}, [completionState, session, computeGhostText]);

	// Ghost text: read from completionState (computed at the same time as
	// the completion result, so it is always in sync with the typed value)
	const ghostText = completionState?.ghostText;

	// ── Tree sidebar data ──────────────────────────────────────────
	const modeTree = currentMode.getTree?.() ?? null;
	const modeSelectedPath = currentMode.getSelectedPath?.() ?? [];

	const handleTreeSelect = useCallback((path: string[]) => {
		if (currentMode.selectNode) {
			currentMode.selectNode(path);
			// Force re-render by toggling a state update
			setSidebarFocused((prev) => prev);
		}
	}, [currentMode]);

	return (
		<ThemeProvider scheme={scheme}>
			<Box flexDirection="column" height={rows}>
				<TopBar
					modeLabel={modeLabel}
					modeAccent={modeAccent}
					connectionStatus={connectionStatus}
					columns={columns}
				/>
				<Box flexDirection="row" height={mainAreaHeight}>
					{sidebarVisible && (
						<TreeSidebar
							tree={modeTree}
							selectedPath={modeSelectedPath}
							width={sidebarWidth}
							height={mainAreaHeight}
							focused={sidebarFocused}
							accent={modeAccent}
							scheme={scheme}
							onSelect={handleTreeSelect}
							sidebarRef={treeSidebarRef}
							persistedState={sidebarStateRef.current}
							onStateChange={handleSidebarStateChange}
							onFocus={() => setSidebarFocused(true)}
						/>
					)}
					<Box ref={outputRef} flexDirection="column" flexGrow={1}>
						<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>
						<Output
							lines={outputLines}
							scrollOffset={scrollOffset}
							viewportHeight={outputHeight}
							columns={contentColumns}
						/>
						<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>
						{completionState?.visible && (
							<CompletionPopup
								items={completionState.result.items}
								selectedIndex={completionState.selectedIndex}
								onSelect={handleCompletionSelect}
								onAccept={handleCompletionAccept}
								onDismiss={handleCompletionDismiss}
								leftOffset={completionState.result.from + (modeLabel === "root" ? 4 : modeLabel.length + 7)}
								scheme={scheme}
								label={completionState.result.label}
								rows={rows}
								columns={contentColumns}
							/>
						)}
						<Input
							modeLabel={modeLabel}
							modeAccent={modeAccent}
							contextLabel={contextLabel}
							columns={contentColumns}
							disabled={disabled || overlayData !== null}
							onSubmit={(v) => {
								setCompletionState(null);
								void handleSubmit(v);
							}}
							ghostText={ghostText}
							ghostForValue={completionState?.forValue}
							onValueChange={handleInputValueChange}
							inputRef={inputHandleRef}
							tokenize={modeTokenizer}
						/>
					</Box>
				</Box>
				<StatusBar
					connectionStatus={connectionStatus}
					modeHint={modeHint}
					scrollInfo={scrollInfo}
					columns={columns}
				/>
				{overlayData && snapshotRef.current && (() => {
					const snap = snapshotRef.current!;
					return (
						<>
							{/* Dimmed snapshot — wrapped in ThemeProvider with darkened colors */}
							<ThemeProvider
								scheme={snap.dimScheme}
								brand={darkenBrand(DIM_FACTOR)}
								statusColor={snap.dimStatusColor}
							>
								<Box
									position="absolute"
									marginLeft={0}
									marginTop={0}
									flexDirection="column"
									height={rows}
								>
									<TopBar
										modeLabel={snap.modeLabel}
										modeAccent={snap.dimModeAccent}
										connectionStatus={snap.connectionStatus}
										columns={columns}
									/>
									<Text backgroundColor={snap.dimScheme.backgrounds.standard}>
										{" ".repeat(columns)}
									</Text>
									<Box flexDirection="column" height={outputHeight}>
										<Output
											lines={snap.dimOutputLines}
											scrollOffset={snap.scrollOffset}
											viewportHeight={outputHeight}
											columns={columns}
										/>
									</Box>
									<Text backgroundColor={snap.dimScheme.backgrounds.standard}>
										{" ".repeat(columns)}
									</Text>
									<Input
										modeLabel={snap.modeLabel}
										modeAccent={snap.dimModeAccent}
										contextLabel={snap.contextLabel}
										columns={columns}
										disabled={true}
										onSubmit={() => {}}
									/>
									<StatusBar
										connectionStatus={snap.connectionStatus}
										modeHint={snap.modeHint}
										scrollInfo={snap.scrollInfo}
										columns={columns}
									/>
								</Box>
							</ThemeProvider>
							<Overlay
								title={overlayData.title}
								accent={modeAccent}
								lines={overlayData.lines}
								footer={overlayData.footer}
								onClose={handleOverlayClose}
								columns={columns}
								rows={rows}
								scheme={scheme}
							/>
						</>
					);
				})()}
			</Box>
		</ThemeProvider>
	);
}
