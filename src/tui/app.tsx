// ── TUI App — main shell wiring Session to components ───────────────

import React, { useCallback, useEffect, useMemo, useRef, useState, Profiler } from "react";
import { Box, Text, useApp, useInput, useStdout } from "./ink-shim.js";
import type { DOMElement } from "./ink-shim.js";
import { MouseProvider, useOnWheel, useOnPress, useOnDrag, getBoundingClientRect } from "@ink-tools/ink-mouse";
import { shimYogaNodes } from "./ink-compat-shim.js";
import { isRezi } from "./ink-shim.js";
import { PROFILING_ENABLED, onRenderCallback } from "./profiler.js";
import type { CommandResult, TreeNode } from "../engine/result.js";
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
import { renderEcho, renderResult, truncateAnsi, wrapAnsi, fgHex, bgHex, RESET } from "./components/prerender.js";
import { Input, type InputHandle, offsetToLineCol, lineColToOffset, buildVisualRowMap, findVisualRow } from "./components/Input.js";
import { buildModeMap, type ModeMapEntry } from "../engine/run/mode-map.js";
import type { RunResult, ScriptProgressEvent, CommandOutput } from "../engine/run/types.js";
import { formatResultForLog, filterLogNoise } from "../engine/run/executor.js";
import { StatusBar } from "./components/StatusBar.js";
import { CompletionPopup } from "./components/CompletionPopup.js";
import { TreeSidebar, type TreeSidebarHandle, type TreeSidebarState } from "./components/TreeSidebar.js";
import { CompletionEngine } from "../engine/completion/engine.js";
import type { CompletionItem, CompletionResult } from "../engine/modes/mode.js";
import {
	brand,
	defaultScheme,
	hasTrueColor,
	snapSchemeFor256,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";
import { ThemeProvider } from "./theme-context.js";
import { darkenHex } from "./theme.js";
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
import type { WizardAnswers } from "../engine/wizard/types.js";
import { mergeInitDefaults } from "../engine/wizard/types.js";
import { WizardExecutor } from "../engine/wizard/executor.js";
import { renderWizardBlock, createInitialFormState, type WizardFormState } from "./components/wizard-render.js";
import { handleWizardKey } from "./components/wizard-keys.js";
import { listPathCompletions } from "./wizard-files.js";
import { wireScriptFileOps, wireExtendedFileOps } from "../node-io.js";
import { useOutputScroll } from "./hooks/useOutputScroll.js";
import { useWizardState } from "./hooks/useWizardState.js";
import { useSidebarState } from "./hooks/useSidebarState.js";
import { useKeyLabel, type InkKey } from "./hooks/useKeyLabel.js";

// ── Layout constants (non-scaling) ──────────────────────────────────

const SCROLL_WHEEL_LINES = 1; // lines per mouse wheel tick
const ENTER_ACCEPTS_COMPLETION = false; // true = Enter accepts popup selection, false = Enter submits typed text

// ── Shared script log formatter ──────────────────────────────────────

/** Render a single script progress event as ANSI output lines. */
function renderProgressLine(
	event: ScriptProgressEvent,
	scheme: ColorScheme,
	modeMap?: ModeMapEntry[],
): string[] {
	const dimmed = fgHex(scheme.foreground.muted);
	const bg = bgHex(scheme.backgrounds.standard);

	if (event.type === "command") {
		const cmd = event.output;
		// Section header for nested /run
		if (cmd.label) {
			return [bg + dimmed + "\u2502 \u2500\u2500 " + cmd.label + " \u2500\u2500" + RESET];
		}
		// Suppress mode entry/exit messages
		if (cmd.result.type === "text" && /^(Entered |Exited |Already in )/.test(cmd.result.content)) {
			return [];
		}
		const val = formatResultForLog(cmd.result);
		if (!val) return [];
		const modeEntry = modeMap && cmd.line > 0 && cmd.line <= modeMap.length
			? modeMap[cmd.line - 1] : undefined;
		const accent = cmd.accent
			?? (modeEntry && modeEntry.modeId !== "root" ? modeEntry.accent : undefined);
		const barColor = accent ? fgHex(accent) : dimmed;
		return val.split("\n").map(line =>
			bg + barColor + "\u2502" + RESET + bg + " " + line + RESET);
	}

	if (event.type === "expect") {
		const e = event.result;
		const icon = e.passed ? "\u2713" : "\u2717";
		const color = e.passed ? fgHex(brand.ok) : fgHex(brand.error);
		let line = `${icon} line ${e.line}: ${e.command} is ${e.expected}`;
		if (!e.passed) line += ` \u2014 got ${e.actual}`;
		return [bg + color + "\u2502 " + line + RESET];
	}

	if (event.type === "error") {
		const errFg = fgHex(brand.error);
		return [bg + errFg + "\u2502 \u2717 " + `ABORTED at line ${event.line}: ${filterLogNoise(event.message)}` + RESET];
	}

	return [];
}

/** Render the summary footer for a completed script run. */
function renderScriptFooter(
	result: RunResult,
	scheme: ColorScheme,
	actionCount: number,
): string[] {
	const bg = bgHex(scheme.backgrounds.standard);
	const errFg = fgHex(brand.error);
	const okFg = fgHex(brand.ok);
	const passed = result.expects.filter(e => e.passed).length;
	const total = result.expects.length;
	const statusColor = result.ok ? okFg : errFg;
	const statusIcon = result.ok ? "\u2713" : "\u2717";
	const parts: string[] = [];
	if (actionCount > 0) parts.push(`${actionCount} command${actionCount !== 1 ? "s" : ""} executed`);
	if (total > 0) parts.push(result.ok ? `PASSED ${passed}/${total}` : `FAILED ${passed}/${total}`);
	return [bg + statusColor + "\u2502 " + statusIcon + " " + parts.join(", ") + RESET, ""];
}

/** Non-streaming fallback: format a complete RunResult as a block. */
function formatScriptLog(
	source: string,
	result: RunResult,
	scheme: ColorScheme,
): PrerenderedBlock {
	const modeMap = buildModeMap(source.split("\n").map(l => l.trim()));
	const lines: string[] = [];
	let actionCount = 0;
	for (const cmd of result.results) {
		const event: ScriptProgressEvent = { type: "command", output: cmd };
		const rendered = renderProgressLine(event, scheme, modeMap);
		if (rendered.length > 0 && !cmd.label) actionCount++;
		lines.push(...rendered);
	}
	for (const exp of result.expects) {
		lines.push(...renderProgressLine({ type: "expect", result: exp }, scheme));
	}
	if (result.error) {
		lines.push(...renderProgressLine({ type: "error", line: result.error.line, message: result.error.message }, scheme));
	}
	lines.push(...renderScriptFooter(result, scheme, actionCount));
	return { lines, height: lines.length };
}

// ── File browser tree for multiline editor sidebar ──────────────────

function buildFileTree(files: string[]): TreeNode {
	const root: TreeNode = { label: "HSC Files", id: ".", children: [] };
	for (const file of files) {
		const parts = file.split("/");
		let current = root;
		for (let i = 0; i < parts.length; i++) {
			const part = parts[i]!;
			const isFile = i === parts.length - 1;
			if (isFile) {
				current.children!.push({ label: part, id: file });
			} else {
				let dir = current.children!.find(c => c.label === part && c.children);
				if (!dir) {
					dir = { label: part, children: [], id: parts.slice(0, i + 1).join("/") };
					current.children!.push(dir);
				}
				current = dir;
			}
		}
	}
	return root;
}

// ── App props ───────────────────────────────────────────────────────

export interface AppProps {
	connection: HiseConnection | null;
	dataLoader?: DataLoader;
	scheme?: ColorScheme;
	width?: number;  // override stdout.columns (for screencast runner)
	height?: number; // override stdout.rows (for screencast runner)
	animate?: boolean; // disable logo animation (--no-animation)
	handlerRegistry?: import("../engine/wizard/handler-registry.js").WizardHandlerRegistry;
	launcher?: import("../engine/modes/hise.js").HiseLauncher;
	showKeys?: boolean; // show key press badge in TopBar
}

// ── App component ───────────────────────────────────────────────────

export function App(props: AppProps) {
	return (
		<MouseProvider autoEnable={true}>
			<AppInner {...props} />
		</MouseProvider>
	);
}

function AppInner({ connection, dataLoader, scheme: schemeProp, width, height, animate, handlerRegistry, launcher, showKeys }: AppProps) {
	const { exit } = useApp();
	const { stdout } = useStdout();

	const schemeRaw = schemeProp ?? defaultScheme;
	const scheme = hasTrueColor ? schemeRaw : snapSchemeFor256(schemeRaw);
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

	// Loaded datasets — stored in refs so lazy mode factories always
	// get the latest data (even for modes created after initial load).
	const moduleListRef = useRef<import("../engine/data.js").ModuleList | undefined>(undefined);
	const componentPropsRef = useRef<import("../engine/modes/ui.js").ComponentPropertyMap | undefined>(undefined);

	// Session — created once, stored in ref
	const sessionRef = useRef<ReturnType<typeof createSession>["session"] | null>(null);
	if (!sessionRef.current) {
		sessionRef.current = createSession({
			connection,
			completionEngine,
			getModuleList: () => moduleListRef.current,
			getComponentProperties: () => componentPropsRef.current,
			handlerRegistry,
			launcher,
		}).session;
	}
	const session = sessionRef.current;

	// Wire up file I/O for /run, /parse, /edit, and /analyse commands.
	// Path resolution (project Scripts folder vs CWD) is handled by session.resolvePath().
	if (!session.loadScriptFile) {
		wireScriptFileOps(session);
	}
	if (!session.readBinaryFile) {
		wireExtendedFileOps(session);
	}

	if (!session.resolveHiseProjectFolder) {
		session.resolveHiseProjectFolder = async () => {
			const { readFile } = await import("node:fs/promises");
			const { join } = await import("node:path");
			const { homedir } = await import("node:os");
			const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
			const xmlPath = join(appData, "HISE", "projects.xml");
			try {
				const xml = await readFile(xmlPath, "utf-8");
				const match = xml.match(/current="([^"]+)"/);
				return match?.[1] ?? null;
			} catch {
				return null;
			}
		};
	}

	// Project info (fetched on first successful probe)
	const [projectName, setProjectName] = useState<string | undefined>(undefined);
	const [projectPath, setProjectPath] = useState<string | undefined>(undefined);

	// Multiline editor mode — toggled by /edit command
	const [multilineMode, setMultilineMode] = useState(false);
	const [editorErrorLines, setEditorErrorLines] = useState<number[] | undefined>(undefined);
	const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
	// Saved content for swapping between single-line and multiline modes
	const editorContentRef = useRef<string>("");
	const singleLineContentRef = useRef<string>("");

	// Input imperative handle + mouse support
	const inputHandleRef = useRef<InputHandle>(null);
	const inputBoxRef = useRef<DOMElement>(null);
	// Ref to grab sidebar focus setter (declared later, used in press handler)
	const setSidebarFocusedRef = useRef<(v: boolean) => void>(() => {});
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

	/** Convert mouse (x, y) to flat offset in multiline mode. */
	const inputXYToCharOffset = useCallback((absX: number, absY: number) => {
		const handle = inputHandleRef.current;
		if (!handle) return 0;
		const rect = getBoundingClientRect(inputBoxRef.current);
		const boxLeft = rect?.left ?? 0;
		const boxTop = rect?.top ?? 0;
		const { padLen } = handle.getLayoutMetrics();
		const value = handle.getValue();
		const lines = value.split("\n");
		const lineCount = lines.length;
		const maxLinesVal = editorMaxLines;

		// Layout (must match render calculations — use box width, not terminal columns)
		const boxWidth = rect?.width ?? columns;
		const lineNumberWidth = String(Math.max(lineCount, maxLinesVal)).length;
		const gutterChars = padLen + lineNumberWidth + 1 + 1 + 1;
		const bodyWidth = Math.max(1, boxWidth - padLen * 2 - gutterChars - 1);

		// Build visual row map
		const vrMap = buildVisualRowMap(lines, bodyWidth);
		const totalVRows = vrMap.length;

		// Compute vScrollStart (same logic as render)
		const { line: cursorLine, col: cursorCol } = offsetToLineCol(value, handle.getCursorPos());
		const cursorVRow = findVisualRow(vrMap, cursorLine, cursorCol);
		let vScrollStart = 0;
		if (totalVRows > maxLinesVal) {
			vScrollStart = Math.max(0, Math.min(
				cursorVRow - Math.floor(maxLinesVal * 0.5),
				totalVRows - maxLinesVal,
			));
		}

		// Row 0 is the top border, content starts at row 1
		const clickRow = absY - boxTop - 1;
		const vrIdx = Math.max(0, Math.min(totalVRows - 1, vScrollStart + clickRow));
		const vr = vrMap[vrIdx];
		if (!vr) return 0;

		const relX = absX - boxLeft - gutterChars;
		const col = vr.sliceStart + Math.max(0, Math.min(vr.sliceEnd - vr.sliceStart, relX));

		return lineColToOffset(value, vr.lineIdx, col);
	}, [columns]);

	useOnPress(inputBoxRef, useCallback((event: { x: number; y: number; button?: string }) => {
		const handle = inputHandleRef.current;
		if (!handle) return;

		// Right-click: copy selection to clipboard, preserve selection
		if (event.button === "right") {
			const sel = handle.getSelection();
			if (sel) {
				process.stdout.write(`\x1b]52;c;${Buffer.from(sel.text).toString("base64")}\x07`);
			}
			return;
		}

		// Click on editor grabs focus from sidebar
		setSidebarFocusedRef.current(false);

		const charPos = multilineMode
			? inputXYToCharOffset(event.x, event.y)
			: inputXToCharOffset(event.x);
		const now = Date.now();
		const last = lastInputClickRef.current;

		if (last && Math.abs(last.x - event.x) <= 1 && now - last.time < DOUBLE_CLICK_MS) {
			lastInputClickRef.current = null;
			handle.selectAll();
		} else {
			lastInputClickRef.current = { x: event.x, time: now };

			handle.setCursorAt(charPos);
		}
	}, [multilineMode, inputXToCharOffset, inputXYToCharOffset]));

	useOnDrag(inputBoxRef, useCallback((event: { x: number; y: number }) => {
		const handle = inputHandleRef.current;
		if (!handle) return;
		const charPos = multilineMode
			? inputXYToCharOffset(event.x, event.y)
			: inputXToCharOffset(event.x);

		handle.setCursorAt(charPos, true);
	}, [multilineMode, inputXToCharOffset, inputXYToCharOffset]));

	// Tree sidebar — state managed by custom hook
	const sidebar = useSidebarState(multilineMode, session, session.currentMode().id);
	const {
		treeSidebarRef, sidebarVisible, setSidebarVisible, sidebarVisibleRef,
		sidebarFocused, setSidebarFocused, setSidebarFocusedRef: sidebarFocusSetterRef,
		sidebarStateRef, handleSidebarStateChange,
		searchFocused, setSearchFocused, searchText, setSearchText,
	} = sidebar;
	setSidebarFocusedRef.current = setSidebarFocused;

	// Wizard state — managed by custom hook
	const wizard = useWizardState();
	const {
		wizardForm, setWizardForm, wizardFormRef,
		wizardProgress, setWizardProgress,
		abortRef, escTimestampRef, lastPhaseRef,
	} = wizard;

	// Connection / command state
	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("error");
	const [disabled, setDisabled] = useState(false);
	// Synchronous disabled check — avoids the React render-cycle gap
	// where keystrokes can arrive between setDisabled(true) and the
	// next render, causing them to be dropped by the useInput handler.
	const disabledRef = useRef(false);

	// Completion popup state
	const [completionState, setCompletionState] = useState<{
		result: CompletionResult;
		selectedIndex: number;
		visible: boolean;
		ghostText?: string;
		forValue?: string;
	} | null>(null);

	const outputRef = useRef<DOMElement>(null);

	// Shim yogaNode on ink-compat host nodes so @ink-tools/ink-mouse can
	// compute hit testing. Walk up from outputRef to root after each render.
	// No-op when building with stock Ink (esbuild dead-code eliminates this).
	useEffect(() => {
		if (!isRezi) return;
		let node: any = outputRef.current;
		while (node?.parent) node = node.parent;
		if (node) shimYogaNodes(node);
	});

	// ── Layout calculations ────────────────────────────────────────────

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
	// When wizard is active, Input is hidden — output gets the full height
	// When multiline editor is active, it takes ~40% of terminal height
	const editorMaxLines = Math.floor(rows * 0.4);
	const editorSectionRows = multilineMode ? editorMaxLines + 2 : INPUT_SECTION_ROWS; // +2 for borders
	const inputOverhead = wizardForm ? 0 : GAP_ROWS + editorSectionRows;
	const outputHeight = Math.max(
		layout.minOutputRows,
		mainAreaHeight - inputOverhead,
	);

	// ── Output blocks + scroll — managed by custom hook ────────────────

	const outputScroll = useOutputScroll(outputHeight, sidebarVisible, contentColumns, layout);
	const {
		outputBlocks, setOutputBlocks, outputBlocksRef,
		scrollOffset, setScrollOffset, scrollOffsetRef,
		allLines, totalLines, userScrolledRef,
		maxScrollOffset, scrollBy, scrollToBottom, scrollToTop,
		addBlocks,
	} = outputScroll;

	// ── Raw stdin listener + key badge ─────────────────────────────────

	// Raw stdin listener for Delete key (Ink can't distinguish Delete from Backspace).
	// Delete sends \x1b[3~ which Ink maps to key.delete same as Backspace (\x7f).
	// We intercept the raw sequence before Ink processes it.
	const deleteForwardRef = useRef(false);
	const f5PressedRef = useRef(false);
	const f7PressedRef = useRef(false);
	useEffect(() => {
		const onData = (data: Buffer) => {
			const str = data.toString();
			if (str === "\x1b[3~") {
				deleteForwardRef.current = true;
			}
			// F5: \x1b[15~ or \x1b[[E
			if (str === "\x1b[15~" || str === "\x1b[[E") {
				f5PressedRef.current = true;
			}
			// F7: \x1b[18~
			if (str === "\x1b[18~") {
				f7PressedRef.current = true;
			}
		};
		process.stdin.on("data", onData);
		return () => { process.stdin.off("data", onData); };
	}, []);

	// Show-keys badge — managed by custom hook
	const { keyLabel, pushKeyLabel } = useKeyLabel(showKeys ?? false, f5PressedRef, f7PressedRef);

	// ── Central key dispatcher — single useInput, priority chain ────
	//
	// Every keystroke goes through one handler chain. Each handler can
	// consume the event (return true) or pass it to the next handler
	// (return false). This guarantees exactly one action per keystroke.
	//
	// Priority: Global hotkeys > CompletionPopup >
	//           TreeSidebar (focused) > Input > App (scroll)

	// Regex to detect mouse escape sequence remnants. Ink's useInput strips
	// the leading \x1b from unrecognized CSI sequences, so mouse events
	// arrive as input strings like "[<64;15;10M" or "[<0;15;10m".
	const MOUSE_SEQ_RE = /^\[?<\d+;\d+;\d+[Mm]$/;

	useInput((input, key) => {
		if (disabledRef.current) {
			// Double-Escape (500ms debounce) to cancel running wizard
			if (key.escape && abortRef.current) {
				const now = Date.now();
				if (escTimestampRef.current > 0 && (now - escTimestampRef.current) < 500) {
					abortRef.current.abort();
					escTimestampRef.current = 0;
				} else {
					escTimestampRef.current = now;
				}
			}
			return;
		}

		// ── Show-keys badge (before dispatch, after mouse filter) ──
		if (!MOUSE_SEQ_RE.test(input)) {
			pushKeyLabel(input, key);
		}

		// ── Priority 1: Wizard form active ───────────────────────
		if (wizardFormRef.current) {
			const result = handleWizardKey(wizardFormRef.current, input, key);
			if (!result) return;
			if (result.action === "cancel") {
				// Re-render form deactivated (no signal highlights)
				const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
				const deactivated = { ...wizardFormRef.current!, active: false };
				const deactivatedBlock = renderWizardBlock(deactivated, scheme, innerW);
				setOutputBlocks((prev) => {
					const updated = [...prev];
					updated[updated.length - 1] = deactivatedBlock;
					return updated;
				});
				setWizardForm(null);
				const block = renderResult({ type: "text", content: "Wizard cancelled." }, scheme, innerW);
				if (block) addBlocks([block]);
				return;
			}
			if (result.action === "submit") {
				const form = wizardFormRef.current!;
				// Re-render form deactivated (no signal highlights)
				const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
				const deactivated = { ...form, active: false };
				const deactivatedBlock = renderWizardBlock(deactivated, scheme, innerW);
				setOutputBlocks((prev) => {
					const updated = [...prev];
					updated[updated.length - 1] = deactivatedBlock;
					return updated;
				});
				setWizardForm(null);
				void executeWizard(form, result.answers);
				return;
			}
			// action === "update" — re-render the form block
			let newState = result.state;

			// Recompute file path completions if signaled
			if (result.recomputeCompletions) {
				const def = newState.definition;
				const tab = def.tabs[newState.activeTab];
				const field = tab?.fields[newState.activeField];
				if (field?.type === "file") {
					const value = newState.answers[field.id] ?? "";
					const completions = listPathCompletions(value, {
						directory: field.directory,
						wildcard: field.wildcard,
					});
					newState = { ...newState, completions, completionIndex: 0 };
				}
			}

			setWizardForm(newState);
			const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
			const block = renderWizardBlock(newState, scheme, innerW);
			setOutputBlocks((prev) => {
				const updated = [...prev];
				updated[updated.length - 1] = block;
				return updated;
			});
			return;
		}

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
				if (multilineMode) {
					// Don't consume — fall through to multiline handler
					// so it can track the double-tap sequence
				} else {
					return; // consumed (single-line mode)
				}
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

		// ── Multiline overrides ───────────────────────────────────
		if (multilineMode) {
			// F5 — run script (HISE compile shortcut)
			if (f5PressedRef.current) {
				f5PressedRef.current = false;
				setCompletionState(null);
				handle.submit();
				return;
			}
			// F7 — validate script (static + live dry-run, save on success)
			if (f7PressedRef.current) {
				f7PressedRef.current = false;
				setCompletionState(null);
				const value = handle.getValue();
				const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
				void (async () => {
					const { parseScript } = await import("../engine/run/parser.js");
					const { validateScript, formatValidationReport } = await import("../engine/run/validator.js");
					const { dryRunScript } = await import("../engine/run/executor.js");

					setEditorErrorLines(undefined);

					// Phase 1: static validation (multi-recovery)
					const script = parseScript(value);
					const staticResult = validateScript(script, session);

					if (!staticResult.ok) {
						setEditorErrorLines(staticResult.errors.map(e => e.line));
						const block = renderResult({ type: "error", message: formatValidationReport(staticResult) }, scheme, innerW);
						if (block) addBlocks([block]);
						return;
					}

					// Phase 2: live dry-run (undo-group-wrapped execution)
					if (session.connection) {
						const liveResult = await dryRunScript(script, session);

						if (!liveResult.ok) {
							setEditorErrorLines(liveResult.errors.map(e => e.line));
							const block = renderResult({ type: "error", message: formatValidationReport(liveResult) }, scheme, innerW);
							if (block) addBlocks([block]);
							return;
						}
					}

					// Both phases passed — save if editing a file
					if (editorFilePath && session.saveScriptFile) {
						try {
							await session.saveScriptFile(editorFilePath, value);
							const block = renderResult({ type: "text", content: `Validation passed — saved "${editorFilePath.split(/[\\/]/).pop()}"` }, scheme, innerW);
							if (block) addBlocks([block]);
						} catch (err) {
							const block = renderResult({ type: "error", message: `Save failed: ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
							if (block) addBlocks([block]);
						}
					} else {
						const block = renderResult({ type: "text", content: "Validation passed — no errors found." }, scheme, innerW);
						if (block) addBlocks([block]);
					}
				})();
				return;
			}
			if (key.ctrl && key.return) {
				// Ctrl+Enter → submit in multiline mode
				setCompletionState(null);
				handle.submit();
				return;
			}
			if (key.return) {
				// Enter → insert newline
				handle.insertChar("\n");
				return;
			}
			if (key.escape) {
				// Double-Escape (500ms) → exit multiline mode
				// Single Escape → toggle completion popup (same as single-line)
				const now = Date.now();
				if (escTimestampRef.current > 0 && (now - escTimestampRef.current) < 500) {
					escTimestampRef.current = 0;
					setCompletionState(null);
					// Save multiline content, clear single-line input
					editorContentRef.current = handle.getValue();
					setMultilineMode(false);
					setEditorErrorLines(undefined);
					handle.setValue("");
					// Refresh .hsc file cache (new files may have been created)
					void session.refreshScriptFileCache();
				} else {
					escTimestampRef.current = now;
					// Toggle completion popup
					handleEscape();
				}
				return;
			}
			if (key.upArrow) {
				handle.moveCursor("up", key.shift);
				return;
			}
			if (key.downArrow) {
				handle.moveCursor("down", key.shift);
				return;
			}
			// Home/End → line-level in multiline (Cmd/Meta → global)
			if (key.home && !key.meta && !key.ctrl) {
				handle.moveCursor("lineHome", key.shift);
				return;
			}
			if (key.end && !key.meta && !key.ctrl) {
				handle.moveCursor("lineEnd", key.shift);
				return;
			}
			// Fall through to shared key handlers below
		}

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
		// Ctrl+A — select all
		else if (key.ctrl && input === "a") {
			handle.selectAll();
			return;
		}
		// Ctrl+C — copy selection to clipboard, or exit if no selection
		else if (key.ctrl && input === "c") {
			const sel = handle.getSelection();
			if (sel) {
				process.stdout.write(`\x1b]52;c;${Buffer.from(sel.text).toString("base64")}\x07`);
			} else {
				exit();
			}
			return;
		}
		// Ctrl+Z — undo
		else if (key.ctrl && input === "z") {
			handle.undo();
			return;
		}
		// Ctrl+Y — redo
		else if (key.ctrl && input === "y") {
			handle.redo();
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
		// Ctrl+D — delete forward (readline convention)
		else if (key.ctrl && input === "d") {
			handle.deleteForward();
		}
		// Backspace / Delete — distinguished via raw stdin interception
		else if (key.backspace || key.delete) {
			if (deleteForwardRef.current) {
				deleteForwardRef.current = false;
				handle.deleteForward();
			} else {
				handle.deleteBackward();
			}
			return;
		}
		// Tab — trigger/accept completion (when sidebar not visible)
		else if (key.tab) {
			handleTab();
			return;
		}
		// Regular character input (including pasted text)
		else if (input && !key.ctrl && !key.meta) {
			if (MOUSE_SEQ_RE.test(input)) return;
			if (multilineMode) {
				// In multiline: normalize line endings, filter control chars, allow newlines
				const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				const cleaned = normalized.replace(/[^\n\x20-\x7e\x80-\uffff]/g, "");
				if (cleaned) handle.insertChar(cleaned);
			} else {
				// In single-line: strip all control chars including newlines
				const code = input.charCodeAt(0);
				if (code < 0x20 || code === 0x7f) return;
				handle.insertChar(input);
			}
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
		if (completionState?.visible) return;
		if (event.button === "wheel-up") {
			scrollBy(-SCROLL_WHEEL_LINES);
		} else if (event.button === "wheel-down") {
			scrollBy(SCROLL_WHEEL_LINES);
		}
	});

	// Mouse wheel on input box: scroll the multiline editor without moving cursor
	useOnWheel(inputBoxRef, (event) => {
		if (!multilineMode) return;
		const handle = inputHandleRef.current;
		if (!handle) return;
		if (event.button === "wheel-up") {
			handle.scrollEditor(-SCROLL_WHEEL_LINES);
		} else if (event.button === "wheel-down") {
			handle.scrollEditor(SCROLL_WHEEL_LINES);
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
					// Fetch project info on first successful connection
					if (alive && !session.projectFolder) {
						try {
							const resp = await connection.get("/api/status");
							// /api/status returns project info at the top level, not inside value/result
							const data = resp as unknown as Record<string, unknown>;
							if (data.success && data.project && typeof data.project === "object") {
								const proj = data.project as Record<string, unknown>;
								const name = typeof proj.name === "string" ? proj.name : undefined;
								const folder = typeof proj.projectFolder === "string" ? proj.projectFolder : undefined;
								if (name) session.projectName = name;
								if (folder) {
									session.projectFolder = folder;
									void session.refreshScriptFileCache();
								}
								if (!cancelled) {
									setProjectName(name);
									setProjectPath(folder);
								}
							}
						} catch { /* ignore — project info is optional */ }
					}
					// Fallback: resolve from projects.xml if HISE not connected
					if (!alive && !session.projectFolder && session.resolveHiseProjectFolder) {
						try {
							const folder = await session.resolveHiseProjectFolder();
							if (folder && !cancelled) {
								session.projectFolder = folder;
								setProjectPath(folder);
								void session.refreshScriptFileCache();
							}
						} catch { /* ignore */ }
					}
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
				const datasets = await loadSessionDatasets(dataLoader, completionEngine, session);
				if (!cancelled) {
					// Store for future mode instances via lazy factories
					moduleListRef.current = datasets.moduleList;
					componentPropsRef.current = datasets.componentProperties;
					// Update existing builder mode instances with module data
					if (datasets.moduleList) {
						for (const mode of session.modeStack) {
							if (mode instanceof BuilderMode) {
								mode.setModuleList(datasets.moduleList);
							}
						}
					}
				}
			} catch {
				// Data not available — validation will be skipped
			}
		}

		void load();

		return () => { cancelled = true; };
	}, [dataLoader, session, completionEngine]);

	// ── Input handler ───────────────────────────────────────────────

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
		// ── /run command: streaming execution ──────────────────
		if (!multilineMode && input.trim().startsWith("/run ")) {
			let arg = input.trim().slice("/run".length).trim();
			if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
				arg = arg.slice(1, -1);
			}
			if (arg && session.loadScriptFile) {
				const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
				disabledRef.current = true;
				setDisabled(true);
				try {
					const { parseScript } = await import("../engine/run/parser.js");
					const { validateScript, formatValidationReport } = await import("../engine/run/validator.js");
					const { executeScript } = await import("../engine/run/executor.js");

					let source: string;
					try {
						source = await session.loadScriptFile(arg);
					} catch (err: any) {
						const block = renderResult({ type: "error", message: `Failed to load "${arg}": ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
						if (block) addBlocks([block]);
						return;
					}

					const script = parseScript(source);
					if (script.lines.length === 0) {
						const block = renderResult({ type: "text", content: "Script is empty." }, scheme, innerW);
						if (block) addBlocks([block]);
						return;
					}

					const validation = validateScript(script, session);
					if (!validation.ok) {
						const block = renderResult({ type: "error", message: formatValidationReport(validation) }, scheme, innerW);
						if (block) addBlocks([block]);
						return;
					}

					// Echo
					const fileName = arg.split(/[\\/]/).pop() ?? arg;
					const accent = scheme.foreground.muted;
					const echoBlock = renderEcho(`/run ${fileName}`, accent, scheme.backgrounds.darker, innerW);
					addBlocks([echoBlock]);

					// Streaming execution
					const modeMap = buildModeMap(source.split("\n").map(l => l.trim()));
					addBlocks([{ lines: [], height: 0 }]);
					let streamActionCount = 0;

					const result = await executeScript(script, session, (event) => {
						const lines = renderProgressLine(event, scheme, modeMap);
						if (lines.length === 0) return;
						if (event.type === "command" && !event.output.label) streamActionCount++;
						setOutputBlocks(prev => {
							const last = prev[prev.length - 1]!;
							return [...prev.slice(0, -1), { lines: [...last.lines, ...lines], height: last.height + lines.length }];
						});
					});

					const footer = renderScriptFooter(result, scheme, streamActionCount);
					setOutputBlocks(prev => {
						const last = prev[prev.length - 1]!;
						return [...prev.slice(0, -1), { lines: [...last.lines, ...footer], height: last.height + footer.length }];
					});
				} catch (err) {
					const block = renderResult({ type: "error", message: `Script error: ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
					if (block) addBlocks([block]);
				} finally {
					disabledRef.current = false;
					setDisabled(false);
				}
				return;
			}
		}

		// ── /edit command: toggle multiline editor mode ──────────
		if (input.trim() === "/edit" || input.trim().startsWith("/edit ")) {
			let arg = input.trim().slice("/edit".length).trim();
			// Strip surrounding quotes from filename
			if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
				arg = arg.slice(1, -1);
			}
			const handle = inputHandleRef.current;
			if (arg && session.loadScriptFile) {
				// /edit file.hsc — load file or create if missing
				try {
					const content = await session.loadScriptFile(arg);
					// Save single-line content, switch to multiline
					if (handle) singleLineContentRef.current = handle.getValue();
					setEditorFilePath(arg);
					setMultilineMode(true);
					if (handle) handle.setValue(content.replace(/\r\n/g, "\n").trimEnd());
				} catch (err: any) {
					if (err?.code === "ENOENT" && session.saveScriptFile) {
						// File doesn't exist — create it and open empty editor
						try {
							await session.saveScriptFile(arg, "");
							if (handle) singleLineContentRef.current = handle.getValue();
							setEditorFilePath(arg);
							setMultilineMode(true);
							if (handle) handle.setValue("");
						} catch (saveErr) {
							const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
							const block = renderResult({ type: "error", message: `Failed to create "${arg}": ${saveErr instanceof Error ? saveErr.message : String(saveErr)}` }, scheme, innerW);
							if (block) addBlocks([block]);
						}
					} else {
						const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
						const block = renderResult({ type: "error", message: `Failed to load "${arg}": ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
						if (block) addBlocks([block]);
					}
				}
			} else {
				// /edit with no arg — restore previous editor content
				if (handle) singleLineContentRef.current = handle.getValue();
				setMultilineMode(true);
				if (handle) handle.setValue(editorContentRef.current);
			}
			return;
		}

		// ── Multiline submit: execute as .hsc script ────────────
		if (multilineMode) {
			const innerW = contentColumns - 1 - 2 * layout.horizontalPad;
			disabledRef.current = true;
			setDisabled(true);
			try {
				const { parseScript } = await import("../engine/run/parser.js");
				const { validateScript, formatValidationReport } = await import("../engine/run/validator.js");
				const { executeScript } = await import("../engine/run/executor.js");

				// Clear previous error highlight
				setEditorErrorLines(undefined);

				// Save to file if associated
				if (editorFilePath && session.saveScriptFile) {
					try {
						await session.saveScriptFile(editorFilePath, input);
					} catch (err) {
						const block = renderResult({ type: "error", message: `Save failed: ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
						if (block) addBlocks([block]);
						return;
					}
				}

				const script = parseScript(input);
				const validation = validateScript(script, session);

				if (!validation.ok) {
					// Highlight all error lines in editor
					if (validation.errors.length > 0) {
						setEditorErrorLines(validation.errors.map(e => e.line));
					}
					const block = renderResult({ type: "error", message: formatValidationReport(validation) }, scheme, innerW);
					if (block) addBlocks([block]);
					return;
				}

				// Echo: condensed when file is associated, full script otherwise
				const echoText = editorFilePath
					? `Execute script "${editorFilePath.split(/[\\/]/).pop()}"`
					: input;
				const echoBlock = renderEcho(echoText, scheme.foreground.muted, scheme.backgrounds.darker, innerW);
				addBlocks([echoBlock]);

				// Build mode map for coloring
				const scriptLines = input.split("\n").map(l => l.trim());
				const modeMap = buildModeMap(scriptLines);

				// Start streaming output block
				addBlocks([{ lines: [], height: 0 }]);
				let streamActionCount = 0;

				const result = await executeScript(script, session, (event) => {
					const lines = renderProgressLine(event, scheme, modeMap);
					if (lines.length === 0) return;
					if (event.type === "command" && !event.output.label) streamActionCount++;
					setOutputBlocks(prev => {
						const last = prev[prev.length - 1]!;
						return [...prev.slice(0, -1), { lines: [...last.lines, ...lines], height: last.height + lines.length }];
					});
				});

				// Highlight error line in editor if execution failed
				if (result.error) {
					setEditorErrorLines([result.error.line]);
				}

				// Append summary footer
				const footer = renderScriptFooter(result, scheme, streamActionCount);
				setOutputBlocks(prev => {
					const last = prev[prev.length - 1]!;
					return [...prev.slice(0, -1), { lines: [...last.lines, ...footer], height: last.height + footer.length }];
				});
			} catch (err) {
				const block = renderResult({ type: "error", message: `Script error: ${err instanceof Error ? err.message : String(err)}` }, scheme, innerW);
				if (block) addBlocks([block]);
			} finally {
				disabledRef.current = false;
				setDisabled(false);
			}
			return;
		}

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

			if (result.type === "wizard") {
				// Wizard result — run init to fetch defaults, then render form
				const executor = new WizardExecutor({
					connection: session.connection,
					handlerRegistry: session.handlerRegistry,
				});
				const initDefaults = await executor.initialize(result.definition);
				const mergedDef = mergeInitDefaults(result.definition, initDefaults);
				const formState = createInitialFormState(mergedDef, result.prefill);
				setWizardForm(formState);
				const block = renderWizardBlock(formState, scheme, innerW);
				addBlocks([block]);
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
			} else if (result.type === "text" && input.trim() === "/compact") {
				const mode = session.currentMode();
				if (mode instanceof BuilderMode) {
					mode.compactView = !mode.compactView;
					const msg = mode.compactView ? "Compact view (chains hidden)" : "Full view (chains visible)";
					const block = renderResult({ type: "text", content: msg }, scheme, innerW);
					if (block) addBlocks([block]);
				} else {
					const block = renderResult({ type: "text", content: "/compact is only available in builder mode" }, scheme, innerW);
					if (block) addBlocks([block]);
				}
			} else if (result.type === "run-report") {
				const logBlock = formatScriptLog(result.source, result.runResult, scheme);
				addBlocks([logBlock]);
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
			// Refresh tree sidebar from current mode after every command
			const mode = session.currentMode();
			setModeTree(mode.getTree?.() ?? null);
			setModeSelectedPath(mode.getSelectedPath?.() ?? []);
		}

	}, [session, scheme, addBlocks, exit, connectionStatus, columns, rows, contentColumns, layout, maxScrollOffset]);

	// ── Wizard execution (after submit) ─────────────────────────────

	const executeWizard = useCallback(async (form: WizardFormState, answers: WizardAnswers) => {
		const def = form.definition;
		const innerW = contentColumns - 1 - 2 * layout.horizontalPad;

		const hasHttpTasks = def.tasks.some((t) => t.type === "http");
		if (hasHttpTasks && !session.connection) {
			const block = renderResult({ type: "error", message: "No HISE connection \u2014 cannot execute HTTP wizard tasks." }, scheme, innerW);
			if (block) addBlocks([block]);
			return;
		}

		disabledRef.current = true;
		setDisabled(true);
		lastPhaseRef.current = "";
		const controller = new AbortController();
		abortRef.current = controller;

		// ANSI color helpers
		const dim = fgHex(scheme.foreground.muted);
		const warn = fgHex(brand.warning);
		const err = fgHex(brand.error);
		const ok = fgHex(brand.ok);
		const accent = fgHex(scheme.foreground.default);
		const bold = "\x1b[1m";

		const appendLine = (line: string) => {
			const wrapped = wrapAnsi(line, innerW);
			setOutputBlocks((prev) => {
				const last = prev[prev.length - 1];
				if (last) {
					const updated = { ...last, lines: [...last.lines, ...wrapped], height: last.height + wrapped.length };
					return [...prev.slice(0, -1), updated];
				}
				return [...prev, { lines: wrapped, height: wrapped.length }];
			});
		};

		try {
			const executor = new WizardExecutor({
				connection: session.connection,
				handlerRegistry: session.handlerRegistry,
			});
			const result = await executor.execute(def, answers, (progress) => {
				// Update StatusBar progress
				setWizardProgress({
					percent: progress.percent ?? 0,
					message: progress.phase === "Starting" ? def.header : progress.phase,
				});

				// Check for heading marker from executor
				if (progress.message?.startsWith("__heading__")) {
					const heading = progress.message.slice("__heading__".length);
					lastPhaseRef.current = progress.phase;
					appendLine(" ");
					appendLine(`${bold}${accent}${heading}${RESET}`);
					return;
				}

				// Skip phase-only progress with no message
				if (!progress.message) return;

				// Colorize based on unicode marker prefixes
				const msg = progress.message;
				let line: string;
				if (msg.startsWith("✗ ")) {
					line = `${err}✗ ${msg.slice(2)}${RESET}`;
				} else if (msg.startsWith("⚠ ")) {
					line = `${warn}⚠ ${msg.slice(2)}${RESET}`;
				} else if (msg.startsWith("✓ ")) {
					line = `${ok}✓ ${msg.slice(2)}${RESET}`;
				} else {
					line = `${dim}${msg}${RESET}`;
				}
				appendLine(line);
			}, controller.signal);

			if (result.success) {
				const msg = result.message;
				if (msg.startsWith("✓ ")) {
					appendLine(" ");
					appendLine(`${ok}✓ ${msg.slice(2)}${RESET}`);
				} else {
					appendLine(`${ok}✓ ${msg}${RESET}`);
				}
				if (result.postActions && result.postActions.length > 0) {
					const lines = result.postActions.map((a, i) => `  [${i + 1}] ${a.label}`).join("\n");
					const actionBlock = renderResult({ type: "text", content: `\n${lines}` }, scheme, innerW);
					if (actionBlock) addBlocks([actionBlock]);
				}
			} else {
				appendLine(`${err}✗ ${result.message}${RESET}`);
			}
		} catch (e) {
			appendLine(`${err}✗ ${String(e)}${RESET}`);
		} finally {
			disabledRef.current = false;
			setDisabled(false);
			setWizardProgress(null);
			abortRef.current = null;
			escTimestampRef.current = 0;
		}
	}, [session, scheme, contentColumns, layout, addBlocks]);

	// ── Mode label ──────────────────────────────────────────────────

	const currentMode = session.currentMode();
	const modeLabel = currentMode.id === "root"
		? "root"
		: currentMode.prompt.replace(/[\[\]>]/g, "").trim();
	const modeAccent = currentMode.accent || scheme.foreground.default;
	const contextLabel = currentMode.contextLabel ?? "";
	const treeLabel = sidebarVisible ? currentMode.treeLabel : undefined;

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
	const modeHint = wizardForm
		? "" // Wizard has its own hint bar in the output block
		: multilineMode
			? `[F5] run script  [escape] autocomplete  [escape x2] exit  [tab] complete`
			: currentMode.id === "root"
				? `/help for commands    [escape] for context menu  /script /builder /inspect to enter modes${scrollHint ? `  ${scrollHint}` : ""}`
				: `/exit to leave ${currentMode.name}  /help for commands  [escape] for context menu${scrollHint ? `  ${scrollHint}` : ""}`;

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
		// Clear error highlight when user edits
		if (editorErrorLines !== undefined) setEditorErrorLines(undefined);

		if (value.length < 1) {
			setCompletionState(null);
			return;
		}

		let completionResult: import("../engine/modes/mode.js").CompletionResult;

		if (multilineMode) {
			// Multiline: complete based on the current line and its mode
			const { line: lineIdx, col } = offsetToLineCol(value, cursorPos);
			const lines = value.split("\n");
			const lineText = lines[lineIdx] ?? "";

			// Don't trigger completion on empty lines or comment lines
			const trimmedLine = lineText.trim();
			if (trimmedLine.length === 0 || trimmedLine.startsWith("#") || trimmedLine.startsWith("//")) {
				setCompletionState(null);
				return;
			}

			// Only complete when cursor is at end of the current line
			if (col < lineText.length) {
				setCompletionState(null);
				return;
			}

			if (lineText.startsWith("/")) {
				// Slash command: use session.complete which handles slash + mode args
				completionResult = session.complete(lineText, col);
			} else {
				// Mode-specific: look up mode from mode map
				const modeMap = buildModeMap(lines);
				const entry = modeMap[lineIdx];
				if (entry && entry.modeId !== "root") {
					try {
						const mode = session.getOrCreateMode(entry.modeId);
						if (mode.complete) {
							completionResult = mode.complete(lineText, col);
						} else {
							setCompletionState(null);
							return;
						}
					} catch {
						setCompletionState(null);
						return;
					}
				} else {
					// Root mode: try slash completion
					completionResult = session.complete(lineText, col);
				}
			}

			// Adjust result offsets from line-relative to absolute
			const lineStart = lineColToOffset(value, lineIdx, 0);
			completionResult = {
				...completionResult,
				from: completionResult.from + lineStart,
				to: completionResult.to + lineStart,
			};
		} else {
			// Single-line: cursor must be at end of input
			if (cursorPos < value.length) {
				setCompletionState(null);
				return;
			}
			completionResult = session.complete(value, cursorPos);
		}

		if (completionResult.items.length > 0) {
			// Auto-close: if any item exactly matches the typed token
			const token = value.slice(completionResult.from);
			if (token.length > 0 && completionResult.items.some((item) => {
				const itemText = item.insertText ?? item.label;
				return token === itemText;
			})) {
				setCompletionState(null);
				return;
			}

			const ghostText = computeGhostText(value, completionResult, 0);
			setCompletionState({
				result: completionResult,
				selectedIndex: 0,
				visible: true,
				ghostText,
				forValue: value,
			});
		} else {
			setCompletionState(null);
		}
	}, [session, multilineMode, computeGhostText]);

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
			currentValue.slice(0, result.from) + insertText + currentValue.slice(result.to);
		handle.setValue(newValue);
		handle.setCursorAt(result.from + insertText.length);
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

	// ── Tree sidebar data (React state so updates trigger re-render) ──
	const [modeTree, setModeTree] = useState<TreeNode | null>(currentMode.getTree?.() ?? null);
	const [modeSelectedPath, setModeSelectedPath] = useState<string[]>(currentMode.getSelectedPath?.() ?? []);

	// In multiline editor mode, override tree with file browser
	const fileTree = useMemo(() =>
		multilineMode && session.scriptFileCache.length > 0
			? buildFileTree(session.scriptFileCache)
			: null,
		[multilineMode, session.scriptFileCache],
	);
	const effectiveTree = fileTree ?? modeTree;
	const effectiveTreeLabel = multilineMode ? "HSC Files" : treeLabel;
	// Build selected path matching the tree node IDs (dir ids are path prefixes, file id is full path)
	const effectiveSelectedPath = useMemo(() => {
		if (!multilineMode || !editorFilePath) return modeSelectedPath;
		const parts = editorFilePath.split("/");
		const path: string[] = [];
		for (let i = 0; i < parts.length; i++) {
			path.push(parts.slice(0, i + 1).join("/"));
		}
		return path;
	}, [multilineMode, editorFilePath, modeSelectedPath]);

	const handleTreeSelect = useCallback((path: string[]) => {
		if (multilineMode) {
			// File browser: load selected .hsc file into editor
			const filePath = path[path.length - 1];
			if (filePath?.endsWith(".hsc") && session.loadScriptFile) {
				session.loadScriptFile(filePath).then(content => {
					const handle = inputHandleRef.current;
					if (handle) {
						handle.setValue(content.replace(/\r\n/g, "\n").trimEnd());
					}
					setEditorFilePath(filePath);
				}).catch(() => { /* ignore load errors */ });
			}
			return;
		}
		if (currentMode.selectNode) {
			currentMode.selectNode(path);
			setModeTree(currentMode.getTree?.() ?? null);
			setModeSelectedPath(currentMode.getSelectedPath?.() ?? []);
		}
	}, [multilineMode, currentMode, session]);

	return (
		<ThemeProvider scheme={scheme} layout={layout}>
			<Box flexDirection="column" height={rows}>
				<TopBar
					modeLabel={modeLabel}
					modeAccent={modeAccent}
					connectionStatus={connectionStatus}
					columns={columns}
					treeLabel={effectiveTreeLabel}
					projectName={projectName}
					projectPath={projectPath ?? process.cwd()}
					keyLabel={keyLabel}
				/>
				<Box flexDirection="row" height={mainAreaHeight}>
					{sidebarVisible && (
					<TreeSidebar
						tree={effectiveTree}
						selectedPath={effectiveSelectedPath}
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
					<Box ref={outputRef} flexDirection="column" flexGrow={1} width={contentColumns}>
						{!wizardForm && <Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>}
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
					{!wizardForm && <Text backgroundColor={scheme.backgrounds.standard}>{" ".repeat(contentColumns)}</Text>}
					{!wizardForm && !multilineMode && completionState?.visible && (
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
							rows={mainAreaHeight}
							columns={contentColumns}
							bottomOffset={INPUT_SECTION_ROWS}
						/>
					)}
					{!wizardForm && (
					<Box ref={inputBoxRef}>
						<Input
							modeLabel={modeLabel}
							modeAccent={modeAccent}
							contextLabel={contextLabel}
							columns={contentColumns}
							disabled={disabled}
							focused={!sidebarFocused}
							multiline={multilineMode}
							maxLines={editorMaxLines}
							errorLines={editorErrorLines}
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
					)}
					{!wizardForm && multilineMode && completionState?.visible && (
						<CompletionPopup
							items={completionState.result.items}
							selectedIndex={completionState.selectedIndex}
							onSelect={handleCompletionSelect}
							onAccept={handleCompletionAccept}
							onDismiss={handleCompletionDismiss}
							scheme={{ ...scheme, backgrounds: { ...scheme.backgrounds, overlay: darkenHex(scheme.backgrounds.raised, 0.9) } }}

							leftOffset={(() => {
								const val = inputHandleRef.current?.getValue() ?? "";
								const { line: lineIdx } = offsetToLineCol(val, completionState.result.from);
								const lineStart = lineColToOffset(val, lineIdx, 0);
								const lineRelFrom = completionState.result.from - lineStart;
								const gutterW = layout.horizontalPad + String(editorMaxLines).length + 2;
								return lineRelFrom + gutterW;
							})()}
							label={completionState.result.label}
							maxVisible={layout.completionMaxVisible}
							rows={mainAreaHeight}
							columns={contentColumns}
							bottomOffset={(() => {
								const handle = inputHandleRef.current;
								if (!handle) return editorSectionRows;
								const cursorViewportRow = handle.getCursorViewportRow?.() ?? 0;
								const editorTop = mainAreaHeight - editorSectionRows;
								return Math.max(0, mainAreaHeight - editorTop - cursorViewportRow - 1);
							})()}
						/>
					)}
					</Box>
				</Box>
				<StatusBar
					connectionStatus={connectionStatus}
					modeHint={modeHint}
					scrollInfo={scrollInfo}
					columns={columns}
					wizardProgress={wizardProgress}
				/>
		</Box>
		</ThemeProvider>
	);
}
