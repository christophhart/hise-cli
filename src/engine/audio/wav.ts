// ── WAV parser — pure math, no node: imports ────────────────────────

export interface WavData {
	samples: Float32Array;
	sampleRate: number;
	numChannels: number;
	bitsPerSample: number;
	numFrames: number;
}

/** Parse a WAV file buffer into normalized Float32 samples (mono mixdown). */
export function parseWav(buffer: Uint8Array): WavData {
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

	const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
	if (riff !== "RIFF") throw new Error("Not a WAV file");
	const wave = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
	if (wave !== "WAVE") throw new Error("Not a WAV file");

	let offset = 12;
	let audioFormat = 0;
	let numChannels = 0;
	let sampleRate = 0;
	let bitsPerSample = 0;
	let dataStart = 0;
	let dataSize = 0;

	while (offset < buffer.length) {
		const chunkId = String.fromCharCode(
			buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3],
		);
		const chunkSize = view.getUint32(offset + 4, true);

		if (chunkId === "fmt ") {
			audioFormat = view.getUint16(offset + 8, true);
			numChannels = view.getUint16(offset + 10, true);
			sampleRate = view.getUint32(offset + 12, true);
			bitsPerSample = view.getUint16(offset + 22, true);
		} else if (chunkId === "data") {
			dataStart = offset + 8;
			dataSize = chunkSize;
		}

		offset += 8 + chunkSize;
		if (chunkSize % 2 !== 0) offset++; // padding byte
	}

	if (audioFormat !== 1 && audioFormat !== 3) {
		throw new Error(`Unsupported audio format: ${audioFormat} (only PCM and IEEE float supported)`);
	}
	if (!dataStart) throw new Error("No data chunk found");

	const bytesPerSample = bitsPerSample / 8;
	const numFrames = Math.floor(dataSize / (bytesPerSample * numChannels));
	const samples = new Float32Array(numFrames);

	for (let i = 0; i < numFrames; i++) {
		let sum = 0;
		for (let ch = 0; ch < numChannels; ch++) {
			const pos = dataStart + (i * numChannels + ch) * bytesPerSample;
			if (bitsPerSample === 16) {
				sum += view.getInt16(pos, true) / 32768;
			} else if (bitsPerSample === 24) {
				const b0 = buffer[pos], b1 = buffer[pos + 1], b2 = buffer[pos + 2];
				let val = (b2 << 16) | (b1 << 8) | b0;
				if (val & 0x800000) val |= ~0xFFFFFF;
				sum += val / 8388608;
			} else if (bitsPerSample === 32) {
				if (audioFormat === 3) {
					sum += view.getFloat32(pos, true);
				} else {
					sum += view.getInt32(pos, true) / 2147483648;
				}
			}
		}
		samples[i] = sum / numChannels;
	}

	return { samples, sampleRate, numChannels, bitsPerSample, numFrames };
}
