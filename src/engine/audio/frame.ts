// ── Output framing — box-drawing borders, labels, time axis ─────────

export interface FrameInfo {
	fileName: string;
	sampleRate: number;
	bitsPerSample: number;
	numChannels: number;
	numFrames: number;
}

function header(info: FrameInfo): string {
	const duration = (info.numFrames / info.sampleRate).toFixed(3);
	const chLabel = info.numChannels === 1 ? "1ch" : `${info.numChannels}ch`;
	return ` ${info.fileName} | ${info.sampleRate}Hz ${info.bitsPerSample}bit ${chLabel} | ${duration}s | ${info.numFrames} samples`;
}

function timeAxis(cols: number, info: FrameInfo): string {
	const duration = (info.numFrames / info.sampleRate).toFixed(3);
	const endLabel = `${duration}s`;
	const gap = cols - 2 - endLabel.length; // "0s" is 2 chars
	return "        0s" + " ".repeat(Math.max(1, gap)) + endLabel;
}

/** Frame waveform lines with +1/-1 labels and box drawing. */
export function frameWaveform(lines: string[], cols: number, info: FrameInfo): string {
	const parts: string[] = [];
	parts.push(header(info));
	parts.push("   +1  \u250c" + "\u2500".repeat(cols) + "\u2510");
	for (const line of lines) {
		parts.push("       \u2502" + line + "\u2502");
	}
	parts.push("   -1  \u2514" + "\u2500".repeat(cols) + "\u2518");
	parts.push(timeAxis(cols, info));
	return parts.join("\n");
}

/** Frame spectrogram lines with high/low labels and box drawing. */
export function frameSpectrogram(lines: string[], cols: number, info: FrameInfo): string {
	const parts: string[] = [];
	parts.push(header(info));
	parts.push("  high \u250c" + "\u2500".repeat(cols) + "\u2510");
	for (const line of lines) {
		parts.push("       \u2502" + line + "\u2502");
	}
	parts.push("  low  \u2514" + "\u2500".repeat(cols) + "\u2518");
	parts.push(timeAxis(cols, info));
	return parts.join("\n");
}
