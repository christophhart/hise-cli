// ── ThemeContext — centralized color provider ───────────────────────

// All TUI components read colors from this context instead of importing
// brand/statusColor directly or receiving scheme as props.

import React, { createContext, useContext } from "react";
import {
	brand,
	statusColor,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";
import { COMPACT, type LayoutScale } from "./layout.js";

// ── Context value ───────────────────────────────────────────────────

export interface ThemeContextValue {
	scheme: ColorScheme;
	brand: { signal: string; ok: string; warning: string; error: string };
	statusColor: (status: ConnectionStatus) => string;
	layout: LayoutScale;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

export interface ThemeProviderProps {
	scheme: ColorScheme;
	/** Layout scale (defaults to COMPACT for backward compatibility) */
	layout?: LayoutScale;
	children: React.ReactNode;
}

export function ThemeProvider({
	scheme,
	layout: layoutOverride,
	children,
}: ThemeProviderProps): React.ReactElement {
	const value: ThemeContextValue = {
		scheme,
		brand,
		statusColor,
		layout: layoutOverride ?? COMPACT,
	};

	return (
		<ThemeContext.Provider value={value}>
			{children}
		</ThemeContext.Provider>
	);
}

// ── Hook ────────────────────────────────────────────────────────────

/** Read the current theme colors. Must be called inside a ThemeProvider. */
export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) {
		throw new Error("useTheme() must be used inside a <ThemeProvider>");
	}
	return ctx;
}
