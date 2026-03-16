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
	columns: number;
	disabled?: boolean;
	onSubmit: (value: string) => void;
	/** Ghost text to show after cursor (muted color, top completion candidate) */
	ghostText?: string;
	/** Called when input value changes (for completion updates) */
	onValueChange?: (value: string, cursorPos: number) => void;
	/** Called when Tab is pressed (trigger/accept completion) */
	onTab?: () => void;
	/** When true, up/down arrows are reserved for popup navigation (skip history) */
	completionVisible?: boolean;
	/** Ref for imperative control */
	inputRef?: React.Ref<InputHandle>;
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
	ghostText,
	onValueChange,
	onTab,
	completionVisible = false,
	inputRef,
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

		if (key.escape) return;

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
	const promptPrefix = isRoot ? "" : `[${modeLabel}] `;
	const promptChar = "> ";
	const promptWidth = promptPrefix.length + promptChar.length;

	// Maximum characters available for value + cursor + ghost
	const maxInputWidth = Math.max(0, columns - promptWidth - PAD.length * 2);

	// Ghost text only shown when cursor is at end of input
	const atEnd = state.cursorOffset >= state.value.length;
	const ghost = (atEnd && ghostText) ? ghostText : "";

	// ── Scroll window — keep cursor visible when value exceeds width ──
	const totalChars = state.value.length + 1; // +1 for the cursor slot
	let scrollStart = 0;
	if (totalChars > maxInputWidth) {
		scrollStart = Math.max(0, Math.min(
			state.cursorOffset - Math.floor(maxInputWidth * 0.7),
			totalChars - maxInputWidth,
		));
	}
	const visibleValue = state.value.slice(scrollStart, scrollStart + maxInputWidth);
	const relCursorPos = state.cursorOffset - scrollStart;

	// Split around cursor
	const beforeCursor = visibleValue.slice(0, relCursorPos);
	const afterCursor = atEnd ? "" : visibleValue.slice(relCursorPos + 1);

	// Character under the cursor
	const cursorChar = atEnd
		? (ghost.length > 0 ? ghost[0]! : " ")
		: visibleValue[relCursorPos] ?? " ";

	// Ghost text after cursor (skip first char if at end — shown as cursorChar)
	const remainingGhost = atEnd ? ghost.slice(1) : "";
	const ghostSpace = Math.max(0, maxInputWidth - beforeCursor.length - 1 - afterCursor.length);
	const displayGhost = remainingGhost.slice(0, ghostSpace);

	// Cursor colors
	const cursorBg = lightenHex(scheme.backgrounds.raised, CURSOR_LIGHTEN);
	const cursorTextColor = (atEnd && ghost.length > 0)
		? scheme.foreground.muted     // ghost char under cursor
		: scheme.foreground.bright;   // real char or empty space

	// Right padding to fill the row
	const contentWidth = promptWidth + beforeCursor.length + 1 + afterCursor.length + displayGhost.length;
	const inputPadRight = Math.max(0, columns - PAD.length * 2 - contentWidth);

	return (
		<Box flexDirection="column">
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
			<Box>
				<Text backgroundColor={scheme.backgrounds.raised}>
					<Text>{PAD}</Text>
					{promptPrefix ? (
						<Text color={scheme.foreground.muted}>{promptPrefix}</Text>
					) : null}
					<Text color={promptColor} bold>{promptChar}</Text>
				{disabled ? (
					<Text color={scheme.foreground.muted}>waiting for response...</Text>
				) : (
					<>
						<Text color={scheme.foreground.bright}>{beforeCursor}</Text>
						<Text color={cursorTextColor} backgroundColor={cursorBg}>{cursorChar}</Text>
						{afterCursor ? (
							<Text color={scheme.foreground.bright}>{afterCursor}</Text>
						) : null}
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
