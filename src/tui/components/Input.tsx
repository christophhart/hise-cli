// ── Input — mode-colored prompt with cursor navigation + command history ──

import React, {
	useCallback,
	useEffect,
	useImperativeHandle,
	useReducer,
	useRef,
	useState,
} from "react";
import { appendFileSync } from "node:fs";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme-context.js";
import { lightenHex } from "../theme.js";
import type { TokenSpan } from "../../engine/highlight/tokens.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";
import { sliceSpans, splitSpansAtCursor } from "../../engine/highlight/split.js";

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

// ── Input reducer — atomic value + cursorOffset updates ─────────────
// Inspired by @inkjs/ui's useTextInputState. Using useReducer avoids
// stale-closure bugs when multiple keystrokes arrive before React
// re-renders (common in fast typing and test harnesses).

interface InputState {
	value: string;
	cursorOffset: number;
}

type InputAction =
	| { type: "insert"; text: string }
	| { type: "delete" }
	| { type: "delete-forward" }
	| { type: "move-left" }
	| { type: "move-right" }
	| { type: "move-start" }
	| { type: "move-end" }
	| { type: "move-word-left" }
	| { type: "move-word-right" }
	| { type: "set-value"; value: string; cursorOffset?: number };

function inputReducer(state: InputState, action: InputAction): InputState {
	switch (action.type) {
		case "insert": {
			return {
				value:
					state.value.slice(0, state.cursorOffset) +
					action.text +
					state.value.slice(state.cursorOffset),
				cursorOffset: state.cursorOffset + action.text.length,
			};
		}
		case "delete": {
			if (state.cursorOffset <= 0) return state;
			return {
				value:
					state.value.slice(0, state.cursorOffset - 1) +
					state.value.slice(state.cursorOffset),
				cursorOffset: state.cursorOffset - 1,
			};
		}
		case "delete-forward": {
			if (state.cursorOffset >= state.value.length) return state;
			return {
				value:
					state.value.slice(0, state.cursorOffset) +
					state.value.slice(state.cursorOffset + 1),
				cursorOffset: state.cursorOffset,
			};
		}
		case "move-left": {
			return {
				...state,
				cursorOffset: Math.max(0, state.cursorOffset - 1),
			};
		}
		case "move-right": {
			return {
				...state,
				cursorOffset: Math.min(state.value.length, state.cursorOffset + 1),
			};
		}
		case "move-start": {
			return { ...state, cursorOffset: 0 };
		}
		case "move-end": {
			return { ...state, cursorOffset: state.value.length };
		}
		case "move-word-left": {
			return {
				...state,
				cursorOffset: wordBoundaryLeft(state.value, state.cursorOffset),
			};
		}
		case "move-word-right": {
			return {
				...state,
				cursorOffset: wordBoundaryRight(state.value, state.cursorOffset),
			};
		}
		case "set-value": {
			return {
				value: action.value,
				cursorOffset: action.cursorOffset ?? action.value.length,
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

/** Imperative handle for controlling the Input from the parent */
export interface InputHandle {
	getValue(): string;
	setValue(value: string): void;
	getCursorPos(): number;
}

export interface InputProps {
	modeLabel: string;
	modeAccent: string;
	/** Dynamic context path (e.g. "SineGenerator.pitch") shown after mode label */
	contextLabel?: string;
	columns: number;
	disabled?: boolean;
	onSubmit: (value: string) => void;
	/** Ghost text to show after cursor (muted color, top completion candidate) */
	ghostText?: string;
	/** The input value that ghostText was computed for (suppresses stale ghost on jitter) */
	ghostForValue?: string;
	/** Called when input value changes (for completion updates) */
	onValueChange?: (value: string, cursorPos: number) => void;
	/** Called when Tab is pressed (trigger/accept completion) */
	onTab?: () => void;
	/** Called when Escape is pressed (toggle completion popup) */
	onEscape?: () => void;
	/** When true, up/down arrows are reserved for popup navigation (skip history) */
	completionVisible?: boolean;
	/** Ref for imperative control */
	inputRef?: React.Ref<InputHandle>;
	/** Tokenizer for syntax highlighting. If provided, input text is rendered
	 *  with per-token colors from TOKEN_COLORS. Falls back to flat foreground.bright. */
	tokenize?: (value: string) => TokenSpan[];
}

/** Flip to true + rebuild to log every keypress to debug-keys.log. */
const DEBUG_KEYS = false;

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
	onTab,
	onEscape,
	completionVisible = false,
	inputRef,
	tokenize,
}: InputProps) {
	const { scheme } = useTheme();

	const [state, dispatch] = useReducer(inputReducer, {
		value: "",
		cursorOffset: 0,
	});

	const {
		addToHistory,
		historyUp,
		historyDown,
	} = useCommandHistory();

	// Notify parent of value changes via useEffect (replaces queueMicrotask).
	const prevValueRef = useRef(state.value);
	useEffect(() => {
		if (state.value !== prevValueRef.current) {
			prevValueRef.current = state.value;
			onValueChange?.(state.value, state.cursorOffset);
		}
	}, [state.value, state.cursorOffset, onValueChange]);

	// Expose imperative handle for parent to read/set value
	useImperativeHandle(inputRef, () => ({
		getValue: () => state.value,
		setValue: (v: string) => dispatch({ type: "set-value", value: v }),
		getCursorPos: () => state.cursorOffset,
	}), [state.value, state.cursorOffset]);

	const handleSubmit = useCallback(() => {
		const trimmed = state.value.trim();
		if (!trimmed || disabled) return;

		addToHistory(trimmed);
		onSubmit(trimmed);
		dispatch({ type: "set-value", value: "", cursorOffset: 0 });
	}, [state.value, disabled, addToHistory, onSubmit]);

	// Regex to detect mouse escape sequence remnants. Ink's useInput strips
	// the leading \x1b from unrecognized CSI sequences, so mouse events
	// arrive as input strings like "[<64;15;10M" or "[<0;15;10m".
	const MOUSE_SEQ_RE = /^\[?<\d+;\d+;\d+[Mm]$/;

	useInput((input, key) => {
		// ── Key debug logging (flip DEBUG_KEYS to true + rebuild) ──
		if (DEBUG_KEYS) {
			const flags = Object.entries(key)
				.filter(([, v]) => v === true)
				.map(([k]) => k)
				.join(" ");
			const hex = [...input].map(c =>
				"0x" + c.charCodeAt(0).toString(16).padStart(2, "0"),
			).join(" ");
			appendFileSync("debug-keys.log",
				`${input || "·"} (${hex || "empty"}) ${flags}\n`);
		}

		if (disabled) return;

		if (key.escape) {
			onEscape?.();
			return;
		}

		if (key.return) {
			handleSubmit();
			return;
		}

		// Shift+arrows are used for output scrolling in the App component
		if (key.shift && (key.upArrow || key.downArrow)) {
			return;
		}

		// ── Meta+Arrow — jump to start/end of line ─────────────
		if (key.meta && key.leftArrow) {
			dispatch({ type: "move-start" });
			return;
		}
		if (key.meta && key.rightArrow) {
			dispatch({ type: "move-end" });
			return;
		}

		// ── Option+Left/Right — word boundary jump ─────────────
		// macOS Terminal sends ESC+b / ESC+f for Option+Left/Right.
		// Ink delivers these as key.meta=true with input "b" or "f".
		if (key.meta && input === "b") {
			dispatch({ type: "move-word-left" });
			return;
		}
		if (key.meta && input === "f") {
			dispatch({ type: "move-word-right" });
			return;
		}

		// ── Ctrl+A / Ctrl+E — start/end of line (readline style) ──
		// Ghostty sends Ctrl+A for fn+Left and Ctrl+E for fn+Right.
		if (key.ctrl && input === "a") {
			dispatch({ type: "move-start" });
			return;
		}
		if (key.ctrl && input === "e") {
			dispatch({ type: "move-end" });
			return;
		}

		// ── Home / End — start/end of line ─────────────────────
		if (key.home) {
			dispatch({ type: "move-start" });
			return;
		}
		if (key.end) {
			dispatch({ type: "move-end" });
			return;
		}

		// ── Up/Down — history navigation (gated by completion popup) ──
		if (key.upArrow) {
			if (!completionVisible) {
				const prev = historyUp(state.value);
				if (prev !== null) {
					dispatch({ type: "set-value", value: prev });
				}
			}
			return;
		}
		if (key.downArrow) {
			if (!completionVisible) {
				const next = historyDown();
				if (next !== null) {
					dispatch({ type: "set-value", value: next });
				}
			}
			return;
		}

		// ── Left/Right — single character cursor movement ──────
		if (key.leftArrow) {
			dispatch({ type: "move-left" });
			return;
		}
		if (key.rightArrow) {
			dispatch({ type: "move-right" });
			return;
		}

		// ── Backspace / Delete — delete character before cursor ────
		// Ink maps macOS Backspace (\x7f) to key.delete (not key.backspace).
		// Ctrl+H (\x08) maps to key.backspace. Both should backward-delete.
		// Forward-delete (fn+Backspace) also fires key.delete — Ink can't
		// distinguish them, so we treat both as backward-delete.
		if (key.backspace || key.delete) {
			dispatch({ type: "delete" });
			return;
		}

		// ── PgUp/PgDn — passed through to App for output scrolling ──
		if (key.pageUp || key.pageDown) {
			return;
		}

		// ── Tab — trigger completion ───────────────────────────
		if (key.tab) {
			if (onTab) onTab();
			return;
		}

		// ── Regular character input — insert at cursor ─────────
		if (input && !key.ctrl && !key.meta) {
			// Reject control characters
			const code = input.charCodeAt(0);
			if (code < 0x20 || code === 0x7f) return;

			// Filter mouse escape sequences
			if (MOUSE_SEQ_RE.test(input)) return;

			dispatch({ type: "insert", text: input });
		}
	});

	// ── Rendering ──────────────────────────────────────────────────

	const PAD = "  "; // 2 chars horizontal padding
	const isRoot = modeLabel === "root";
	const promptColor = isRoot ? scheme.foreground.default : modeAccent;
	const contextSuffix = contextLabel ? ` ${contextLabel}` : "";
	const promptPrefix = isRoot ? "" : `[${modeLabel}]${contextSuffix} `;
	const promptChar = "> ";
	const promptWidth = promptPrefix.length + promptChar.length;

	// Maximum characters available for value + cursor + ghost
	const maxInputWidth = Math.max(0, columns - promptWidth - PAD.length * 2);

	// Ghost text only shown when cursor is at end of input AND the ghost
	// was computed for the current value (prevents one-frame jitter on typing).
	const atEnd = state.cursorOffset >= state.value.length;
	const ghostValid = !ghostForValue || ghostForValue === state.value;
	const ghost = (atEnd && ghostText && ghostValid) ? ghostText : "";

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

	// Right padding to fill the row
	const contentWidth = promptWidth + beforeLen + 1 + afterLen + displayGhost.length;
	const inputPadRight = Math.max(0, columns - PAD.length * 2 - contentWidth);

	// Helper: render a TokenSpan[] as colored <Text> elements
	const renderSpans = (spans: TokenSpan[], keyPrefix: string) =>
		spans.map((span, i) => (
			<Text key={`${keyPrefix}-${i}`} color={tokenize ? TOKEN_COLORS[span.token] : scheme.foreground.bright}>
				{span.text}
			</Text>
		));

	return (
		<Box flexDirection="column">
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
			<Box>
				<Text backgroundColor={scheme.backgrounds.raised}>
					<Text>{PAD}</Text>
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
					<Text color={scheme.foreground.muted}>waiting for response...</Text>
				) : (
					<>
						{renderSpans(beforeSpans, "b")}
						<Text color={cursorTokenColor} backgroundColor={cursorBg}>{cursorChar}</Text>
						{renderSpans(afterSpans, "a")}
						{displayGhost ? (
							<Text color={scheme.foreground.muted}>{displayGhost}</Text>
						) : null}
					</>
				)}
					<Text>{" ".repeat(inputPadRight)}</Text>
					<Text>{PAD}</Text>
				</Text>
			</Box>
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
		</Box>
	);
});
