// ── Static ASCII banner for inline mode startup ─────────────────────

import { MODE_ACCENTS, lerpHex } from "../tui/theme.js";
import { fgHex, RESET } from "../tui/components/prerender.js";

const LOGO_LINES = [
	"██    ██ ██  ▄████▄  ███████",
	"██    ██ ██ ██▀  ▀██ ██     ",
	"██▄▄▄▄██ ██ ▀██▄▄    ██▄▄▄▄",
	"██▀▀▀▀██ ██    ▀▀██▄ ██▀▀▀▀",
	"██    ██ ██ ██▄  ▄██ ██     ",
	"██    ██ ██  ▀████▀  ███████",
];

const GRADIENT_COLORS = [
	MODE_ACCENTS.builder,
	MODE_ACCENTS.compile,
	MODE_ACCENTS.inspect,
	MODE_ACCENTS.dsp,
	MODE_ACCENTS.sampler,
	MODE_ACCENTS.project,
	MODE_ACCENTS.script,
];

function sampleGradient(pos: number): string {
	const p = ((pos % 1) + 1) % 1;
	const count = GRADIENT_COLORS.length;
	const scaled = p * count;
	const idx = Math.floor(scaled);
	const frac = scaled - idx;
	const colorA = GRADIENT_COLORS[idx % count]!;
	const colorB = GRADIENT_COLORS[(idx + 1) % count]!;
	return lerpHex(colorA, colorB, frac);
}

export function renderInlineBanner(version: string): string {
	const logoWidth = LOGO_LINES.reduce((max, l) => Math.max(max, l.length), 0);
	const cols = process.stdout.columns ?? 80;
	const dim = fgHex("#888888");
	const hr = dim + "─".repeat(Math.max(1, cols)) + RESET;
	const lines: string[] = [];

	lines.push("");
	lines.push(hr);
	lines.push("");

	for (const line of LOGO_LINES) {
		let out = "  ";
		for (let col = 0; col < line.length; col++) {
			const ch = line[col]!;
			if (ch === " ") {
				out += ch;
			} else {
				const gradPos = (col / logoWidth) * 0.6;
				const color = sampleGradient(gradPos);
				out += fgHex(color) + ch + RESET;
			}
		}
		lines.push(out);
	}

	lines.push("");
	lines.push(dim + `  Command line TUI v${version}` + RESET);
	lines.push("");
	lines.push(dim + "  Type /help to get started" + RESET);
	lines.push("");
	lines.push(hr);
	lines.push("");

	return lines.join("\n") + "\n";
}
