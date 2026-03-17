// ── LandingLogo — animated ASCII art HISE logo ─────────────────────

// Displayed in the output area when there are no output lines.
// Each character is colored by interpolating through the mode accent
// palette, with the gradient offset advancing over time.

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { MODE_ACCENTS, lerpHex, type ColorScheme } from "../theme.js";

// ── ASCII art ───────────────────────────────────────────────────────

// Block-letter "HISE" inspired by Avenir's geometric sans-serif.
// 6 lines tall, even stroke width. The S uses half-blocks (▄▀) for
// smooth, open curves matching Avenir's circular counters.
const LOGO_LINES = [
	"██    ██ ██  ▄████▄  ███████",
	"██    ██ ██ ██▀  ▀██ ██     ",
	"██▄▄▄▄██ ██ ▀██▄▄    ██▄▄▄▄",
	"██▀▀▀▀██ ██    ▀▀██▄ ██▀▀▀▀",
	"██    ██ ██ ██▄  ▄██ ██     ",
	"██    ██ ██  ▀████▀  ███████",
];

// Version from package.json, injected by esbuild at build time.
// Falls back to "dev" when running unbuilt (e.g. vitest).
const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";

const TAGLINE = `  command line TUI v${VERSION}`;
const HINT_TEXT = "Type a command or /help to get started";

// ── Gradient palette (mode accent colors) ───────────────────────────

const GRADIENT_COLORS = [
	MODE_ACCENTS.builder,  // #fd971f orange
	MODE_ACCENTS.compile,  // #f92672 pink
	MODE_ACCENTS.inspect,  // #ae81ff purple
	MODE_ACCENTS.dsp,      // #3a6666 teal
	MODE_ACCENTS.import,   // #2de0a5 mint
	MODE_ACCENTS.sampler,  // #a6e22e green
	MODE_ACCENTS.project,  // #e6db74 yellow
	MODE_ACCENTS.script,   // #C65638 rust
];

// Animation speed: how many gradient "steps" per tick
const TICK_MS = 80;
const SHIFT_PER_TICK = 0.02;

// ── Color interpolation along the gradient ──────────────────────────

/**
 * Sample a color from the gradient palette at a fractional position.
 * pos wraps around [0, 1) and maps to the GRADIENT_COLORS array.
 */
function sampleGradient(pos: number): string {
	// Wrap to [0, 1)
	const p = ((pos % 1) + 1) % 1;
	const count = GRADIENT_COLORS.length;
	const scaled = p * count;
	const idx = Math.floor(scaled);
	const frac = scaled - idx;
	const colorA = GRADIENT_COLORS[idx % count]!;
	const colorB = GRADIENT_COLORS[(idx + 1) % count]!;
	return lerpHex(colorA, colorB, frac);
}

// ── Component ───────────────────────────────────────────────────────

export interface LandingLogoProps {
	viewportHeight: number;
	columns: number;
	scheme: ColorScheme;
	/** Set to false to freeze the gradient animation. Default: true. */
	animate?: boolean;
}

export const LandingLogo = React.memo(function LandingLogo({
	viewportHeight,
	columns,
	scheme,
	animate = true,
}: LandingLogoProps) {
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		if (!animate) return;
		const timer = setInterval(() => {
			setOffset((prev) => prev + SHIFT_PER_TICK);
		}, TICK_MS);
		return () => clearInterval(timer);
	}, [animate]);

	const logoWidth = LOGO_LINES.reduce((max, l) => Math.max(max, l.length), 0);
	const logoHeight = LOGO_LINES.length;
	// Layout: logo + 1 blank + tagline + 1 blank + hint = logo + 4
	const totalBlock = logoHeight + 4;

	// Center vertically
	const startRow = Math.max(0, Math.floor((viewportHeight - totalBlock) / 2));
	// Center horizontally
	const logoIndent = Math.max(0, Math.floor((columns - logoWidth) / 2));
	const taglineIndent = Math.max(0, Math.floor((columns - TAGLINE.length) / 2));
	const hintIndent = Math.max(0, Math.floor((columns - HINT_TEXT.length) / 2));

	const rows: React.ReactNode[] = [];

	for (let row = 0; row < viewportHeight; row++) {
		const logoRow = row - startRow;

		if (logoRow >= 0 && logoRow < logoHeight) {
			// Logo line — render each character with gradient color
			const line = LOGO_LINES[logoRow]!;
			const chars: React.ReactNode[] = [];

			for (let col = 0; col < line.length; col++) {
				const ch = line[col]!;
				if (ch === " ") {
					chars.push(ch);
				} else {
					// Map character position to gradient: spread across the full logo width
					const gradPos = offset + (col / logoWidth) * 0.6;
					const color = sampleGradient(gradPos);
					chars.push(
						<Text key={col} color={color}>{ch}</Text>,
					);
				}
			}

			const padLeft = " ".repeat(logoIndent);
			const padRight = " ".repeat(Math.max(0, columns - logoIndent - line.length));

			rows.push(
				<Box key={row}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{padLeft}{chars}{padRight}
					</Text>
				</Box>,
			);
		} else if (logoRow === logoHeight + 1) {
			// Tagline
			const padLeft = " ".repeat(taglineIndent);
			const padRight = " ".repeat(Math.max(0, columns - taglineIndent - TAGLINE.length));
			rows.push(
				<Box key={row}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{padLeft}
						<Text color={scheme.foreground.muted}>{TAGLINE}</Text>
						{padRight}
					</Text>
				</Box>,
			);
		} else if (logoRow === logoHeight + 3) {
			// Hint line
			const padLeft = " ".repeat(hintIndent);
			const padRight = " ".repeat(Math.max(0, columns - hintIndent - HINT_TEXT.length));
			rows.push(
				<Box key={row}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{padLeft}
						<Text color={scheme.foreground.muted}>{HINT_TEXT}</Text>
						{padRight}
					</Text>
				</Box>,
			);
		} else {
			// Empty row
			rows.push(
				<Box key={row}>
					<Text backgroundColor={scheme.backgrounds.standard}>
						{" ".repeat(columns)}
					</Text>
				</Box>,
			);
		}
	}

	return <Box flexDirection="column">{rows}</Box>;
});
