// ── Input — mode-colored prompt with cursor navigation + command history ──

import React, {
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
// Note: useInput intentionally NOT imported — Input is fully controlled
// by the central key dispatcher in app.tsx via imperative methods.
import { Box, Text } from "../ink-shim.js";

import { useTheme } from "../theme-context.js";
import { lightenHex, lerpHex, darkenHex } from "../theme.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";
import { sliceSpans, splitSpansAtCursor } from "../../engine/highlight/split.js";
import { buildModeMap, tokenizerForLine } from "../../engine/run/mode-map.js";

// ── Word boundary helpers ───────────────────────────────────────────

/** Jump cursor left to the previous word boundary (Option+Left). */
export function wordBoundaryLeft(text: string, pos: number): number {
	let i = pos - 1;
	while (i > 0 && /\s/.test(text[i - 1]!)) i--;
	while (i > 0 && /\S/.test(text[i - 1]!)) i--;
	return Math.max(0, i);
}

/** Jump cursor right to the next word boundary (Option+Right). */
export function wordBoundaryRight(text: string, pos: number): number {
	let i = pos;
	while (i < text.length && /\S/.test(text[i]!)) i++;
	while (i < text.length && /\s/.test(text[i]!)) i++;
	return i;
}

// ── Multiline cursor helpers ───────────────────────────────────────

/** Convert a flat cursor offset to (line, col) in a multiline string. */
export function offsetToLineCol(value: string, offset: number): { line: number; col: number } {
	let line = 0;
	let lineStart = 0;
	for (let i = 0; i < offset; i++) {
		if (value[i] === "\n") {
			line++;
			lineStart = i + 1;
		}
	}
	return { line, col: offset - lineStart };
}

/** Convert (line, col) back to a flat offset. Clamps col to line length. */
export function lineColToOffset(value: string, line: number, col: number): number {
	const lines = value.split("\n");
	const targetLine = Math.max(0, Math.min(line, lines.length - 1));
	let offset = 0;
	for (let i = 0; i < targetLine; i++) {
		offset += lines[i]!.length + 1; // +1 for \n
	}
	const lineLen = lines[targetLine]!.length;
	return offset + Math.min(col, lineLen);
}

/** Get the start offset of the line containing `offset`. */
function lineStartOffset(value: string, offset: number): number {
	const idx = value.lastIndexOf("\n", offset - 1);
	return idx === -1 ? 0 : idx + 1;
}

/** Get the end offset (exclusive, before \n) of the line containing `offset`. */
function lineEndOffset(value: string, offset: number): number {
	const idx = value.indexOf("\n", offset);
	return idx === -1 ? value.length : idx;
}

// ── Input reducer — atomic value + cursorOffset updates ─────────────
// Inspired by @inkjs/ui's useTextInputState. Using useReducer avoids
// stale-closure bugs when multiple keystrokes arrive before React
// re-renders (common in fast typing and test harnesses).

interface InputState {
	value: string;
	cursorOffset: number;
	selectionAnchor: number | null;
}

type InputAction =
	| { type: "insert"; text: string }
	| { type: "delete" }
	| { type: "delete-forward" }
	| { type: "move"; dir: "left" | "right" | "home" | "end" | "wordLeft" | "wordRight" | "up" | "down" | "lineHome" | "lineEnd"; select?: boolean }
	| { type: "select-all" }
	| { type: "set-cursor"; offset: number; select?: boolean }
	| { type: "set-value"; value: string; cursorOffset?: number };

/** Compute the destination cursor position for a move direction. */
function computeMoveDest(state: InputState, dir: string): number {
	switch (dir) {
		case "left": return Math.max(0, state.cursorOffset - 1);
		case "right": return Math.min(state.value.length, state.cursorOffset + 1);
		case "home": return 0;
		case "end": return state.value.length;
		case "lineHome": return lineStartOffset(state.value, state.cursorOffset);
		case "lineEnd": return lineEndOffset(state.value, state.cursorOffset);
		case "wordLeft": return wordBoundaryLeft(state.value, state.cursorOffset);
		case "wordRight": return wordBoundaryRight(state.value, state.cursorOffset);
		case "up": {
			const { line, col } = offsetToLineCol(state.value, state.cursorOffset);
			if (line === 0) return state.cursorOffset; // already on first line
			return lineColToOffset(state.value, line - 1, col);
		}
		case "down": {
			const { line, col } = offsetToLineCol(state.value, state.cursorOffset);
			const lineCount = state.value.split("\n").length;
			if (line >= lineCount - 1) return state.cursorOffset; // already on last line
			return lineColToOffset(state.value, line + 1, col);
		}
		default: return state.cursorOffset;
	}
}

/** Delete the selected range and return the resulting state. */
function deleteSelection(state: InputState): InputState {
	const selStart = Math.min(state.selectionAnchor!, state.cursorOffset);
	const selEnd = Math.max(state.selectionAnchor!, state.cursorOffset);
	return {
		value: state.value.slice(0, selStart) + state.value.slice(selEnd),
		cursorOffset: selStart,
		selectionAnchor: null,
	};
}

function inputReducer(state: InputState, action: InputAction): InputState {
	switch (action.type) {
		case "insert": {
			if (state.selectionAnchor !== null) {
				const cleared = deleteSelection(state);
				return {
					value: cleared.value.slice(0, cleared.cursorOffset) + action.text + cleared.value.slice(cleared.cursorOffset),
					cursorOffset: cleared.cursorOffset + action.text.length,
					selectionAnchor: null,
				};
			}
			return {
				value: state.value.slice(0, state.cursorOffset) + action.text + state.value.slice(state.cursorOffset),
				cursorOffset: state.cursorOffset + action.text.length,
				selectionAnchor: null,
			};
		}
		case "delete": {
			if (state.selectionAnchor !== null) return deleteSelection(state);
			if (state.cursorOffset <= 0) return state;
			return {
				value: state.value.slice(0, state.cursorOffset - 1) + state.value.slice(state.cursorOffset),
				cursorOffset: state.cursorOffset - 1,
				selectionAnchor: null,
			};
		}
		case "delete-forward": {
			if (state.selectionAnchor !== null) return deleteSelection(state);
			if (state.cursorOffset >= state.value.length) return state;
			return {
				value: state.value.slice(0, state.cursorOffset) + state.value.slice(state.cursorOffset + 1),
				cursorOffset: state.cursorOffset,
				selectionAnchor: null,
			};
		}
		case "move": {
			const dest = computeMoveDest(state, action.dir);
			if (action.select) {
				return {
					...state,
					cursorOffset: dest,
					selectionAnchor: state.selectionAnchor ?? state.cursorOffset,
				};
			}
			return { ...state, cursorOffset: dest, selectionAnchor: null };
		}
		case "select-all": {
			if (state.value.length === 0) return state;
			return { ...state, selectionAnchor: 0, cursorOffset: state.value.length };
		}
		case "set-cursor": {
			const offset = Math.max(0, Math.min(state.value.length, action.offset));
			if (action.select) {
				return {
					...state,
					cursorOffset: offset,
					selectionAnchor: state.selectionAnchor ?? state.cursorOffset,
				};
			}
			return { ...state, cursorOffset: offset, selectionAnchor: null };
		}
		case "set-value": {
			return {
				value: action.value,
				cursorOffset: action.cursorOffset ?? action.value.length,
				selectionAnchor: null,
			};
		}
	}
}

// ── Command history hook (extracted from legacy src/hooks/useCommands.ts) ──

export function useCommandHistory() {
	const [history, setHistory] = useState<string[]>([]);
	const [cursor, setCursor] = useState<number | null>(null);
	const draftRef = useRef("");

	const addToHistory = useCallback((entry: string) => {
		setHistory((prev) => {
			if (prev[prev.length - 1] === entry) return prev;
			return prev.concat(entry);
		});
		setCursor(null);
		draftRef.current = "";
	}, []);

	const historyUp = useCallback((currentValue: string): string | null => {
		if (history.length === 0) return null;

		if (cursor === null) {
			draftRef.current = currentValue;
			const next = history.length - 1;
			setCursor(next);
			return history[next];
		}

		if (cursor <= 0) return history[0];

		const next = cursor - 1;
		setCursor(next);
		return history[next];
	}, [cursor, history]);

	const historyDown = useCallback((): string | null => {
		if (history.length === 0 || cursor === null) return null;

		if (cursor >= history.length - 1) {
			setCursor(null);
			return draftRef.current;
		}

		const next = cursor + 1;
		setCursor(next);
		return history[next];
	}, [cursor, history]);

	const resetCursor = useCallback(() => {
		setCursor(null);
		draftRef.current = "";
	}, []);

	return { history, addToHistory, historyUp, historyDown, resetCursor };
}

// ── Input component ─────────────────────────────────────────────────

/** Imperative handle for controlling the Input from the parent.
 *  All key handling is done by the central dispatcher in app.tsx
 *  which calls these methods — Input has no useInput of its own. */
export interface InputHandle {
	getValue(): string;
	setValue(value: string): void;
	getCursorPos(): number;
	insertChar(ch: string): void;
	deleteBackward(): void;
	deleteForward(): void;
	moveCursor(direction: "left" | "right" | "home" | "end" | "wordLeft" | "wordRight" | "up" | "down" | "lineHome" | "lineEnd", select?: boolean): void;
	setCursorAt(offset: number, select?: boolean): void;
	selectAll(): void;
	getSelection(): { start: number; end: number; text: string } | null;
	/** Returns layout metrics for converting mouse x to char offset. */
	getLayoutMetrics(): { padLen: number; promptWidth: number; scrollStart: number };
	/** Returns current line info for multiline mode. */
	getLineInfo(): { line: number; col: number; lineCount: number };
	/** Scroll the multiline viewport without moving the cursor. */
	scrollEditor(delta: number): void;
	submit(): void;
	historyUp(): void;
	historyDown(): void;
}

export interface InputProps {
	modeLabel: string;
	modeAccent: string;
	/** Dynamic context path (e.g. "SineGenerator.pitch") shown after mode label */
	contextLabel?: string;
	columns: number;
	disabled?: boolean;
	onSubmit: (value: string) => void;
	/** Enable multiline editing (Enter inserts newline, Ctrl+Enter submits) */
	multiline?: boolean;
	/** Maximum visible lines in multiline mode (default 10) */
	maxLines?: number;
	/** Ghost text to show after cursor (muted color, top completion candidate) */
	ghostText?: string;
	/** The input value that ghostText was computed for (suppresses stale ghost on jitter) */
	ghostForValue?: string;
	/** Called when input value changes (for completion updates) */
	onValueChange?: (value: string, cursorPos: number) => void;
	/** Ref for imperative control */
	inputRef?: React.Ref<InputHandle>;
	/** Tokenizer for syntax highlighting. If provided, input text is rendered
	 *  with per-token colors from TOKEN_COLORS. Falls back to flat foreground.bright. */
	tokenize?: (value: string) => TokenSpan[];
	/** Whether the input has keyboard focus. When true, the prompt char uses brand.signal. */
	focused?: boolean;
}

/** Cursor background: lighten the input bar's raised bg by 30% */
const CURSOR_LIGHTEN = 0.3;

export const Input = React.memo(function Input({
	modeLabel,
	modeAccent,
	columns,
	disabled = false,
	onSubmit,
	contextLabel,
	ghostText,
	ghostForValue,
	onValueChange,
	inputRef,
	tokenize,
	focused = true,
	multiline = false,
	maxLines = 10,
}: InputProps) {
	const { scheme, brand, layout } = useTheme();

	const [state, dispatch] = useReducer(inputReducer, {
		value: "",
		cursorOffset: 0,
		selectionAnchor: null,
	});

	// Multiline: independent scroll offset (null = follow cursor)
	const [editorScroll, setEditorScroll] = useState<number | null>(null);

	const {
		addToHistory,
		historyUp,
		historyDown,
	} = useCommandHistory();

	// Layout metrics ref — updated each render, read by getLayoutMetrics()
	const layoutRef = useRef({ padLen: 0, promptWidth: 0, scrollStart: 0 });

	// Notify parent of value changes via useEffect (replaces queueMicrotask).
	const prevValueRef = useRef(state.value);
	useEffect(() => {
		if (state.value !== prevValueRef.current) {
			prevValueRef.current = state.value;
			onValueChange?.(state.value, state.cursorOffset);
		}
	}, [state.value, state.cursorOffset, onValueChange]);

	// Reset independent scroll when cursor moves (keyboard snaps viewport to cursor)
	const prevCursorRef = useRef(state.cursorOffset);
	useEffect(() => {
		if (state.cursorOffset !== prevCursorRef.current) {
			prevCursorRef.current = state.cursorOffset;
			if (editorScroll !== null) setEditorScroll(null);
		}
	}, [state.cursorOffset, editorScroll]);

	// Expose imperative handle for all key handling. The central
	// dispatcher in app.tsx calls these methods — Input has no
	// useInput of its own (single-action-per-keystroke by design).
	useImperativeHandle(inputRef, () => ({
		getValue: () => state.value,
		setValue: (v: string) => dispatch({ type: "set-value", value: v }),
		getCursorPos: () => state.cursorOffset,
		insertChar: (ch: string) => dispatch({ type: "insert", text: ch }),
		deleteBackward: () => dispatch({ type: "delete" }),
		deleteForward: () => dispatch({ type: "delete-forward" }),
		moveCursor: (dir: "left" | "right" | "home" | "end" | "wordLeft" | "wordRight" | "up" | "down" | "lineHome" | "lineEnd", select?: boolean) => {
			dispatch({ type: "move", dir, select });
		},
		setCursorAt: (offset: number, select?: boolean) => {
			dispatch({ type: "set-cursor", offset, select });
		},
		selectAll: () => dispatch({ type: "select-all" }),
		getLayoutMetrics: () => layoutRef.current,
		getLineInfo: () => {
			const { line, col } = offsetToLineCol(state.value, state.cursorOffset);
			return { line, col, lineCount: state.value.split("\n").length };
		},
		scrollEditor: (delta: number) => {
			const lineCount = state.value.split("\n").length;
			if (lineCount <= maxLines) return;
			const maxScroll = lineCount - maxLines;
			setEditorScroll((prev) => {
				const current = prev ?? Math.max(0, Math.min(
					offsetToLineCol(state.value, state.cursorOffset).line - Math.floor(maxLines * 0.5),
					maxScroll,
				));
				return Math.max(0, Math.min(maxScroll, current + delta));
			});
		},
		getSelection: () => {
			if (state.selectionAnchor === null) return null;
			const start = Math.min(state.selectionAnchor, state.cursorOffset);
			const end = Math.max(state.selectionAnchor, state.cursorOffset);
			if (start === end) return null;
			return { start, end, text: state.value.slice(start, end) };
		},
		submit: () => {
			const trimmed = state.value.trim();
			if (!trimmed || disabled) return;
			addToHistory(trimmed);
			onSubmit(trimmed);
			dispatch({ type: "set-value", value: "", cursorOffset: 0 });
		},
		historyUp: () => {
			const prev = historyUp(state.value);
			if (prev !== null) {
				dispatch({ type: "set-value", value: prev });
			}
		},
		historyDown: () => {
			const next = historyDown();
			if (next !== null) {
				dispatch({ type: "set-value", value: next });
			}
		},
	}), [state.value, state.cursorOffset, state.selectionAnchor, disabled, addToHistory, onSubmit, historyUp, historyDown]);

	// ── Rendering ──────────────────────────────────────────────────

	const pad = " ".repeat(layout.horizontalPad);
	const isRoot = modeLabel === "root";
	const promptColor = focused ? brand.signal : scheme.foreground.muted;
	const contextSuffix = contextLabel ? ` ${contextLabel}` : "";
	const promptPrefix = isRoot ? "" : `[${modeLabel}]${contextSuffix} `;
	const promptChar = "> ";
	const promptWidth = promptPrefix.length + promptChar.length;

	// Maximum characters available for value + cursor + ghost
	const maxInputWidth = Math.max(0, columns - promptWidth - pad.length * 2);

	// Ghost text only shown when cursor is at end of input AND the ghost
	// was computed for the current value (prevents one-frame jitter on typing).
	const atEnd = state.cursorOffset >= state.value.length;
	const ghostValid = !ghostForValue || ghostForValue === state.value;
	const hasSelection = state.selectionAnchor !== null && state.selectionAnchor !== state.cursorOffset;
	const ghost = (atEnd && ghostText && ghostValid && !hasSelection) ? ghostText : "";

	// ── Scroll window — keep cursor visible when value exceeds width ──
	const totalChars = state.value.length + 1; // +1 for the cursor slot
	let scrollStart = 0;
	if (totalChars > maxInputWidth) {
		scrollStart = Math.max(0, Math.min(
			state.cursorOffset - Math.floor(maxInputWidth * 0.7),
			totalChars - maxInputWidth,
		));
	}
	const relCursorPos = state.cursorOffset - scrollStart;
	layoutRef.current = { padLen: pad.length, promptWidth, scrollStart };

	// Cursor colors
	const cursorBg = lightenHex(scheme.backgrounds.raised, CURSOR_LIGHTEN);

	// ── Build rendered spans (highlighted or plain) ────────────────
	// Tokenize → slice to scroll window → split at cursor → render

	let beforeSpans: TokenSpan[];
	let cursorChar: string;
	let cursorTokenColor: string;
	let afterSpans: TokenSpan[];

	if (tokenize && state.value.length > 0) {
		// Highlighted path: tokenize full value, slice to visible window, split at cursor
		const allSpans = tokenize(state.value);
		const visibleSpans = sliceSpans(allSpans, scrollStart, maxInputWidth);
		const split = splitSpansAtCursor(visibleSpans, relCursorPos);
		beforeSpans = split.before;
		afterSpans = split.after;

		if (atEnd) {
			cursorChar = ghost.length > 0 ? ghost[0]! : " ";
			cursorTokenColor = (ghost.length > 0)
				? scheme.foreground.default  // ghost char under cursor
				: scheme.foreground.bright;  // empty space
		} else {
			cursorChar = split.cursorChar;
			cursorTokenColor = TOKEN_COLORS[split.cursorToken];
		}
	} else {
		// Plain path: no tokenizer, flat foreground.bright
		const visibleValue = state.value.slice(scrollStart, scrollStart + maxInputWidth);
		const beforeText = visibleValue.slice(0, relCursorPos);
		const afterText = atEnd ? "" : visibleValue.slice(relCursorPos + 1);
		beforeSpans = beforeText ? [{ text: beforeText, token: "plain" as const }] : [];
		afterSpans = afterText ? [{ text: afterText, token: "plain" as const }] : [];

		cursorChar = atEnd
			? (ghost.length > 0 ? ghost[0]! : " ")
			: visibleValue[relCursorPos] ?? " ";
		cursorTokenColor = (atEnd && ghost.length > 0)
			? scheme.foreground.default
			: scheme.foreground.bright;
	}

	// Ghost text after cursor (skip first char if at end — shown as cursorChar)
	const beforeLen = beforeSpans.reduce((sum, s) => sum + s.text.length, 0);
	const afterLen = afterSpans.reduce((sum, s) => sum + s.text.length, 0);
	const remainingGhost = atEnd ? ghost.slice(1) : "";
	const ghostSpace = Math.max(0, maxInputWidth - beforeLen - 1 - afterLen);
	const displayGhost = remainingGhost.slice(0, ghostSpace);

	// ── Selection segments ────────────────────────────────────────
	// Split before/after spans at selection boundary for highlight rendering.
	const selectionBg = hasSelection ? lerpHex(scheme.backgrounds.raised, scheme.foreground.bright, 0.5) : undefined;
	let seg1 = beforeSpans;      // before selection (normal)
	let seg2: TokenSpan[] = [];   // selected before cursor
	let seg4: TokenSpan[] = [];   // selected after cursor
	let seg5 = afterSpans;       // after selection (normal)

	if (hasSelection) {
		const absSelStart = Math.min(state.selectionAnchor!, state.cursorOffset);
		const absSelEnd = Math.max(state.selectionAnchor!, state.cursorOffset);
		const relSelStart = Math.max(0, absSelStart - scrollStart);
		const relSelEnd = Math.min(maxInputWidth, absSelEnd - scrollStart);

		if (state.selectionAnchor! < state.cursorOffset) {
			// Selection extends left of cursor
			seg1 = sliceSpans(beforeSpans, 0, relSelStart);
			seg2 = sliceSpans(beforeSpans, relSelStart, relCursorPos - relSelStart);
		} else {
			// Selection extends right of cursor
			const selWidth = Math.max(0, relSelEnd - relCursorPos - 1);
			seg4 = sliceSpans(afterSpans, 0, selWidth);
			seg5 = sliceSpans(afterSpans, selWidth, afterLen - selWidth);
		}
	}

	// Right padding to fill the row (separate calculation for disabled state
	// to avoid overflow — "waiting for response..." has a different width than
	// the value-based spans, and during async commands the value is already cleared)
	const waitingText = "waiting for response...";
	const normalContentWidth = promptWidth + beforeLen + 1 + afterLen + displayGhost.length;
	const disabledContentWidth = promptWidth + waitingText.length;
	const activeContentWidth = disabled ? disabledContentWidth : normalContentWidth;
	const inputPadRight = Math.max(0, columns - pad.length * 2 - activeContentWidth);

	// Helper: render a TokenSpan[] as colored <Text> elements
	const renderSpans = (spans: TokenSpan[], keyPrefix: string, bg?: string) =>
		spans.map((span, i) => (
			<Text key={`${keyPrefix}-${i}`} color={tokenize ? TOKEN_COLORS[span.token] : scheme.foreground.bright} backgroundColor={bg}>
				{span.text}
			</Text>
		));

	// ── Multiline render path ──────────────────────────────────────
	// Fixed-height editor: always renders maxLines rows (like a textarea).
	// Content is scrolled within that fixed region.
	// Mode map: always computed (hooks can't be conditional), only used in multiline
	const modeMap = useMemo(
		() => multiline ? buildModeMap(state.value.split("\n")) : [],
		[state.value, multiline],
	);

	if (multiline) {
		const lines = state.value.split("\n");
		const { line: cursorLine, col: cursorCol } = offsetToLineCol(state.value, state.cursorOffset);
		const lineCount = lines.length;

		// Vertical scroll: use independent scroll if set (mouse wheel),
		// otherwise follow cursor
		let vScrollStart = 0;
		if (lineCount > maxLines) {
			if (editorScroll !== null) {
				vScrollStart = editorScroll;
			} else {
				vScrollStart = Math.max(0, Math.min(
					cursorLine - Math.floor(maxLines * 0.5),
					lineCount - maxLines,
				));
			}
		}

		// Scrollbar
		const showScrollbar = lineCount > maxLines;
		const scrollbarWidth = showScrollbar ? 1 : 0;
		const scrollThumbPos = showScrollbar
			? Math.round((vScrollStart / Math.max(1, lineCount - maxLines)) * (maxLines - 1))
			: -1;

		// Layout widths
		const maxLineNum = Math.max(lineCount, maxLines);
		const lineNumberWidth = String(maxLineNum).length;
		const gutterWidth = pad.length + lineNumberWidth + 1 + 1 + 1; // +1 indicator +1 space
		const bodyWidth = columns - pad.length * 2 - gutterWidth - scrollbarWidth;
		const emptyRowWidth = columns - pad.length * 2; // for rows past content

		// Build all rows as one <Text> block with \n separators.
		// Always exactly maxLines rows.
		const gutterBg = darkenHex(scheme.backgrounds.raised, 0.9);
		const elements: React.ReactNode[] = [];

		for (let row = 0; row < maxLines; row++) {
			if (row > 0) elements.push("\n");

			const lineIdx = vScrollStart + row;
			const scrollChar = showScrollbar
				? (row === scrollThumbPos ? "\u2588" : "\u2502")
				: "";

			// Past content: render empty row with gutter
			if (lineIdx >= lineCount) {
				const emptyGutter = " ".repeat(pad.length + lineNumberWidth + 1 + 1); // linenum + indicator
				const emptyFill = " ".repeat(bodyWidth + 1); // +1 for separator space
				elements.push(
					<Text key={`e${row}`} backgroundColor={gutterBg}>
						{emptyGutter}
					</Text>,
					<Text key={`ef${row}`}>
						{emptyFill}
						<Text color={scheme.foreground.muted}>{scrollChar}</Text>
						{pad}
					</Text>,
				);
				continue;
			}

			const lineText = lines[lineIdx]!;
			const lineNum = String(lineIdx + 1).padStart(lineNumberWidth, " ");
			const isCursorLine = lineIdx === cursorLine;

			// Gutter: line number + mode indicator
			const gutterColor = isCursorLine ? brand.signal : scheme.foreground.muted;
			const modeEntry = modeMap[lineIdx];
			let modeIndicator = " ";
			let indicatorColor = scheme.foreground.muted;
			if (modeEntry && modeEntry.modeId !== "root") {
				indicatorColor = modeEntry.accent;
				modeIndicator = "\u2595";
			}
			elements.push(
				<Text key={`g${lineIdx}`} color={gutterColor} backgroundColor={gutterBg}>{pad}{lineNum}</Text>,
				<Text key={`gi${lineIdx}`} color={indicatorColor} backgroundColor={gutterBg}>{modeIndicator}</Text>,
				<Text key={`gs${lineIdx}`}> </Text>,
			);

			// Compute flat offset range for this line
			const lineOffset = lineColToOffset(state.value, lineIdx, 0);

			// Selection range overlap with this line
			const selBg = hasSelection ? lerpHex(scheme.backgrounds.raised, scheme.foreground.bright, 0.5) : undefined;
			const selStart = hasSelection ? Math.min(state.selectionAnchor!, state.cursorOffset) : -1;
			const selEnd = hasSelection ? Math.max(state.selectionAnchor!, state.cursorOffset) : -1;
			// Selection range within this line (relative to line start)
			const lineSelStart = hasSelection ? Math.max(0, selStart - lineOffset) : -1;
			const lineSelEnd = hasSelection ? Math.min(lineText.length, selEnd - lineOffset) : -1;
			const lineHasSelection = hasSelection && lineSelStart < lineSelEnd && lineSelStart < lineText.length;

			// Helper: push a text segment, splitting by selection if needed
			const pushSegment = (text: string, startCol: number, color: string, keyBase: string) => {
				if (!lineHasSelection || text.length === 0) {
					elements.push(<Text key={keyBase} color={color}>{text}</Text>);
					return;
				}
				// Split text into before-sel, in-sel, after-sel
				const segStart = startCol;
				const segEnd = startCol + text.length;
				const overlapStart = Math.max(segStart, lineSelStart) - segStart;
				const overlapEnd = Math.min(segEnd, lineSelEnd) - segStart;
				if (overlapStart >= overlapEnd) {
					// No overlap
					elements.push(<Text key={keyBase} color={color}>{text}</Text>);
					return;
				}
				if (overlapStart > 0) {
					elements.push(<Text key={`${keyBase}p`} color={color}>{text.slice(0, overlapStart)}</Text>);
				}
				elements.push(<Text key={`${keyBase}s`} color={color} backgroundColor={selBg}>{text.slice(overlapStart, overlapEnd)}</Text>);
				if (overlapEnd < text.length) {
					elements.push(<Text key={`${keyBase}q`} color={color}>{text.slice(overlapEnd)}</Text>);
				}
			};

			// Per-line tokenizer from mode map
			const lineTokenizer = modeEntry ? tokenizerForLine(modeEntry, lineText) : tokenize;

			if (isCursorLine && !disabled) {
				if (lineTokenizer && lineText.length > 0) {
					const spans = lineTokenizer(lineText);
					const split = splitSpansAtCursor(spans, cursorCol);
					let col = 0;
					for (let j = 0; j < split.before.length; j++) {
						const s = split.before[j]!;
						pushSegment(s.text, col, TOKEN_COLORS[s.token], `${lineIdx}b${j}`);
						col += s.text.length;
					}
					// Cursor char — check if it's in selection
					const cursorInSel = lineHasSelection && cursorCol >= lineSelStart && cursorCol < lineSelEnd;
					elements.push(
						<Text key={`${lineIdx}c`} color={TOKEN_COLORS[split.cursorToken]} backgroundColor={cursorInSel ? selBg : cursorBg}>
							{cursorCol < lineText.length ? split.cursorChar : " "}
						</Text>,
					);
					col = cursorCol + 1;
					for (let j = 0; j < split.after.length; j++) {
						const s = split.after[j]!;
						pushSegment(s.text, col, TOKEN_COLORS[s.token], `${lineIdx}a${j}`);
						col += s.text.length;
					}
				} else {
					const before = lineText.slice(0, cursorCol);
					const after = lineText.slice(cursorCol + 1);
					const cc = cursorCol < lineText.length ? lineText[cursorCol]! : " ";
					if (before) pushSegment(before, 0, scheme.foreground.bright, `${lineIdx}bt`);
					const cursorInSel = lineHasSelection && cursorCol >= lineSelStart && cursorCol < lineSelEnd;
					elements.push(<Text key={`${lineIdx}c`} color={scheme.foreground.bright} backgroundColor={cursorInSel ? selBg : cursorBg}>{cc}</Text>);
					if (after) pushSegment(after, cursorCol + 1, scheme.foreground.bright, `${lineIdx}at`);
				}
				const cursorExtra = cursorCol >= lineText.length ? 1 : 0;
				const fill = Math.max(0, bodyWidth - lineText.length - cursorExtra);
				elements.push(<Text key={`${lineIdx}f`}>{" ".repeat(fill)}<Text color={scheme.foreground.muted}>{scrollChar}</Text>{pad}</Text>);
			} else {
				if (lineTokenizer && lineText.length > 0) {
					const spans = lineTokenizer(lineText);
					let col = 0;
					for (let j = 0; j < spans.length; j++) {
						const s = spans[j]!;
						pushSegment(s.text, col, TOKEN_COLORS[s.token], `${lineIdx}s${j}`);
						col += s.text.length;
					}
				} else if (lineText) {
					pushSegment(lineText, 0, scheme.foreground.bright, `${lineIdx}t`);
				}
				const fill = Math.max(0, bodyWidth - lineText.length);
				elements.push(<Text key={`${lineIdx}f`}>{" ".repeat(fill)}<Text color={scheme.foreground.muted}>{scrollChar}</Text>{pad}</Text>);
			}
		}

		return (
			<Box flexDirection="column">
				<Text backgroundColor={scheme.backgrounds.raised}>
					{" ".repeat(columns)}{"\n"}{elements}{"\n"}{" ".repeat(columns)}
				</Text>
			</Box>
		);
	}

	// ── Single-line render path (unchanged) ────────────────────────
	return (
		<Box flexDirection="column">
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
			<Box>
				<Text backgroundColor={scheme.backgrounds.raised}>
					<Text>{pad}</Text>
					{!isRoot ? (
						<>
							<Text color={scheme.foreground.muted}>[{modeLabel}]</Text>
							{contextLabel ? (
								<Text color={scheme.foreground.default}> {contextLabel}</Text>
							) : null}
							<Text color={scheme.foreground.muted}> </Text>
						</>
					) : null}
					<Text color={promptColor} bold>{promptChar}</Text>
				{disabled ? (
					<Text color={scheme.foreground.muted}>{waitingText}</Text>
				) : (
					<>
						{renderSpans(seg1, "b")}
						{seg2.length > 0 && renderSpans(seg2, "sb", selectionBg)}
						<Text color={cursorTokenColor} backgroundColor={cursorBg}>{cursorChar}</Text>
						{seg4.length > 0 && renderSpans(seg4, "sa", selectionBg)}
						{renderSpans(seg5, "a")}
						{displayGhost ? (
							<Text color={scheme.foreground.muted}>{displayGhost}</Text>
						) : null}
					</>
				)}
					<Text>{" ".repeat(inputPadRight)}</Text>
					<Text>{pad}</Text>
				</Text>
			</Box>
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
		</Box>
	);
});
