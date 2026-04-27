// ── Script log formatter — shared between TUI shell and inline shell ──
//
// Pure functions: ANSI strings out, no React, no Ink.

import type { ColorScheme } from "../theme.js";
import { brand } from "../theme.js";
import type { RunResult, ScriptProgressEvent } from "../../engine/run/types.js";
import { formatResultForLog, filterLogNoise } from "../../engine/run/executor.js";
import { buildModeMap, type ModeMapEntry } from "../../engine/run/mode-map.js";
import { fgHex, bgHex, RESET, type PrerenderedBlock } from "./prerender.js";

/** Render a single script progress event as ANSI output lines. */
export function renderProgressLine(
	event: ScriptProgressEvent,
	scheme: ColorScheme,
	modeMap?: ModeMapEntry[],
): string[] {
	const dimmed = fgHex(scheme.foreground.muted);
	const bg = bgHex(scheme.backgrounds.standard);

	if (event.type === "command") {
		const cmd = event.output;
		if (cmd.label) {
			return [bg + dimmed + "│ ── " + cmd.label + " ──" + RESET];
		}
		if (cmd.result.type === "text" && /^(Entered |Exited |Already in )/.test(cmd.result.content)) {
			return [];
		}
		const val = formatResultForLog(cmd.result);
		if (!val) return [];
		const modeEntry = modeMap && cmd.line > 0 && cmd.line <= modeMap.length
			? modeMap[cmd.line - 1] : undefined;
		const accent = cmd.accent
			?? (modeEntry && modeEntry.modeId !== "root" ? modeEntry.accent : undefined);
		const barColor = accent ? fgHex(accent) : dimmed;
		return val.split("\n").map(line =>
			bg + barColor + "│" + RESET + bg + " " + line + RESET);
	}

	if (event.type === "expect") {
		const e = event.result;
		const icon = e.passed ? "✓" : "✗";
		const color = e.passed ? fgHex(brand.ok) : fgHex(brand.error);
		let line = `${icon} line ${e.line}: ${e.command} is ${e.expected}`;
		if (!e.passed) line += ` — got ${e.actual}`;
		return [bg + color + "│ " + line + RESET];
	}

	if (event.type === "error") {
		const errFg = fgHex(brand.error);
		return [bg + errFg + "│ ✗ " + `ABORTED at line ${event.line}: ${filterLogNoise(event.message)}` + RESET];
	}

	return [];
}

/** Render the summary footer for a completed script run. */
export function renderScriptFooter(
	result: RunResult,
	scheme: ColorScheme,
	actionCount: number,
): string[] {
	const bg = bgHex(scheme.backgrounds.standard);
	const errFg = fgHex(brand.error);
	const okFg = fgHex(brand.ok);
	const passed = result.expects.filter(e => e.passed).length;
	const total = result.expects.length;
	const statusColor = result.ok ? okFg : errFg;
	const statusIcon = result.ok ? "✓" : "✗";
	const parts: string[] = [];
	if (actionCount > 0) parts.push(`${actionCount} command${actionCount !== 1 ? "s" : ""} executed`);
	if (total > 0) parts.push(result.ok ? `PASSED ${passed}/${total}` : `FAILED ${passed}/${total}`);
	return [bg + statusColor + "│ " + statusIcon + " " + parts.join(", ") + RESET, ""];
}

/** Non-streaming fallback: format a complete RunResult as a block. */
export function formatScriptLog(
	source: string,
	result: RunResult,
	scheme: ColorScheme,
): PrerenderedBlock {
	const modeMap = buildModeMap(source.split("\n").map(l => l.trim()));
	const lines: string[] = [];
	let actionCount = 0;
	for (const cmd of result.results) {
		const event: ScriptProgressEvent = { type: "command", output: cmd };
		const rendered = renderProgressLine(event, scheme, modeMap);
		if (rendered.length > 0 && !cmd.label) actionCount++;
		lines.push(...rendered);
	}
	for (const exp of result.expects) {
		lines.push(...renderProgressLine({ type: "expect", result: exp }, scheme));
	}
	if (result.error) {
		lines.push(...renderProgressLine({ type: "error", line: result.error.line, message: result.error.message }, scheme));
	}
	lines.push(...renderScriptFooter(result, scheme, actionCount));
	return { lines, height: lines.length };
}
