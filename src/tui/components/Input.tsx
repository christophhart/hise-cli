// ── Input — mode-colored prompt with command history ─────────────────

import React, { useCallback, useImperativeHandle, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ColorScheme } from "../theme.js";

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
}

export interface InputProps {
	modeLabel: string;
	modeAccent: string;
	scheme: ColorScheme;
	columns: number;
	disabled?: boolean;
	onSubmit: (value: string) => void;
	/** Ghost text to show after cursor (muted color, top completion candidate) */
	ghostText?: string;
	/** Called when input value changes (for completion updates) */
	onValueChange?: (value: string) => void;
	/** Called when Tab is pressed (trigger/accept completion) */
	onTab?: () => void;
	/** Ref for imperative control */
	inputRef?: React.Ref<InputHandle>;
}

export const Input = React.memo(function Input({
	modeLabel,
	modeAccent,
	scheme,
	columns,
	disabled = false,
	onSubmit,
	ghostText,
	onValueChange,
	onTab,
	inputRef,
}: InputProps) {
	const [value, setValue] = useState("");
	const {
		addToHistory,
		historyUp,
		historyDown,
	} = useCommandHistory();

	// Wrapper that also notifies parent of value changes
	const updateValue = useCallback((newValue: string | ((prev: string) => string)) => {
		setValue((prev) => {
			const next = typeof newValue === "function" ? newValue(prev) : newValue;
			if (next !== prev && onValueChange) {
				// Schedule callback after state update
				queueMicrotask(() => onValueChange(next));
			}
			return next;
		});
	}, [onValueChange]);

	// Expose imperative handle for parent to read/set value
	useImperativeHandle(inputRef, () => ({
		getValue: () => value,
		setValue: (v: string) => updateValue(v),
	}), [value, updateValue]);

	const handleSubmit = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;

		addToHistory(trimmed);
		onSubmit(trimmed);
		updateValue("");
	}, [value, disabled, addToHistory, onSubmit, updateValue]);

	// Regex to detect mouse escape sequence remnants. Ink's useInput strips
	// the leading \x1b from unrecognized CSI sequences, so mouse events
	// arrive as input strings like "[<64;15;10M" or "[<0;15;10m".
	// We also match the full form in case the escape isn't stripped.
	const MOUSE_SEQ_RE = /^\[?<\d+;\d+;\d+[Mm]$/;

	useInput((input, key) => {
		if (disabled) return;

		if (key.escape) return;

		if (key.return) {
			handleSubmit();
			return;
		}

		// Shift+arrows are used for scrolling in the App component
		if (key.shift && (key.upArrow || key.downArrow)) {
			return;
		}

		if (key.upArrow) {
			const prev = historyUp(value);
			if (prev !== null) updateValue(prev);
			return;
		}

		if (key.downArrow) {
			const next = historyDown();
			if (next !== null) updateValue(next);
			return;
		}

		if (key.backspace || key.delete) {
			updateValue((v) => v.slice(0, -1));
			return;
		}

		// Skip navigation keys handled by the App component
		if (key.pageUp || key.pageDown || key.home || key.end) {
			return;
		}

		// Tab key — trigger completion
		if (key.tab) {
			if (onTab) onTab();
			return;
		}

		// Regular character input
		if (input && !key.ctrl && !key.meta) {
			// Reject control characters
			const code = input.charCodeAt(0);
			if (code < 0x20 || code === 0x7f) return;

			// Filter mouse escape sequences. When xterm mouse reporting is
			// enabled, SGR mouse events (\x1b[<Cb;Cx;CyM) arrive on stdin.
			// Ink's useInput strips the leading \x1b and passes the rest as
			// input text (e.g. "[<64;15;10M"). Reject these.
			if (MOUSE_SEQ_RE.test(input)) return;

			updateValue((v) => v + input);
		}
	});

	// Build prompt
	const PAD = "  "; // 2 chars horizontal padding
	const isRoot = modeLabel === "root";
	const promptColor = isRoot ? scheme.foreground.default : modeAccent;
	const promptPrefix = isRoot ? "" : `[${modeLabel}] `;
	const promptChar = "> ";
	const promptWidth = promptPrefix.length + promptChar.length;

	// Cursor indicator
	const cursor = disabled ? "" : "\u2588"; // █

	// Content for the input line
	const ghost = ghostText ?? "";
	const maxInputWidth = Math.max(0, columns - promptWidth - PAD.length * 2 - 1); // pad each side + cursor
	let displayValue = value;
	if (displayValue.length > maxInputWidth) {
		displayValue = displayValue.slice(displayValue.length - maxInputWidth);
	}

	// Ghost text fits after cursor
	const ghostMaxWidth = Math.max(0, maxInputWidth - displayValue.length);
	const displayGhost = ghost.slice(0, ghostMaxWidth);

	// Padding to fill the input row
	const statusText = disabled ? "waiting for response..." : "";
	const contentWidth = promptWidth + displayValue.length + (disabled ? statusText.length : 1 + displayGhost.length); // 1 for cursor
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
						<Text color={scheme.foreground.bright}>{displayValue}{cursor}</Text>
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
