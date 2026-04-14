// ── Spectrogram renderers — braille+color (human) and shades (LLM) ──

import FFT from "fft.js";

export interface SpectrogramOptions {
	gamma: number;
	dynamicRange: number;
}

const DEFAULT_OPTIONS: SpectrogramOptions = { gamma: 1.8, dynamicRange: 60 };

// ── Mel scale helpers ───────────────────────────────────────────────

function hzToMel(hz: number): number { return 2595 * Math.log10(1 + hz / 700); }
function melToHz(mel: number): number { return 700 * (Math.pow(10, mel / 2595) - 1); }

// ── ANSI color helpers ──────────────────────────────────────────────

function ansiReset(): string { return "\x1b[39m"; } // reset foreground only, preserve background

// Inferno-style heat map: dark blue → purple → orange → white
const HEAT_STOPS: Array<[number, number, number]> = [
	[13, 8, 135],    // #0d0887 — dark blue
	[84, 2, 163],    // #5402a3 — indigo
	[139, 10, 142],  // #8b0a8e — purple
	[185, 50, 102],  // #b93266 — magenta
	[219, 92, 62],   // #db5c3e — red-orange
	[240, 114, 27],  // #f0721b — orange
	[253, 175, 16],  // #fdaf10 — yellow-orange
	[252, 253, 191],  // #fcfdbf — pale yellow-white
];

function lerpRgb(
	a: [number, number, number],
	b: [number, number, number],
	t: number,
): [number, number, number] {
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
	];
}

function heatColor(v: number): string {
	const clamped = Math.max(0, Math.min(1, v));
	const pos = clamped * (HEAT_STOPS.length - 1);
	const idx = Math.min(Math.floor(pos), HEAT_STOPS.length - 2);
	const t = pos - idx;
	const [r, g, b] = lerpRgb(HEAT_STOPS[idx], HEAT_STOPS[idx + 1], t);
	return `\x1b[38;2;${r};${g};${b}m`;
}

// ── Braille dot map ─────────────────────────────────────────────────

const DOT_MAP = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

// ── FFT spectrogram computation (mel-scale, dB + gamma) ─────────────

function computeSpectrogram(
	samples: Float32Array,
	sampleRate: number,
	timeBins: number,
	freqBins: number,
	opts: SpectrogramOptions,
): Float64Array[] {
	let fftSize = 2048;
	while (fftSize < freqBins * 8) fftSize *= 2;

	const fft = new FFT(fftSize);
	const hopSize = Math.max(1, Math.floor(samples.length / timeBins));
	const halfFFT = fftSize / 2;

	// Hann window
	const hann = new Float64Array(fftSize);
	for (let i = 0; i < fftSize; i++) {
		hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
	}

	// Mel-scale bin edges
	const nyquist = sampleRate / 2;
	const melMin = hzToMel(20);
	const melMax = hzToMel(nyquist);
	const melEdges: number[] = [];
	for (let i = 0; i <= freqBins; i++) {
		const mel = melMin + (melMax - melMin) * (i / freqBins);
		const hz = melToHz(mel);
		melEdges.push(Math.round(hz / nyquist * halfFFT));
	}

	const result: Float64Array[] = Array.from({ length: freqBins }, () => new Float64Array(timeBins));

	for (let t = 0; t < timeBins; t++) {
		const start = t * hopSize;
		const windowed = new Float64Array(fftSize);
		for (let i = 0; i < fftSize; i++) {
			const si = start + i;
			windowed[i] = si < samples.length ? samples[si] * hann[i] : 0;
		}

		const output = fft.createComplexArray();
		fft.realTransform(output, windowed);
		fft.completeSpectrum(output);

		for (let mb = 0; mb < freqBins; mb++) {
			const lo = Math.max(1, melEdges[mb]);
			const hi = Math.max(lo + 1, melEdges[mb + 1]);
			let sum = 0;
			for (let k = lo; k < hi; k++) {
				const re = output[k * 2] as number;
				const im = output[k * 2 + 1] as number;
				sum += Math.sqrt(re * re + im * im);
			}
			// Row 0 = high freq
			result[freqBins - 1 - mb][t] = sum / (hi - lo);
		}
	}

	// Convert to dB, clamp dynamic range, normalize, apply gamma
	let maxDb = -Infinity;
	for (let f = 0; f < freqBins; f++) {
		for (let t = 0; t < timeBins; t++) {
			const db = 20 * Math.log10(result[f][t] + 1e-10);
			result[f][t] = db;
			if (db > maxDb) maxDb = db;
		}
	}
	const floor = maxDb - opts.dynamicRange;
	const range = maxDb - floor;
	for (let f = 0; f < freqBins; f++) {
		for (let t = 0; t < timeBins; t++) {
			const v = Math.max(0, (result[f][t] - floor) / range);
			result[f][t] = Math.pow(v, opts.gamma);
		}
	}

	return result;
}

// ── Public renderers ────────────────────────────────────────────────

/** Render spectrogram as braille characters with ANSI 256-color heat map. */
export function renderSpectrogramBraille(
	samples: Float32Array,
	sampleRate: number,
	cols: number,
	rows: number,
	opts: Partial<SpectrogramOptions> = {},
): string[] {
	const o = { ...DEFAULT_OPTIONS, ...opts };
	const dotW = cols * 2;
	const dotH = rows * 4;
	const magnitudes = computeSpectrogram(samples, sampleRate, dotW, dotH, o);

	const lines: string[] = [];
	for (let cr = 0; cr < rows; cr++) {
		let line = "";
		for (let cc = 0; cc < cols; cc++) {
			let code = 0x2800;
			let totalIntensity = 0;
			let count = 0;
			for (let dr = 0; dr < 4; dr++) {
				for (let dc = 0; dc < 2; dc++) {
					const fy = cr * 4 + dr;
					const tx = cc * 2 + dc;
					const v = magnitudes[fy][tx];
					totalIntensity += v;
					count++;
					if (v > 0.15) {
						code |= DOT_MAP[dr][dc];
					}
				}
			}
			const avgIntensity = totalIntensity / count;
			if (code === 0x2800) {
				line += " ";
			} else {
				line += heatColor(Math.min(1, avgIntensity * 2.5))
					+ String.fromCodePoint(code)
					+ ansiReset();
			}
		}
		lines.push(line);
	}
	return lines;
}

/** Render spectrogram as shade block characters (LLM-friendly, no color). */
export function renderSpectrogramShades(
	samples: Float32Array,
	sampleRate: number,
	cols: number,
	rows: number,
	opts: Partial<SpectrogramOptions> = {},
): string[] {
	const o = { ...DEFAULT_OPTIONS, ...opts };
	const displayH = rows * 4;
	const magnitudes = computeSpectrogram(samples, sampleRate, cols, displayH, o);
	const shades = " \u2591\u2592\u2593\u2588"; // ░▒▓█

	const lines: string[] = [];
	for (let y = 0; y < displayH; y++) {
		let line = "";
		for (let x = 0; x < cols; x++) {
			const v = magnitudes[y][x];
			const idx = Math.min(shades.length - 1, Math.round(v * (shades.length - 1)));
			line += shades[idx];
		}
		lines.push(line);
	}
	return lines;
}
