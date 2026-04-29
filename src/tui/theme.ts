// ── Theme — hardcoded monokai constants for inline shell ────────────

export const brand = {
	signal: "#90FFB1",
	ok: "#4E8E35",
	warning: "#FFBA00",
	error: "#BB3434",
} as const;

export { MODE_ACCENTS } from "../engine/modes/mode.js";

export interface ColorScheme {
	backgrounds: {
		standard: string;
		raised: string;
		overlay: string;
	};
	foreground: {
		default: string;
		bright: string;
		muted: string;
	};
}

export const defaultScheme: ColorScheme = {
	backgrounds: {
		standard: "#272822",
		raised: "#32342d",
		overlay: "#302f2a",
	},
	foreground: {
		default: "#a0a09a",
		bright: "#d0d0c8",
		muted: "#75715e",
	},
};

// ── Truecolor detection ─────────────────────────────────────────────
// COLORTERM=truecolor|24bit is set by terminals that support 24-bit RGB
// (iTerm2, Alacritty, kitty, modern xterm, VS Code, Windows Terminal).
// macOS Terminal.app and other 256-color terminals leave it unset, so we
// fall back to the xterm-256 palette in prerender.ts.

export const hasTrueColor = (() => {
	const ct = (typeof process !== "undefined" ? process.env?.COLORTERM : undefined) ?? "";
	return ct === "truecolor" || ct === "24bit";
})();

// ── Connection status ───────────────────────────────────────────────

export type ConnectionStatus = "connected" | "warning" | "error";

export function statusColor(status: ConnectionStatus): string {
	switch (status) {
		case "connected": return brand.ok;
		case "warning":   return brand.warning;
		case "error":     return brand.error;
	}
}

export function statusDot(_status: ConnectionStatus): string {
	return "●";
}

// ── Color helpers (used by banner gradient + markdown + Input cursor) ─

function parseHex(hex: string): [number, number, number] {
	let h = hex.startsWith("#") ? hex.slice(1) : hex;
	if (h.length === 3) {
		h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	}
	const n = parseInt(h, 16);
	return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex(r: number, g: number, b: number): string {
	const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
	return (
		"#" +
		clamp(r).toString(16).padStart(2, "0") +
		clamp(g).toString(16).padStart(2, "0") +
		clamp(b).toString(16).padStart(2, "0")
	);
}

export function lerpHex(colorA: string, colorB: string, t: number): string {
	const [r1, g1, b1] = parseHex(colorA);
	const [r2, g2, b2] = parseHex(colorB);
	return toHex(
		r1 + (r2 - r1) * t,
		g1 + (g2 - g1) * t,
		b1 + (b2 - b1) * t,
	);
}

export function darkenHex(hex: string, factor: number): string {
	const [r, g, b] = parseHex(hex);
	return toHex(r * factor, g * factor, b * factor);
}

export function lightenHex(hex: string, amount: number): string {
	const [r, g, b] = parseHex(hex);
	return toHex(
		r + (255 - r) * amount,
		g + (255 - g) * amount,
		b + (255 - b) * amount,
	);
}
