// ── Asciicast Writer — serialize RunResult to asciicast v2 .cast ─────

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import type { RunResult, OutputEvent } from "./runner.js";

// ── Monokai theme palette ───────────────────────────────────────────
// Standard 16-color ANSI palette in Monokai style, matching our
// theme.ts scheme. Used in the .cast header so asciinema-player
// renders with the correct colors.

const MONOKAI_PALETTE = [
	"#272822", // 0  black (background)
	"#f92672", // 1  red
	"#a6e22e", // 2  green
	"#f4bf75", // 3  yellow
	"#66d9ef", // 4  blue
	"#ae81ff", // 5  magenta
	"#a1efe4", // 6  cyan
	"#f8f8f2", // 7  white
	"#75715e", // 8  bright black (muted)
	"#f92672", // 9  bright red
	"#a6e22e", // 10 bright green
	"#f4bf75", // 11 bright yellow
	"#66d9ef", // 12 bright blue
	"#ae81ff", // 13 bright magenta
	"#a1efe4", // 14 bright cyan
	"#f9f8f5", // 15 bright white
].join(":");

// ── Event optimization ──────────────────────────────────────────────

/** Merge time threshold — events within this gap are merged. */
const MERGE_GAP_MS = 5;

/**
 * Optimize raw pty output events:
 * 1. Merge events with <5ms gap — Ink splits single frames across
 *    multiple stdout.write() calls, producing many 0ms-gap events.
 *    Merging them reduces event count by ~70%.
 * 2. Deduplicate consecutive identical payloads — Ink re-renders
 *    the same frame during idle (animation ticks, timer callbacks).
 *    After merging, many full-screen redraws are identical.
 */
function optimizeEvents(events: OutputEvent[]): OutputEvent[] {
	if (events.length === 0) return [];

	// ── Pass 1: Merge events with tiny time gaps ────────────────────

	const merged: OutputEvent[] = [{ ...events[0] }];

	for (let i = 1; i < events.length; i++) {
		const prev = merged[merged.length - 1];
		const curr = events[i];
		const gapMs = (curr.time - prev.time) * 1000;

		if (gapMs < MERGE_GAP_MS) {
			// Merge: append data to previous event
			prev.data += curr.data;
		} else {
			merged.push({ ...curr });
		}
	}

	// ── Pass 2: Deduplicate consecutive identical payloads ──────────

	const deduped: OutputEvent[] = [merged[0]];

	for (let i = 1; i < merged.length; i++) {
		if (merged[i].data !== merged[i - 1].data) {
			deduped.push(merged[i]);
		}
		// Drop identical consecutive events — the screen looks
		// the same, so no point emitting redundant redraws.
	}

	return deduped;
}

// ── Writer ──────────────────────────────────────────────────────────

/**
 * Write an asciicast v2 .cast file from a RunResult.
 *
 * The pty-based runner captures real terminal output, so each event
 * is written directly as an asciicast "o" event — no frame mangling
 * or escape sequence rewriting needed.
 *
 * Optimizations applied:
 * - Events with <5ms gap are merged (Ink stdout chunking)
 * - Consecutive identical events are deduplicated (idle redraws)
 * - Output can be gzipped (asciinema-player supports .cast.gz)
 */
export function writeAsciicast(
	result: RunResult,
	outputPath: string,
	options?: {
		title?: string;
		includeInputEvents?: boolean;
		gzip?: boolean;
	},
): void {
	const lines: string[] = [];

	// ── Header ──────────────────────────────────────────────────────

	const header: Record<string, unknown> = {
		version: 2,
		width: result.width,
		height: result.height,
		env: { TERM: "xterm-256color" },
		theme: {
			fg: "#d0d0c8",
			bg: "#272822",
			palette: MONOKAI_PALETTE,
		},
	};
	if (options?.title) {
		header.title = options.title;
	}

	lines.push(JSON.stringify(header));

	// ── Output events — optimized pty chunks ────────────────────────

	const optimized = optimizeEvents(result.events);

	for (const event of optimized) {
		lines.push(JSON.stringify([
			roundTime(event.time),
			"o",
			event.data,
		]));
	}

	// ── Input events (optional) ─────────────────────────────────────

	if (options?.includeInputEvents) {
		for (const input of result.inputs) {
			lines.push(JSON.stringify([
				roundTime(input.time),
				"i",
				input.text,
			]));
		}
	}

	// ── Marker events (from Annotations) ────────────────────────────

	for (const marker of result.markers) {
		lines.push(JSON.stringify([
			roundTime(marker.time),
			"m",
			marker.text,
		]));
	}

	// ── Write to disk ───────────────────────────────────────────────

	const content = lines.join("\n") + "\n";

	const dir = path.dirname(outputPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	if (options?.gzip) {
		const gzPath = outputPath.endsWith(".gz")
			? outputPath
			: outputPath + ".gz";
		const compressed = zlib.gzipSync(Buffer.from(content, "utf8"), {
			level: 9,
		});
		fs.writeFileSync(gzPath, compressed);
	} else {
		fs.writeFileSync(outputPath, content, "utf8");
	}
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Round time to 3 decimal places (millisecond precision). */
function roundTime(t: number): number {
	return Math.round(t * 1000) / 1000;
}

/**
 * Derive a .cast output path from a .tape input path.
 * e.g. "screencasts/mode-switching.tape" → "screencasts/mode-switching.cast"
 */
export function castPathFromTape(tapePath: string): string {
	const ext = path.extname(tapePath);
	return tapePath.slice(0, -ext.length) + ".cast";
}

/**
 * Derive a title from a tape file path.
 * e.g. "screencasts/mode-switching.tape" → "mode-switching"
 */
export function titleFromTapePath(tapePath: string): string {
	return path.basename(tapePath, path.extname(tapePath));
}
