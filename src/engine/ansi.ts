// ── Shared ANSI colour helpers ──────────────────────────────────────
//
// Engine-layer (zero node: imports) colour helpers. Detect 24-bit
// truecolor support once via $COLORTERM; fall back to the xterm-256
// palette for terminals that only advertise 256 colours (e.g. macOS
// Terminal.app, Linux console).

export const RESET = "\x1b[0m";

export const hasTrueColor = (() => {
	const ct = (typeof process !== "undefined" ? process.env?.COLORTERM : undefined) ?? "";
	return ct === "truecolor" || ct === "24bit";
})();

function hexToRgb(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

function colorDistSq(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
	return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

function cubeToRgb(idx: number): [number, number, number] {
	idx -= 16;
	const bi = idx % 6;
	idx = Math.floor(idx / 6);
	const gi = idx % 6;
	const ri = Math.floor(idx / 6);
	return [ri ? 55 + ri * 40 : 0, gi ? 55 + gi * 40 : 0, bi ? 55 + bi * 40 : 0];
}

/** Convert RGB to nearest xterm-256 index. Checks 6×6×6 cube + grayscale ramp;
 *  skips grayscale for saturated colors to preserve hue. */
export function rgbTo256(r: number, g: number, b: number): number {
	let bestCubeIdx = 16;
	let bestCubeDist = Infinity;
	const ri = Math.round(r / 255 * 5);
	const gi = Math.round(g / 255 * 5);
	const bi = Math.round(b / 255 * 5);
	for (let dr = -1; dr <= 1; dr++) {
		for (let dg = -1; dg <= 1; dg++) {
			for (let db = -1; db <= 1; db++) {
				const cr = ri + dr;
				const cg = gi + dg;
				const cb = bi + db;
				if (cr < 0 || cr > 5 || cg < 0 || cg > 5 || cb < 0 || cb > 5) continue;
				const idx = 16 + 36 * cr + 6 * cg + cb;
				const [mr, mg, mb] = cubeToRgb(idx);
				const dist = colorDistSq(r, g, b, mr, mg, mb);
				if (dist < bestCubeDist) {
					bestCubeDist = dist;
					bestCubeIdx = idx;
				}
			}
		}
	}

	const maxC = Math.max(r, g, b);
	const minC = Math.min(r, g, b);
	if (maxC > 0 && (maxC - minC) / maxC > 0.25) return bestCubeIdx;

	const avg = (r + g + b) / 3;
	const grayIdx = avg < 4 ? 16 : avg > 244 ? 231 : Math.round((avg - 8) / 10) + 232;
	const gv = grayIdx < 232 ? 0 : 8 + (grayIdx - 232) * 10;
	const grayDist = colorDistSq(r, g, b, gv, gv, gv);

	return grayDist <= bestCubeDist ? grayIdx : bestCubeIdx;
}

export function fgRgb(r: number, g: number, b: number): string {
	if (hasTrueColor) return `\x1b[38;2;${r};${g};${b}m`;
	return `\x1b[38;5;${rgbTo256(r, g, b)}m`;
}

export function bgRgb(r: number, g: number, b: number): string {
	if (hasTrueColor) return `\x1b[48;2;${r};${g};${b}m`;
	return `\x1b[48;5;${rgbTo256(r, g, b)}m`;
}

export function fgHex(hex: string | undefined): string {
	if (!hex || hex.length < 7 || hex[0] !== "#") return "";
	const [r, g, b] = hexToRgb(hex);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "";
	return fgRgb(r, g, b);
}

export function bgHex(hex: string | undefined): string {
	if (!hex || hex.length < 7 || hex[0] !== "#") return "";
	const [r, g, b] = hexToRgb(hex);
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return "";
	return bgRgb(r, g, b);
}
