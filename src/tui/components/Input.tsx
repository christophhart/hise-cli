// ── Input — mode-colored prompt with command history ─────────────────

import React, { useCallback, useRef, useState } from "react";
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

export interface InputProps {
	modeLabel: string;
	modeAccent: string;
	scheme: ColorScheme;
	columns: number;
	disabled?: boolean;
	onSubmit: (value: string) => void;
}

export const Input = React.memo(function Input({
	modeLabel,
	modeAccent,
	scheme,
	columns,
	disabled = false,
	onSubmit,
}: InputProps) {
	const [value, setValue] = useState("");
	const {
		addToHistory,
		historyUp,
		historyDown,
	} = useCommandHistory();

	const handleSubmit = useCallback(() => {
		const trimmed = value.trim();
		if (!trimmed || disabled) return;

		addToHistory(trimmed);
		onSubmit(trimmed);
		setValue("");
	}, [value, disabled, addToHistory, onSubmit]);

	useInput((input, key) => {
		if (disabled) return;

		if (key.return) {
			handleSubmit();
			return;
		}

		if (key.upArrow) {
			const prev = historyUp(value);
			if (prev !== null) setValue(prev);
			return;
		}

		if (key.downArrow) {
			const next = historyDown();
			if (next !== null) setValue(next);
			return;
		}

		if (key.backspace || key.delete) {
			setValue((v) => v.slice(0, -1));
			return;
		}

		// Regular character input
		if (input && !key.ctrl && !key.meta) {
			setValue((v) => v + input);
		}
	});

	// Build prompt
	const isRoot = modeLabel === "root";
	const promptColor = isRoot ? scheme.foreground.default : modeAccent;
	const promptPrefix = isRoot ? "" : `[${modeLabel}] `;
	const promptChar = "> ";
	const promptWidth = promptPrefix.length + promptChar.length;

	// Separator line
	const separatorChar = "\u2500"; // ─
	const separator = separatorChar.repeat(columns);

	// Cursor indicator
	const cursor = disabled ? "" : "\u2588"; // █

	// Content for the input line
	const maxInputWidth = Math.max(0, columns - promptWidth - 2); // 2 for padding
	let displayValue = value;
	if (displayValue.length > maxInputWidth) {
		displayValue = displayValue.slice(displayValue.length - maxInputWidth);
	}

	return (
		<Box flexDirection="column">
			<Text color={scheme.foreground.muted}>{separator}</Text>
			<Box>
				<Text backgroundColor={scheme.backgrounds.raised}>
					{promptPrefix ? (
						<Text color={scheme.foreground.muted}>{promptPrefix}</Text>
					) : null}
					<Text color={promptColor} bold>{promptChar}</Text>
					{disabled ? (
						<Text color={scheme.foreground.muted}>waiting for response...</Text>
					) : (
						<Text color={scheme.foreground.bright}>{displayValue}{cursor}</Text>
					)}
					<Text>{" ".repeat(Math.max(0, columns - promptWidth - displayValue.length - 1))}</Text>
				</Text>
			</Box>
			<Text backgroundColor={scheme.backgrounds.raised}>{" ".repeat(columns)}</Text>
		</Box>
	);
});
