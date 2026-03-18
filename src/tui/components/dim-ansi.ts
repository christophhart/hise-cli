// ── dimAnsiString — darken RGB colors in ANSI escape sequences ──────
//
// Post-processes a pre-rendered ANSI string to darken all RGB color
// values by a factor. Used for the overlay dimmed backdrop.

import { darkenHex } from "../theme.js";

// Match ANSI true-color sequences: ESC[38;2;R;G;Bm (fg) and ESC[48;2;R;G;Bm (bg)
const ANSI_RGB_RE = /\x1b\[(38|48);2;(\d+);(\d+);(\d+)m/g;

/**
 * Darken all RGB colors in an ANSI string by the given factor.
 * Factor is the same as darkenHex: 0.65 means multiply by 0.65.
 */
export function dimAnsiString(input: string, factor: number): string {
	return input.replace(ANSI_RGB_RE, (_match, type, r, g, b) => {
		const hex = "#" +
			Math.round(Number(r) * factor).toString(16).padStart(2, "0") +
			Math.round(Number(g) * factor).toString(16).padStart(2, "0") +
			Math.round(Number(b) * factor).toString(16).padStart(2, "0");
		// Reconstruct the ANSI sequence with darkened RGB
		const nr = Math.round(Number(r) * factor);
		const ng = Math.round(Number(g) * factor);
		const nb = Math.round(Number(b) * factor);
		return `\x1b[${type};2;${nr};${ng};${nb}m`;
	});
}

/**
 * Dim an array of ANSI lines. Returns a new array.
 */
export function dimAnsiLines(lines: string[], factor: number): string[] {
	return lines.map(line => dimAnsiString(line, factor));
}
