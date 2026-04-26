// ── LandingLogoWeb — web port of the TUI animated logo ──────────────
//
// Mirrors src/tui/components/LandingLogo.tsx: same ASCII art, same
// MODE_ACCENTS gradient palette, same per-character interpolation. The
// gradient offset advances on a setInterval just like the Ink version.

import { useEffect, useState } from "react";

const LOGO_LINES = [
	"██    ██ ██  ▄████▄  ███████",
	"██    ██ ██ ██▀  ▀██ ██     ",
	"██▄▄▄▄██ ██ ▀██▄▄    ██▄▄▄▄",
	"██▀▀▀▀██ ██    ▀▀██▄ ██▀▀▀▀",
	"██    ██ ██ ██▄  ▄██ ██     ",
	"██    ██ ██  ▀████▀  ███████",
];

// Same palette and order as TUI LandingLogo (MODE_ACCENTS members).
const GRADIENT_COLORS = [
	"#fd971f", // builder — orange
	"#f92672", // compile — pink
	"#ae81ff", // inspect — purple
	"#3a6666", // dsp — teal
	"#a6e22e", // sampler — green
	"#e6db74", // project — yellow
	"#C65638", // script — rust
];

const VERSION = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
const TAGLINE = `command line TUI v${VERSION}`;
const HINT_TEXT = "Type a command or /help to get started";

// Animation params (match the TUI: 80ms tick, 0.02 shift per tick).
const TICK_MS = 80;
const SHIFT_PER_TICK = 0.02;

const LOGO_WIDTH = LOGO_LINES.reduce((m, l) => Math.max(m, l.length), 0);

function lerpHex(a: string, b: string, t: number): string {
	const ar = parseInt(a.slice(1, 3), 16);
	const ag = parseInt(a.slice(3, 5), 16);
	const ab = parseInt(a.slice(5, 7), 16);
	const br = parseInt(b.slice(1, 3), 16);
	const bg = parseInt(b.slice(3, 5), 16);
	const bb = parseInt(b.slice(5, 7), 16);
	const r = Math.round(ar + (br - ar) * t);
	const g = Math.round(ag + (bg - ag) * t);
	const bl = Math.round(ab + (bb - ab) * t);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

function sampleGradient(t: number): string {
	const count = GRADIENT_COLORS.length;
	const wrapped = ((t % count) + count) % count;
	const idx = Math.floor(wrapped);
	const frac = wrapped - idx;
	const a = GRADIENT_COLORS[idx % count]!;
	const b = GRADIENT_COLORS[(idx + 1) % count]!;
	return lerpHex(a, b, frac);
}

export interface LandingLogoWebProps {
	updateInfo?: { latest: string } | null;
}

export function LandingLogoWeb({ updateInfo }: LandingLogoWebProps = {}) {
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		const id = window.setInterval(() => {
			setOffset((prev) => prev + SHIFT_PER_TICK);
		}, TICK_MS);
		return () => window.clearInterval(id);
	}, []);

	return (
		<div className="landing-logo">
			<pre className="landing-logo-art">
				{LOGO_LINES.map((line, row) => (
					<div key={row}>
						{Array.from(line).map((ch, col) => {
							if (ch === " ") return ch;
							const gradPos = offset + (col / LOGO_WIDTH) * 0.6;
							return (
								<span key={col} style={{ color: sampleGradient(gradPos) }}>
									{ch}
								</span>
							);
						})}
					</div>
				))}
			</pre>
			<div className="landing-logo-tagline">{TAGLINE}</div>
			{updateInfo && (
				<div className="landing-logo-update">
					update available: v{updateInfo.latest} — run <code>hise-cli update</code>
				</div>
			)}
			<div className="landing-logo-hint">{HINT_TEXT}</div>
		</div>
	);
}
