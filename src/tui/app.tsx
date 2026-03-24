// ── TUI App — main shell wiring Session to components ───────────────

import React, { useCallback, useEffect, useMemo, useRef, useState, Profiler } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";
import { MouseProvider, useOnWheel, useOnPress, useOnDrag, getBoundingClientRect } from "@ink-tools/ink-mouse";
import { PROFILING_ENABLED, onRenderCallback } from "./profiler.js";
import type { CommandResult } from "../engine/result.js";
import type { TreeNode } from "../engine/result.js";
import type { HiseConnection } from "../engine/hise.js";
import type { DataLoader } from "../engine/data.js";
import { BuilderMode } from "../engine/modes/builder.js";
import { TopBar } from "./components/TopBar.js";
import {
	Output,
	MAX_HISTORY_BLOCKS,
	flattenBlocks,
	totalLineCount,
} from "./components/Output.js";
import type { PrerenderedBlock } from "./components/prerender.js";
import { renderEcho, renderResult, truncateAnsi } from "./components/prerender.js";
import { dimAnsiLines } from "./components/dim-ansi.js";
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
import {
	computeLayout,
	topBarHeight,
	bottomBarHeight,
	sidebarWidth as calcSidebarWidth,
	GAP_ROWS,
	INPUT_SECTION_ROWS,
	type LayoutDensity,
} from "./layout.js";
import { createSession, loadSessionDatasets } from "../session-bootstrap.js";
import { startObserverServer, type ObserverEvent } from "./observer.js";
import { MODE_ACCENTS } from "../engine/modes/mode.js";

// ── Layout constants (non-scaling) ──────────────────────────────────

const SCROLL_WHEEL_LINES = 3; // lines per mouse wheel tick
const DIM_FACTOR = 0.65; // overlay backdrop brightness (0 = black, 1 = normal)
const ENTER_ACCEPTS_COMPLETION = false; // true = Enter accepts popup selection, false = Enter submits typed text

// ── Overlay backdrop snapshot ───────────────────────────────────────

interface OverlaySnapshot {
	/** Dimmed visible output lines (pre-rendered ANSI, dimmed, viewport-sized) */
	dimmedOutputText: string;
	modeLabel: string;
	modeAccent: string;
	contextLabel: string;
	connectionStatus: ConnectionStatus;
	modeHint: string;
	scrollInfo: string;
	sidebarVisible: boolean;
	sidebarW: number;
	treeLabel?: string;
	// Pre-computed dimmed values:
	dimScheme: ColorScheme;
	dimModeAccent: string;
	dimStatusColor: (status: ConnectionStatus) => string;
}

// ── App props ───────────────────────────────────────────────────────

export interface AppProps {
	connection: HiseConnection | null;
	dataLoader?: DataLoader;
	builderTree?: TreeNode | null;
	scheme?: ColorScheme;
	width?: number;  // override stdout.columns (for screencast runner)
	height?: number; // override stdout.rows (for screencast runner)
	animate?: boolean; // disable logo animation (--no-animation)
}

// ── App component ───────────────────────────────────────────────────

export function App(props: AppProps) {
	return (
		<MouseProvider autoEnable={true}>
			<AppInner {...props} />
		</MouseProvider>
	);
}

function AppInner({ connection, dataLoader, builderTree, scheme: schemeProp, width, height, animate }: AppProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();

	const scheme = schemeProp ?? defaultScheme;
	const columns = width ?? stdout?.columns ?? 80;
	const rows = height ?? stdout?.rows ?? 24;

	// Layout density — auto-detected from terminal size, overridable via /density
	const [densityOverride, setDensityOverride] = useState<LayoutDensity | undefined>(undefined);
	const layout = computeLayout(columns, rows, densityOverride);

	// Completion engine — created once, stored in ref
	const engineRef = useRef<CompletionEngine | null>(null);
	if (!engineRef.current) {
		engineRef.current = new CompletionEngine();
	}
	const completionEngine = engineRef.current;

	// Loaded module list — stored in ref so the builder factory always
	// gets the latest data (even for modes created after initial load).
	const moduleListRef = useRef<import("../engine/data.js").ModuleList | undefined>(undefined);

	// Session — created once, stored in ref
	const sessionRef = useRef<ReturnType<typeof createSession>["session"] | null>(null);
	if (!sessionRef.current) {
		sessionRef.current = createSession({
			connection,
			completionEngine,
			getModuleList: () => moduleListRef.current,
			getBuilderTree: () => builderTree,
		}).session;
	}
	const session = sessionRef.current;

	// Input imperative handle + mouse support
	const inputHandleRef = useRef<InputHandle>(null);
	const inputBoxRef = useRef<DOMElement>(null);
	const DOUBLE_CLICK_MS = 300;
	const lastInputClickRef = useRef<{ x: number; time: number } | null>(null);

	/** Convert absolute terminal x to character offset in the input value.
	 *  Uses getBoundingClientRect at call time for fresh position (survives sidebar toggle). */
	const inputXToCharOffset = useCallback((absX: number) => {
		const handle = inputHandleRef.current;
		if (!handle) return 0;
		const rect = getBoundingClientRect(inputBoxRef.current);
		const boxLeft = rect?.left ?? 0;
		const { padLen, promptWidth, scrollStart } = handle.getLayoutMetrics();
		const relX = absX - boxLeft - padLen - promptWidth;
		const len = handle.getValue().length;
		return Math.max(0, Math.min(len, relX + scrollStart));
	}, []);

	useOnPress(inputBoxRef, useCallback((event: { x: number }) => {
		const handle = inputHandleRef.current;
		if (!handle) return;
		const charPos = inputXToCharOffset(event.x);
		const now = Date.now();
		const last = lastInputClickRef.current;

		if (last && Math.abs(last.x - event.x) <= 1 && now - last.time < DOUBLE_CLICK_MS) {
			lastInputClickRef.current = null;
			handle.selectAll();
		} else {
			lastInputClickRef.current = { x: event.x, time: now };
			handle.setCursorAt(charPos);
		}
	}, [inputXToCharOffset]));

	useOnDrag(inputBoxRef, useCallback((event: { x: number }) => {
		const handle = inputHandleRef.current;
		if (!handle) return;
		const charPos = inputXToCharOffset(event.x);
		handle.setCursorAt(charPos, true);
	}, [inputXToCharOffset]));

	// Tree sidebar
	const treeSidebarRef = useRef<TreeSidebarHandle>(null);
	const [sidebarVisible, setSidebarVisible] = useState(false);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	// Persistent sidebar state survives close/reopen
	const sidebarStateRef = useRef<TreeSidebarState | undefined>(undefined);
	const handleSidebarStateChange = useCallback((state: TreeSidebarState) => {
		sidebarStateRef.current = state;
	}, []);

	// Tree sidebar search
	const [searchFocused, setSearchFocused] = useState(false);
	const [searchText, setSearchText] = useState("");

	// State
	const [outputBlocks, setOutputBlocks] = useState<PrerenderedBlock[]>([]);
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
		connection ? "connected" : "error",
	);
	const [disabled, setDisabled] = useState(false);
	// Synchronous disabled check — avoids the React render-cycle gap
	// where keystrokes can arrive between setDisabled(true) and the
	// next render, causing them to be dropped by the useInput handler.
	const disabledRef = useRef(false);
	const [scrollOffset, setScrollOffset] = useState(0);

	// Refs tracking latest state values (for snapshot capture in async callbacks)
	const outputBlocksRef = useRef(outputBlocks);
	outputBlocksRef.current = outputBlocks;
	const scrollOffsetRef = useRef(scrollOffset);
	scrollOffsetRef.current = scrollOffset;
	const sidebarVisibleRef = useRef(sidebarVisible);
	sidebarVisibleRef.current = sidebarVisible;
	const [overlayData, setOverlayData] = useState<{
		title: string;
		content?: string;  // markdown content
		lines?: string[];  // legacy plain text lines
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

	// Derived line buffer (recomputed only when blocks change, not on scroll)
	const allLines = useMemo(() => flattenBlocks(outputBlocks), [outputBlocks]);
	const totalLines = useMemo(() => totalLineCount(outputBlocks), [outputBlocks]);

	// Sidebar width: responsive, driven by layout scale
	const sidebarW = sidebarVisible ? calcSidebarWidth(layout, columns) : 0;
	// Content width available for output/input (minus sidebar)
	const contentColumns = columns - sidebarW;

	// Chrome heights derived from layout scale
	const topH = topBarHeight(layout);
	const botH = bottomBarHeight(layout);

	// Full height between TopBar and StatusBar — sidebar spans all of this
	const mainAreaHeight = Math.max(
		layout.minOutputRows + GAP_ROWS + INPUT_SECTION_ROWS,
		rows - topH - botH,
	);

	// Viewport height for output (within the main area)
	const outputHeight = Math.max(
		layout.minOutputRows,
		mainAreaHeight - GAP_ROWS - INPUT_SECTION_ROWS,
	);

	// ── Scroll helpers ──────────────────────────────────────────────

	// Max scroll offset = total lines minus viewport height (clamped to 0)
	const totalLinesRef = useRef(totalLines);
	totalLinesRef.current = totalLines;

	const maxScrollOffset = useCallback(
		() => Math.max(0, totalLinesRef.current - outputHeight),
		[outputHeight],
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
		userScrolledRef.current = outputBlocks.length > 0;
	}, [outputBlocks.length]);

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

		if (disabledRef.current) return;

		// ── Priority 2: Global hotkeys ────────────────────────────
		// Ctrl+B — toggle tree sidebar
		if (key.ctrl && input === "b") {
			setSidebarVisible((prev) => {
				if (prev) {
					// Closing sidebar — return focus to input
					setSidebarFocused(false);
					setSearchFocused(false);
				} else {
					// Opening sidebar — grab focus immediately
					setSidebarFocused(true);
				}
				return !prev;
			});
			return;
		}

		// Ctrl+F or Ctrl+S — focus tree sidebar search bar
		// (Ctrl+F may be intercepted by some terminals like iTerm2/VS Code;
		//  Ctrl+S is the fallback for those environments)
		if (key.ctrl && (input === "f" || input === "k")) {
			if (!sidebarVisible) {
				setSidebarVisible(true);
			}
			setSearchFocused(true);
			setSidebarFocused(false);
			return;
		}

		// Tab — switch focus between sidebar/search and input (when sidebar visible)
		if (key.tab && sidebarVisible && !completionState?.visible) {
			if (searchFocused) {
				// Search → input (keep filter active)
				setSearchFocused(false);
				setSidebarFocused(false);
			} else if (sidebarFocused) {
				// Tree → input
				setSidebarFocused(false);
			} else {
				// Input → tree (or search if there's an active search)
				setSidebarFocused(true);
			}
			return;
		}

		// ── Priority 3: Completion popup (when visible) ────────────
		if (completionState?.visible) {
			if (key.return && !ENTER_ACCEPTS_COMPLETION) {
				setCompletionState(null);
				// Fall through to Priority 5 (submit typed text as-is)
			} else if (key.tab || (key.return && ENTER_ACCEPTS_COMPLETION)) {
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

		// ── Priority 4: Search bar (when focused) ────────────────
		if (searchFocused && sidebarVisible) {
			if (key.return) {
				// Jump to first match, unfocus search, focus tree
				treeSidebarRef.current?.jumpToFirstMatch();
				setSearchFocused(false);
				setSidebarFocused(true);
				return;
			}
			if (key.escape) {
				// Clear search text, remove filter, unfocus, focus tree
				setSearchText("");
				setSearchFocused(false);
				setSidebarFocused(true);
				return;
			}
			if (key.backspace || key.delete) {
				setSearchText((prev) => prev.slice(0, -1));
				return;
			}
			// Down arrow — jump to first match (mirrors Enter)
			if (key.downArrow) {
				treeSidebarRef.current?.jumpToFirstMatch();
				setSearchFocused(false);
				setSidebarFocused(true);
				return;
			}
			// Up arrow passes through to tree navigation (Priority 5)
			if (key.upArrow) {
				// Fall through to tree handling below
			} else if (input && !key.ctrl && !key.meta) {
				const code = input.charCodeAt(0);
				if (code >= 0x20 && code !== 0x7f && !MOUSE_SEQ_RE.test(input)) {
					setSearchText((prev) => prev + input);
					return;
				}
			}
		}

		// ── Priority 5: Tree sidebar (when focused) ───────────────
		// Up/Down navigation also applies when search is focused (pass-through from Priority 4)
		if ((sidebarFocused || searchFocused) && sidebarVisible) {
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
			}
		}
		if (sidebarFocused && sidebarVisible) {
			const tree = treeSidebarRef.current;
			if (tree) {
				if (key.return) {
					tree.selectAsRoot();
					return;
				}
				if (key.rightArrow) {
					tree.expand();
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
					if (searchText !== "") {
						// First Escape: clear search filter, stay in tree
						setSearchText("");
					} else {
						// Second Escape (or no filter): return focus to input
						setSidebarFocused(false);
					}
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
		// Meta+Arrow → jump to start/end of line (Shift extends selection)
		else if (key.meta && key.leftArrow) {
			handle.moveCursor("home", key.shift);
			return;
		}
		else if (key.meta && key.rightArrow) {
			handle.moveCursor("end", key.shift);
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
		// Ctrl+A — start of line (readline style)
		else if (key.ctrl && input === "a") {
			handle.moveCursor("home");
			return;
		}
		// Ctrl+C — copy selection to clipboard via OSC 52
		else if (key.ctrl && input === "c") {
			const sel = handle.getSelection();
			if (sel) {
				process.stdout.write(`\x1b]52;c;${Buffer.from(sel.text).toString("base64")}\x07`);
			}
			return;
		}
		else if (key.ctrl && input === "e") {
			handle.moveCursor("end");
			return;
		}
		// Home / End (Shift extends selection)
		else if (key.home) {
			handle.moveCursor("home", key.shift);
			return;
		}
		else if (key.end) {
			handle.moveCursor("end", key.shift);
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
		// Left/Right — cursor movement (Shift extends selection)
		else if (key.leftArrow) {
			handle.moveCursor("left", key.shift);
			return;
		}
		else if (key.rightArrow) {
			handle.moveCursor("right", key.shift);
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
				const moduleList = await loadSessionDatasets(dataLoader, completionEngine);
				if (!cancelled) {
					if (!moduleList) return;
					// Store for future builder mode instances
					moduleListRef.current = moduleList;
					// Update existing builder mode instances with module data
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

	const addBlocks = useCallback((newBlocks: PrerenderedBlock[]) => {
		setOutputBlocks((prev) => {
			const combined = [...prev, ...newBlocks];
			if (combined.length > MAX_HISTORY_BLOCKS) {
				combined.splice(0, combined.length - MAX_HISTORY_BLOCKS);
			}
			return combined;
		});
	}, []);

	const renderContextRef = useRef({
		scheme,
		columns: contentColumns,
		layout,
	});
	renderContextRef.current = { scheme, columns: contentColumns, layout };

	const handleObserverEvent = useCallback((event: ObserverEvent) => {
		const { scheme: currentScheme, columns: currentContentColumns, layout: currentLayout } = renderContextRef.current;
		const innerW = currentContentColumns - 1 - 2 * currentLayout.horizontalPad;

		if (event.type === "command.start") {
			const accent = MODE_ACCENTS[event.mode as keyof typeof MODE_ACCENTS] || currentScheme.foreground.default;
			addBlocks([
				renderEcho(event.command, accent, currentScheme.backgrounds.darker, innerW, undefined, {
					prefix: "[LLM] ",
					prefixColor: currentScheme.foreground.muted,
				}),
			]);
			return;
		}

		if (event.type === "command.progress") {
			const parts = [event.phase, event.percent !== undefined ? `${event.percent}%` : undefined, event.message]
				.filter(Boolean)
				.join(" ");
			if (parts) {
				const block = renderResult({ type: "text", content: parts }, currentScheme, innerW);
				if (block) addBlocks([block]);
			}
			return;
		}

		const block = renderResult(event.result, currentScheme, innerW);
		if (block) addBlocks([block]);
	}, [addBlocks]);

	useEffect(() => {
		const server = startObserverServer(handleObserverEvent);
		return () => {
			server.close();
		};
	}, [handleObserverEvent]);

	const handleSubmit = useCallback(async (input: string) => {
		const mode = session.currentMode();
		const currentAccent = mode.accent;
		const echoSpans = mode.tokenizeInput?.(input);
		// Inner content width for echo padding (Output subtracts scrollbar + paddingX)
		const innerW = contentColumns - 1 - 2 * layout.horizontalPad;

		disabledRef.current = true;
		setDisabled(true);

		try {
			const result: CommandResult = await session.handleInput(input);
			
			// Use result.accent if provided (one-shot/mode-switch), otherwise current mode.
			// Root mode has accent="" so use || to skip empty strings → scheme default.
			const accent = result.accent || currentAccent || scheme.foreground.default;

			// Pre-render the command echo
			const echoBlock = renderEcho(input, accent, scheme.backgrounds.darker, innerW, echoSpans);
			addBlocks([echoBlock]);

			if (result.type === "overlay") {
				// Capture a snapshot of the current UI for the dimmed backdrop.
				// Pre-render the visible output slice with dimmed colors.
				const snapScroll = scrollOffsetRef.current;
				const snapLines = flattenBlocks(outputBlocksRef.current);
				const visibleSlice = snapLines.slice(snapScroll, snapScroll + outputHeight);
				while (visibleSlice.length < outputHeight) visibleSlice.push("");
				const dimmedLines = dimAnsiLines(visibleSlice, DIM_FACTOR);
				const dimmedOutputText = dimmedLines.join("\n");

				const snapMode = session.currentMode();
				const snapModeLabel = snapMode.id === "root"
					? "root"
					: snapMode.prompt.replace(/[\[\]>]/g, "").trim();
				const snapModeAccent = snapMode.accent || scheme.foreground.default;
				const snapModeHint = snapMode.id === "root"
					? "/help for commands  /script /builder /inspect to enter modes"
					: `/exit to leave ${snapMode.name}  /help for commands`;

				const dimScheme = darkenScheme(scheme, DIM_FACTOR);

				const snapSidebarVisible = sidebarVisibleRef.current;
				const snapSidebarW = snapSidebarVisible ? calcSidebarWidth(layout, columns) : 0;

				snapshotRef.current = {
					dimmedOutputText,
					modeLabel: snapModeLabel,
					modeAccent: snapModeAccent,
					contextLabel: snapMode.contextLabel ?? "",
					connectionStatus,
					modeHint: snapModeHint,
					scrollInfo: "",
					sidebarVisible: snapSidebarVisible,
					sidebarW: snapSidebarW,
					treeLabel: snapSidebarVisible ? snapMode.treeLabel : undefined,
					dimScheme,
					dimModeAccent: darkenHex(snapModeAccent, DIM_FACTOR),
					dimStatusColor: (status: ConnectionStatus) =>
						darkenHex(defaultStatusColor(status), DIM_FACTOR),
				};

				// Show overlay
				setOverlayData({
					title: result.title,
					content: result.content,
					lines: result.lines,
					footer: result.footer,
				});
			} else if (result.type === "text" && input.trim().startsWith("/density")) {
				// Density command - intercept to apply TUI-side state change
				const arg = input.trim().slice("/density".length).trim().toLowerCase();
				const validDensities = ["compact", "standard", "spacious"] as const;
				type D = typeof validDensities[number];
				if (arg === "auto" || arg === "") {
					setDensityOverride(undefined);
				} else if (validDensities.includes(arg as D)) {
					setDensityOverride(arg as LayoutDensity);
				}
				const applied = arg === "" || arg === "auto"
					? `auto (${computeLayout(columns, rows).density})`
					: arg;
				const densityBlock = renderResult({ type: "text", content: `Density: ${applied} (${columns}x${rows})` }, scheme, innerW);
				if (densityBlock) addBlocks([densityBlock]);
			} else if (result.type === "text" && input.trim().startsWith("/expand")) {
				const pattern = input.trim().slice("/expand".length).trim() || "*";
				const handle = treeSidebarRef.current;
				const msg = (handle && sidebarVisibleRef.current)
					? `Expanded ${handle.expandMatching(pattern)} node(s) matching "${pattern}"`
					: "Tree sidebar is not visible. Press Ctrl+B to open it.";
				const expandBlock = renderResult({ type: "text", content: msg }, scheme, innerW);
				if (expandBlock) addBlocks([expandBlock]);
			} else if (result.type === "text" && input.trim().startsWith("/collapse")) {
				const pattern = input.trim().slice("/collapse".length).trim() || "*";
				const handle = treeSidebarRef.current;
				const msg = (handle && sidebarVisibleRef.current)
					? `Collapsed ${handle.collapseMatching(pattern)} node(s) matching "${pattern}"`
					: "Tree sidebar is not visible. Press Ctrl+B to open it.";
				const collapseBlock = renderResult({ type: "text", content: msg }, scheme, innerW);
				if (collapseBlock) addBlocks([collapseBlock]);
			} else if (result.type === "empty" && input.startsWith("/")) {
				if (input.trim() === "/clear") {
					setOutputBlocks([]);
					setScrollOffset(0);
					userScrolledRef.current = false;
				}
			} else if (result.type !== "empty") {
				const rendered = renderResult(result, scheme, innerW);
				if (rendered) addBlocks([rendered]);
			}

			// Check for quit
			if (session.shouldQuit) {
				exit();
				return;
			}
		} catch (err) {
			const errBlock = renderResult({ type: "text", content: String(err) }, scheme, innerW);
			if (errBlock) addBlocks([errBlock]);
		} finally {
			disabledRef.current = false;
			setDisabled(false);
		}

	}, [session, scheme, addBlocks, exit, connectionStatus, columns, rows, contentColumns, layout, maxScrollOffset]);

	// ── Mode label ──────────────────────────────────────────────────

	const currentMode = session.currentMode();
	const modeLabel = currentMode.id === "root"
		? "root"
		: currentMode.prompt.replace(/[\[\]>]/g, "").trim();
	const modeAccent = currentMode.accent || scheme.foreground.default;
	const contextLabel = currentMode.contextLabel ?? "";
	const treeLabel = sidebarVisible ? currentMode.treeLabel : undefined;

	// Truncate output lines when sidebar visibility toggles (blocks are
	// width-baked at creation time, so old blocks may be too wide/narrow)
	const sidebarMountedRef = useRef(true);
	useEffect(() => {
		if (sidebarMountedRef.current) {
			sidebarMountedRef.current = false;
			return;
		}
		const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
		setOutputBlocks((prev) =>
			prev.map((block) => ({
				lines: block.lines.map((l) => truncateAnsi(l, innerW)),
				height: block.height,
			})),
		);
	}, [sidebarVisible]);

	// Auto-scroll to bottom when new content arrives.
	// Uses useEffect so totalLines is already committed (replaces stale setTimeout).
	useEffect(() => {
		if (!userScrolledRef.current) {
			setScrollOffset(maxScrollOffset());
		}
	}, [totalLines, maxScrollOffset]);

	// Clear search when mode changes (tree changes)
	const currentModeId = currentMode.id;
	const prevModeIdRef = useRef(currentModeId);
	useEffect(() => {
		if (prevModeIdRef.current !== currentModeId) {
			prevModeIdRef.current = currentModeId;
			setSearchText("");
			setSearchFocused(false);
		}
	}, [currentModeId]);

	// Syntax highlighting tokenizer from current mode (bound to avoid context loss)
	const modeTokenizer = currentMode.tokenizeInput
		? (v: string) => currentMode.tokenizeInput!(v)
		: undefined;

	// ── Scroll info ─────────────────────────────────────────────────

	// Scroll info
	const maxScroll = maxScrollOffset();
	const isAtBottom = scrollOffset >= maxScroll;
	const scrollInfo = totalLines <= outputHeight
		? ""
		: isAtBottom
			? "live"
			: `\u2191 scroll`;

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

	// Counter to force re-render after mode mutations (e.g. selectNode
	// changes currentPath but React doesn't know about it).
	const [, setRenderTick] = useState(0);

	const handleTreeSelect = useCallback((path: string[]) => {
		if (currentMode.selectNode) {
			currentMode.selectNode(path);
			setRenderTick((prev) => prev + 1);
		}
	}, [currentMode]);

	return (
		<ThemeProvider scheme={scheme} layout={layout}>
			<Box flexDirection="column" height={rows}>
				<TopBar
					modeLabel={modeLabel}
					modeAccent={modeAccent}
					connectionStatus={connectionStatus}
					columns={columns}
					treeLabel={treeLabel}
				/>
				<Box flexDirection="row" height={mainAreaHeight}>
					{sidebarVisible && (
					<TreeSidebar
						tree={modeTree}
						selectedPath={modeSelectedPath}
						width={sidebarW}
						height={mainAreaHeight}
						focused={sidebarFocused}
						accent={modeAccent}
						scheme={scheme}
						onSelect={handleTreeSelect}
						sidebarRef={treeSidebarRef}
						persistedState={sidebarStateRef.current}
						onStateChange={handleSidebarStateChange}
						onFocus={() => setSidebarFocused(true)}
						searchFocused={searchFocused}
						searchText={searchText}
					/>
					)}
					<Box ref={outputRef} flexDirection="column" flexGrow={1}>
						<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>
					{PROFILING_ENABLED ? (
					<Profiler id="Output" onRender={onRenderCallback}>
						<Output
							blocks={outputBlocks}
							allLines={allLines}
							totalLines={totalLines}
							scrollOffset={scrollOffset}
							viewportHeight={outputHeight}
							columns={contentColumns}
							animate={animate}
							hideScrollbar={completionState?.visible}
						/>
					</Profiler>
					) : (
					<Output
						blocks={outputBlocks}
						allLines={allLines}
						totalLines={totalLines}
						scrollOffset={scrollOffset}
						viewportHeight={outputHeight}
						columns={contentColumns}
						animate={animate}
						hideScrollbar={completionState?.visible}
					/>
					)}
						<Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>
					{completionState?.visible && (
						<CompletionPopup
							items={completionState.result.items}
							selectedIndex={completionState.selectedIndex}
							onSelect={handleCompletionSelect}
							onAccept={handleCompletionAccept}
							onDismiss={handleCompletionDismiss}
							leftOffset={completionState.result.from + layout.horizontalPad + (modeLabel === "root" ? 2 : modeLabel.length + 5)}
							scheme={scheme}
							label={completionState.result.label}
							maxVisible={layout.completionMaxVisible}
							maxWidth={layout.completionMaxWidth}
							rows={rows}
							columns={contentColumns}
							bottomOffset={INPUT_SECTION_ROWS + botH}
						/>
					)}
					<Box ref={inputBoxRef}>
						<Input
							modeLabel={modeLabel}
							modeAccent={modeAccent}
							contextLabel={contextLabel}
							columns={contentColumns}
							disabled={disabled || overlayData !== null}
							focused={!sidebarFocused}
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
								layout={layout}
							>
								{(() => {
									const snapContentCols = columns - snap.sidebarW;
									return (
									<Box
										position="absolute"
										marginLeft={0}
										marginTop={0}
										width={columns}
										flexDirection="column"
										height={rows}
									>
										<TopBar
											modeLabel={snap.modeLabel}
											modeAccent={snap.dimModeAccent}
											connectionStatus={snap.connectionStatus}
											columns={columns}
											treeLabel={snap.treeLabel}
										/>
										<Box flexDirection="row" height={mainAreaHeight}>
											{snap.sidebarVisible && (
												<Box
													width={snap.sidebarW}
													height={mainAreaHeight}
													backgroundColor={snap.dimScheme.backgrounds.sidebar}
												/>
											)}
											<Box flexDirection="column" flexGrow={1}>
												<Text backgroundColor={snap.dimScheme.backgrounds.standard}>
													{" ".repeat(snapContentCols)}
												</Text>
												<Box width={snapContentCols} height={outputHeight} backgroundColor={snap.dimScheme.backgrounds.standard}>
													<Text>{snap.dimmedOutputText}</Text>
												</Box>
												<Text backgroundColor={snap.dimScheme.backgrounds.standard}>
													{" ".repeat(snapContentCols)}
												</Text>
												<Input
													modeLabel={snap.modeLabel}
													modeAccent={snap.dimModeAccent}
													contextLabel={snap.contextLabel}
													focused={false}
													columns={snapContentCols}
													disabled={true}
													onSubmit={() => {}}
												/>
											</Box>
										</Box>
										<StatusBar
											connectionStatus={snap.connectionStatus}
											modeHint={snap.modeHint}
											scrollInfo={snap.scrollInfo}
											columns={columns}
										/>
									</Box>
									);
								})()}
							</ThemeProvider>
							<Overlay
								title={overlayData.title}
								accent={modeAccent}
							content={overlayData.content}
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
