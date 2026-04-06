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
			sidebar: "#22231f",
			raised: "#32342d",
			overlay: "#302f2a",
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
			sidebar: "#242531",
			raised: "#343746",
			overlay: "#30323e",
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
			sidebar: "#282e39",
			raised: "#3b4252",
			overlay: "#353b48",
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
			sidebar: "#181922",
			raised: "#24283b",
			overlay: "#21222e",
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
			sidebar: "#23272d",
			raised: "#323842",
			overlay: "#30343c",
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
			sidebar: "#1b1b29",
			raised: "#313244",
			overlay: "#262636",
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
			sidebar: "#e8eaef",
			raised: "#ccd0da",
			overlay: "#e2e4ea",
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
			sidebar: "#f5efdd",
			raised: "#e8e1ce",
			overlay: "#f0e9d8",
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

// ── 256-color snapping ─────────────────────────────────────────────
// When the terminal doesn't support truecolor, snap hex colors to the
// nearest xterm-256 palette entry so chalk/Ink maps them without drift.

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

function cubeChannelValue(i: number): number {
	return i === 0 ? 0 : 55 + i * 40;
}

/** Snap a single hex color to the nearest xterm-256 palette hex. */
function snapTo256(hex: string): string {
	const [r, g, b] = parseHex(hex);

	// Best cube match — check nearest + adjacent cells in 6x6x6 cube
	let bestCubeR = 0, bestCubeG = 0, bestCubeB = 0;
	let bestCubeDist = Infinity;
	const ri = Math.round(r / 255 * 5);
	const gi = Math.round(g / 255 * 5);
	const bi = Math.round(b / 255 * 5);
	for (let dr = -1; dr <= 1; dr++) {
		for (let dg = -1; dg <= 1; dg++) {
			for (let db = -1; db <= 1; db++) {
				const cr = ri + dr, cg = gi + dg, cb = bi + db;
				if (cr < 0 || cr > 5 || cg < 0 || cg > 5 || cb < 0 || cb > 5) continue;
				const mr = cubeChannelValue(cr), mg = cubeChannelValue(cg), mb = cubeChannelValue(cb);
				const dist = colorDistSq(r, g, b, mr, mg, mb);
				if (dist < bestCubeDist) {
					bestCubeDist = dist;
					bestCubeR = mr; bestCubeG = mg; bestCubeB = mb;
				}
			}
		}
	}

	// Skip grayscale for saturated colors (preserves hue)
	const maxC = Math.max(r, g, b);
	const minC = Math.min(r, g, b);
	if (maxC > 0 && (maxC - minC) / maxC > 0.25) {
		return toHex(bestCubeR, bestCubeG, bestCubeB);
	}

	// Grayscale ramp candidate
	const avg = (r + g + b) / 3;
	const grayIdx = avg < 4 ? 0 : avg > 244 ? 23 : Math.round((avg - 8) / 10);
	const gv = grayIdx <= 0 ? 8 : 8 + grayIdx * 10;
	const grayDist = colorDistSq(r, g, b, gv, gv, gv);

	return grayDist <= bestCubeDist ? toHex(gv, gv, gv) : toHex(bestCubeR, bestCubeG, bestCubeB);
}

export const hasTrueColor = (() => {
	const ct = (typeof process !== "undefined" ? process.env?.COLORTERM : undefined) ?? "";
	return ct === "truecolor" || ct === "24bit";
})();

/** Snap all colors in a scheme to xterm-256 palette equivalents. */
export function snapSchemeFor256(scheme: ColorScheme): ColorScheme {
	const snap = snapTo256;
	return {
		...scheme,
		backgrounds: {
			darker: snap(scheme.backgrounds.darker),
			standard: snap(scheme.backgrounds.standard),
			sidebar: snap(scheme.backgrounds.sidebar),
			raised: snap(scheme.backgrounds.raised),
			overlay: snap(scheme.backgrounds.overlay),
		},
		foreground: {
			default: snap(scheme.foreground.default),
			bright: snap(scheme.foreground.bright),
			muted: snap(scheme.foreground.muted),
		},
	};
}

// ── Color darkening utilities ───────────────────────────────────────

/** Parse a hex color string to RGB components (0–255). */
function parseHex(hex: string): [number, number, number] {
	let h = hex.startsWith("#") ? hex.slice(1) : hex;
	if (h.length === 3) {
		h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	}
	const n = parseInt(h, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Format RGB components (0–255) back to a hex color string. */
function toHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return (
		"#" +
		clamp(r).toString(16).padStart(2, "0") +
		clamp(g).toString(16).padStart(2, "0") +
		clamp(b).toString(16).padStart(2, "0")
	);
}

/**
 * Linearly interpolate between two hex colors.
 * t = 0.0 → colorA, t = 1.0 → colorB.
 */
export function lerpHex(colorA: string, colorB: string, t: number): string {
	const [r1, g1, b1] = parseHex(colorA);
	const [r2, g2, b2] = parseHex(colorB);
	return toHex(
		r1 + (r2 - r1) * t,
		g1 + (g2 - g1) * t,
		b1 + (b2 - b1) * t,
	);
}

/**
 * Mix two colors. alpha=0 → pure colorA, alpha=1 → pure colorB.
 * mix(green, sidebarBg, 0.9) = 10% green + 90% sidebarBg.
 */
export function mix(colorA: string, colorB: string, alpha: number): string {
	return lerpHex(colorA, colorB, alpha);
}

/**
 * Darken a hex color by a factor (0.0 = black, 1.0 = unchanged).
 * Multiplies each RGB channel by the factor.
 */
export function darkenHex(hex: string, factor: number): string {
	const [r, g, b] = parseHex(hex);
	return toHex(r * factor, g * factor, b * factor);
}

/**
 * Lighten a hex color by blending toward white.
 * amount 0.0 = unchanged, 1.0 = pure white.
 * Each channel: ch + (255 - ch) * amount.
 */
export function lightenHex(hex: string, amount: number): string {
	const [r, g, b] = parseHex(hex);
	return toHex(
		r + (255 - r) * amount,
		g + (255 - g) * amount,
		b + (255 - b) * amount,
	);
}


