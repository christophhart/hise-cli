// ── Show-keys badge state hook ───────────────────────────────────────

import { useState, useCallback, useRef, useEffect } from "react";

export interface InkKey {
	ctrl: boolean;
	meta: boolean;
	shift: boolean;
	escape: boolean;
	tab: boolean;
	return: boolean;
	upArrow: boolean;
	downArrow: boolean;
	leftArrow: boolean;
	rightArrow: boolean;
	pageUp: boolean;
	pageDown: boolean;
	home: boolean;
	end: boolean;
	delete: boolean;
	backspace: boolean;
}

export interface KeyLabelState {
	/** Current display label (e.g. "Key: Ctrl+A"). */
	keyLabel: string;
	/** Format a keystroke into a display label, or "" to suppress. */
	formatKeyLabel: (input: string, key: InkKey) => string;
	/** Push a key event to the badge (auto-clears after 1.5s). */
	pushKeyLabel: (input: string, key: InkKey) => void;
}

export function useKeyLabel(
	showKeys: boolean,
	f5PressedRef: React.RefObject<boolean>,
	f7PressedRef: React.RefObject<boolean>,
): KeyLabelState {
	const [keyLabel, setKeyLabel] = useState("");
	const keyLabelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastKeyRef = useRef<string>("");
	const keyCountRef = useRef(0);

	/** Format a keystroke into a display label, or "" to suppress. */
	const formatKeyLabel = useCallback((input: string, key: InkKey) => {
		// Modifier prefix (Shift shown only for non-obvious combos)
		const shift = key.shift ? "Shift+" : "";

		// Navigation / special keys
		if (key.escape) return "Escape";
		if (key.tab) return shift ? "Shift+Tab" : "Tab";
		if (key.return) return shift ? "Shift+Enter" : "Enter";
		if (key.upArrow) return `${shift}\u2191`;
		if (key.downArrow) return `${shift}\u2193`;
		if (key.leftArrow) return `${shift}\u2190`;
		if (key.rightArrow) return `${shift}\u2192`;
		if (key.pageUp) return "PgUp";
		if (key.pageDown) return "PgDn";
		if (key.home) return `${shift}Home`;
		if (key.end) return `${shift}End`;
		if (key.delete || key.backspace) return "Delete";

		// Modifier combos (Ctrl, Alt/Meta)
		if (key.ctrl && input) return `Ctrl+${input.toUpperCase()}`;
		if (key.meta && input) return `Alt+${input.toUpperCase()}`;

		// Space bar (without modifiers it's obvious during typing, but
		// show it when used as a toggle in sidebar/wizard context)
		if (input === " " && !key.ctrl && !key.meta) return "Space";

		// Suppress plain printable characters — they're obvious on screen
		return "";
	}, []);

	const pushKeyLabel = useCallback((input: string, key: InkKey) => {
		if (!showKeys) return;
		// Check for F5/F7 from raw stdin refs
		let label = "";
		if (f5PressedRef.current) label = "F5";
		else if (f7PressedRef.current) label = "F7";
		else label = formatKeyLabel(input, key);
		if (!label) return;

		// Accumulate repeated presses of the same key
		if (label === lastKeyRef.current) {
			keyCountRef.current++;
		} else {
			lastKeyRef.current = label;
			keyCountRef.current = 1;
		}
		const display = keyCountRef.current > 1
			? `Key: ${label} x${keyCountRef.current}`
			: `Key: ${label}`;
		setKeyLabel(display);

		if (keyLabelTimerRef.current) clearTimeout(keyLabelTimerRef.current);
		keyLabelTimerRef.current = setTimeout(() => {
			setKeyLabel("");
			lastKeyRef.current = "";
			keyCountRef.current = 0;
		}, 1500);
	}, [showKeys, formatKeyLabel]);

	// Clean up timer on unmount
	useEffect(() => {
		return () => { if (keyLabelTimerRef.current) clearTimeout(keyLabelTimerRef.current); };
	}, []);

	return { keyLabel, formatKeyLabel, pushKeyLabel };
}
