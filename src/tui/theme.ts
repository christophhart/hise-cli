// ── TUI Theme — 4-layer color system ────────────────────────────────

// Layer 1: HISE Brand Colors (hardcoded, matches HISE IDE C++ macros)
// Layer 2: Mode Accent Colors (hardcoded, imported from engine)
// Layer 3: Syntax Highlighting (hardcoded, imported from engine)
// Layer 4: Color Schemes (user-selectable, 8 values each)

// ── Layer 1: HISE Brand Colors ──────────────────────────────────────

export const brand = {
	signal: "#90FFB1",   // SIGNAL_COLOUR — branding, scrollbar, selection
	ok: "#4E8E35",       // HISE_OK_COLOUR — connected, validation pass
	warning: "#FFBA00",  // HISE_WARNING_COLOUR — degraded, deprecation
	error: "#BB3434",    // HISE_ERROR_COLOUR — failed, disconnected
} as const;

// ── Layer 2: Mode Accents (re-exported from engine) ─────────────────

export { MODE_ACCENTS } from "../engine/modes/mode.js";

// Wizard accent (not a mode — UI chrome for wizard overlay)
export const wizardAccent = "#e8a060";

// ── Layer 4: Color Schemes ──────────────────────────────────────────

export interface ColorScheme {
	name: string;
	light?: boolean;
	backgrounds: {
		darker: string;
		standard: string;
		sidebar: string;
		raised: string;
		overlay: string;
	};
	foreground: {
		default: string;
		bright: string;
		muted: string;
	};
}

export const schemes: Record<string, ColorScheme> = {
	monokai: {
		name: "Monokai",
		backgrounds: {
			darker: "#1f201c",
			standard: "#272822",
			sidebar: "#2d2e28",
			raised: "#32342d",
			overlay: "#3e3f38",
		},
		foreground: {
			default: "#a0a09a",
			bright: "#d0d0c8",
			muted: "#75715e",
		},
	},
	dracula: {
		name: "Dracula",
		backgrounds: {
			darker: "#21222c",
			standard: "#282a36",
			sidebar: "#2d2f3d",
			raised: "#343746",
			overlay: "#414558",
		},
		foreground: {
			default: "#a0a4b8",
			bright: "#d4d6e4",
			muted: "#6272a4",
		},
	},
	nord: {
		name: "Nord",
		backgrounds: {
			darker: "#242933",
			standard: "#2e3440",
			sidebar: "#333a47",
			raised: "#3b4252",
			overlay: "#4c566a",
		},
		foreground: {
			default: "#9aa3b6",
			bright: "#d8dee9",
			muted: "#616e88",
		},
	},
	tokyoNight: {
		name: "Tokyo Night",
		backgrounds: {
			darker: "#16161e",
			standard: "#1a1b26",
			sidebar: "#1f202d",
			raised: "#24283b",
			overlay: "#33375a",
		},
		foreground: {
			default: "#9098b8",
			bright: "#c0caf5",
			muted: "#565f89",
		},
	},
	oneDark: {
		name: "One Dark",
		backgrounds: {
			darker: "#1e2127",
			standard: "#282c34",
			sidebar: "#2d313a",
			raised: "#323842",
			overlay: "#3e4452",
		},
		foreground: {
			default: "#9aa2b1",
			bright: "#d4d8e0",
			muted: "#5c6370",
		},
	},
	catppuccinMocha: {
		name: "Catppuccin Mocha",
		backgrounds: {
			darker: "#181825",
			standard: "#1e1e2e",
			sidebar: "#232336",
			raised: "#313244",
			overlay: "#45475a",
		},
		foreground: {
			default: "#9399b2",
			bright: "#cdd6f4",
			muted: "#585b70",
		},
	},
	catppuccinLatte: {
		name: "Catppuccin Latte",
		light: true,
		backgrounds: {
			darker: "#dce0e8",
			standard: "#eff1f5",
			sidebar: "#e6e9ef",
			raised: "#ccd0da",
			overlay: "#bcc0cc",
		},
		foreground: {
			default: "#5c5f77",
			bright: "#4c4f69",
			muted: "#8c8fa1",
		},
	},
	solarizedLight: {
		name: "Solarized Light",
		light: true,
		backgrounds: {
			darker: "#eee8d5",
			standard: "#fdf6e3",
			sidebar: "#f5eedb",
			raised: "#e8e1ce",
			overlay: "#d6cfbc",
		},
		foreground: {
			default: "#586e75",
			bright: "#073642",
			muted: "#93a1a1",
		},
	},
};

export const defaultScheme = schemes.monokai;

// ── Connection status ───────────────────────────────────────────────

export type ConnectionStatus = "connected" | "warning" | "error";

export function statusColor(status: ConnectionStatus): string {
	switch (status) {
		case "connected": return brand.ok;
		case "warning": return brand.warning;
		case "error": return brand.error;
	}
}

export function statusDot(status: ConnectionStatus): string {
	return "\u25CF"; // ●
}
