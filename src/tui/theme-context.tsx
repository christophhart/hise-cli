// ── ThemeContext — centralized color provider ───────────────────────

// All TUI components read colors from this context instead of importing
// brand/statusColor directly or receiving scheme as props. When the
// dimmed overlay backdrop renders, it wraps the tree in a ThemeProvider
// with darkened values — every component automatically gets the dimmed
// colors without any override props.

import React, { createContext, useContext } from "react";
import {
	brand as defaultBrand,
	statusColor as defaultStatusColor,
	type BrandColors,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";

// ── Context value ───────────────────────────────────────────────────

export interface ThemeContextValue {
	scheme: ColorScheme;
	brand: BrandColors;
	statusColor: (status: ConnectionStatus) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

export interface ThemeProviderProps {
	scheme: ColorScheme;
	/** Override brand colors (e.g. darkened for overlay backdrop) */
	brand?: BrandColors;
	/** Override status color resolver */
	statusColor?: (status: ConnectionStatus) => string;
	children: React.ReactNode;
}

export function ThemeProvider({
	scheme,
	brand: brandOverride,
	statusColor: statusColorOverride,
	children,
}: ThemeProviderProps): React.ReactElement {
	const value: ThemeContextValue = {
		scheme,
		brand: brandOverride ?? defaultBrand,
		statusColor: statusColorOverride ?? defaultStatusColor,
	};

	return (
		<ThemeContext.Provider value={value}>
			{children}
		</ThemeContext.Provider>
	);
}

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Read the current theme colors. Must be called inside a ThemeProvider.
 * Returns scheme, brand, and statusColor — all of which may be darkened
 * when rendered inside the overlay backdrop layer.
 */
export function useTheme(): ThemeContextValue {
	const ctx = useContext(ThemeContext);
	if (!ctx) {
		throw new Error("useTheme() must be used inside a <ThemeProvider>");
	}
	return ctx;
}
