// ── Waveform renderers — braille (human) and block (LLM) ────────────

import { brailleGrid } from "./braille.js";

const SILENCE_THRESHOLD = 0.001;

/** Render waveform as braille min/max envelope with silence markers. */
export function renderWaveformBraille(
	samples: Float32Array,
	cols: number,
	rows: number,
): string[] {
	const bg = brailleGrid(cols, rows);
	const { dotW, dotH } = bg;

	// Track silence per character column
	const colSilent = new Uint8Array(cols);

	for (let dx = 0; dx < dotW; dx++) {
		const startIdx = Math.round(dx / dotW * samples.length);
		const endIdx = Math.round((dx + 1) / dotW * samples.length);
		let minVal = 0, maxVal = 0;
		for (let i = startIdx; i < endIdx && i < samples.length; i++) {
			if (samples[i] < minVal) minVal = samples[i];
			if (samples[i] > maxVal) maxVal = samples[i];
		}

		const isSilent = Math.abs(maxVal) < SILENCE_THRESHOLD && Math.abs(minVal) < SILENCE_THRESHOLD;
		const charCol = Math.floor(dx / 2);
		if (dx % 2 === 0) {
			colSilent[charCol] = isSilent ? 1 : 0;
		} else if (!isSilent) {
			colSilent[charCol] = 0;
		}

		const yMax = Math.max(0, Math.min(dotH - 1, Math.round((1 - maxVal) / 2 * (dotH - 1))));
		const yMin = Math.max(0, Math.min(dotH - 1, Math.round((1 - minVal) / 2 * (dotH - 1))));
		for (let y = yMax; y <= yMin; y++) {
			bg.set(dx, y);
		}
	}

	// Replace silent columns with _ one row above center, clear all other rows
	const lines = bg.render();
	const silenceRow = Math.floor(rows / 2) - 1;
	for (let row = 0; row < rows; row++) {
		const chars = [...lines[row]];
		for (let cc = 0; cc < cols; cc++) {
			if (colSilent[cc]) {
				chars[cc] = (row === silenceRow && silenceRow >= 0) ? "_" : " ";
			}
		}
		lines[row] = chars.join("");
	}
	return lines;
}

/** Render waveform as filled block chart (LLM-friendly). */
export function renderWaveformBlocks(
	samples: Float32Array,
	cols: number,
	rows: number,
): string[] {
	const syms = " \u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588"; // ▁▂▃▄▅▆▇█
	const levels = rows * 8;

	const peaks = new Float64Array(cols);
	for (let c = 0; c < cols; c++) {
		const startIdx = Math.round(c / cols * samples.length);
		const endIdx = Math.round((c + 1) / cols * samples.length);
		let peak = 0;
		for (let i = startIdx; i < endIdx; i++) {
			peak = Math.max(peak, Math.abs(samples[i]));
		}
		peaks[c] = peak;
	}

	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = "";
		for (let c = 0; c < cols; c++) {
			if (peaks[c] < SILENCE_THRESHOLD) {
				line += row === rows - 1 ? "_" : " ";
				continue;
			}
			const fillHeight = peaks[c] * levels;
			const rowBottom = (rows - 1 - row) * 8;
			const fillInRow = fillHeight - rowBottom;
			if (fillInRow >= 8) {
				line += "\u2588";
			} else if (fillInRow <= 0) {
				line += " ";
			} else {
				line += syms[Math.round(fillInRow)];
			}
		}
		lines.push(line);
	}
	return lines;
}
