// ── Pretty CLI output — render CliOutputPayload as ANSI/plain text ───
//
// Triggered by `--pretty` flag. JSON output is the default for LLM
// consumers; pretty mode is for humans reading terminal output.

import chalk from "chalk";
import type { CommandResult } from "../engine/result.js";
import { formatRunReport } from "../engine/run/executor.js";
import { renderMarkdown } from "../tui/markdown.js";
import { defaultScheme } from "../tui/theme.js";
import type { CliOutputPayload } from "./output.js";

interface PayloadWithResult { ok: boolean; result: CommandResult }
interface PayloadWithError { ok: false; error: string }
interface PayloadWithValue { ok: true; logs?: string[]; value?: unknown }

function hasResult(p: CliOutputPayload): p is PayloadWithResult {
	return typeof p === "object" && p !== null && "result" in p;
}

function hasError(p: CliOutputPayload): p is PayloadWithError {
	return typeof p === "object" && p !== null && "error" in p && (p as { ok?: boolean }).ok === false;
}

function hasValue(p: CliOutputPayload): p is PayloadWithValue {
	return typeof p === "object" && p !== null && !("result" in p) && !("error" in p);
}

const TERM_WIDTH = (process.stdout.columns && process.stdout.columns > 0) ? process.stdout.columns : 80;

export function renderPretty(payload: CliOutputPayload): string {
	if (hasResult(payload)) {
		return renderResult(payload.result).replace(/\n+$/, "");
	}
	if (hasError(payload)) {
		return chalk.red(payload.error);
	}
	if (hasValue(payload)) {
		const parts: string[] = [];
		if (payload.logs && payload.logs.length > 0) {
			parts.push(payload.logs.join("\n"));
		}
		if (payload.value !== undefined) {
			parts.push(typeof payload.value === "string" ? payload.value : JSON.stringify(payload.value, null, 2));
		}
		return parts.join("\n");
	}
	return JSON.stringify(payload, null, 2);
}

function renderResult(result: CommandResult): string {
	switch (result.type) {
		case "text":
			return result.content;
		case "error":
			return result.detail
				? `${chalk.red(result.message)}\n${chalk.gray(result.detail)}`
				: chalk.red(result.message);
		case "code":
			return result.content;
		case "markdown":
			return renderMarkdown(result.content, {
				scheme: defaultScheme,
				accent: result.accent,
				width: TERM_WIDTH,
			});
		case "preformatted":
			return result.content;
		case "table":
			return renderTable(result.headers, result.rows);
		case "wizard":
			return chalk.yellow(`Wizard: ${result.definition.header ?? result.definition.id} (interactive — run via TUI or use /wizard run)`);
		case "run-report":
			return formatRunReport(result.runResult, result.verbosity);
		case "empty":
			return "";
	}
}

function renderTable(headers: string[], rows: string[][]): string {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map(r => (r[i] ?? "").length)));
	const fmt = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
	const lines = [chalk.bold(fmt(headers)), chalk.gray(widths.map(w => "─".repeat(w)).join("  "))];
	for (const row of rows) lines.push(fmt(row));
	return lines.join("\n");
}
