// ── Braille grid utility — shared by waveform and spectrogram ───────

const BRAILLE_BASE = 0x2800;
const DOT_MAP = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

export interface BrailleGrid {
	readonly dotW: number;
	readonly dotH: number;
	set(x: number, y: number): void;
	render(): string[];
}

/** Create a braille dot grid of the given character dimensions. */
export function brailleGrid(charCols: number, charRows: number): BrailleGrid {
	const dotW = charCols * 2;
	const dotH = charRows * 4;
	const grid: Uint8Array[] = Array.from({ length: dotH }, () => new Uint8Array(dotW));

	return {
		dotW,
		dotH,
		set(x: number, y: number) {
			if (x >= 0 && x < dotW && y >= 0 && y < dotH) grid[y][x] = 1;
		},
		render(): string[] {
			const lines: string[] = [];
			for (let cr = 0; cr < charRows; cr++) {
				let line = "";
				for (let cc = 0; cc < charCols; cc++) {
					let code = BRAILLE_BASE;
					for (let dr = 0; dr < 4; dr++) {
						for (let dc = 0; dc < 2; dc++) {
							if (grid[cr * 4 + dr][cc * 2 + dc]) {
								code |= DOT_MAP[dr][dc];
							}
						}
					}
					line += String.fromCodePoint(code);
				}
				lines.push(line);
			}
			return lines;
		},
	};
}
