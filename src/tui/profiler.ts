// ── Render profiler — conditional React.Profiler logging ────────────
//
// Activated by --profile CLI flag. Writes per-render timing to a JSONL
// file and prints a summary to stderr on process exit.
//
// Usage:
//   npm run dev:profile    (or: node dist/index.js --profile)
//   # scroll around, then Ctrl+C
//   # summary printed to stderr, full log at profile.jsonl

import * as fs from "node:fs";
import * as path from "node:path";

export const PROFILING_ENABLED = process.argv.includes("--profile");

interface ProfileEntry {
	id: string;
	phase: string;
	actualMs: number;
	baseMs: number;
	startMs: number;
	commitMs: number;
	ts: number;
}

let entries: ProfileEntry[] = [];
let logStream: fs.WriteStream | null = null;

if (PROFILING_ENABLED) {
	const logPath = path.resolve("profile.jsonl");
	logStream = fs.createWriteStream(logPath, { flags: "w" });
	process.stderr.write(`[profiler] Writing render timings to ${logPath}\n`);

	process.on("exit", () => {
		logStream?.end();
		printSummary();
	});
}

export function onRenderCallback(
	id: string,
	phase: "mount" | "update" | "nested-update",
	actualDuration: number,
	baseDuration: number,
	startTime: number,
	commitTime: number,
): void {
	if (!PROFILING_ENABLED) return;

	const entry: ProfileEntry = {
		id,
		phase,
		actualMs: Math.round(actualDuration * 100) / 100,
		baseMs: Math.round(baseDuration * 100) / 100,
		startMs: Math.round(startTime * 100) / 100,
		commitMs: Math.round(commitTime * 100) / 100,
		ts: Date.now(),
	};
	entries.push(entry);
	logStream?.write(JSON.stringify(entry) + "\n");
}

function printSummary(): void {
	if (entries.length === 0) {
		process.stderr.write("[profiler] No renders recorded.\n");
		return;
	}

	// Group by id
	const byId = new Map<string, ProfileEntry[]>();
	for (const e of entries) {
		const list = byId.get(e.id) || [];
		list.push(e);
		byId.set(e.id, list);
	}

	process.stderr.write("\n[profiler] ── Render Summary ──────────────────\n");

	for (const [id, list] of byId) {
		const mounts = list.filter(e => e.phase === "mount");
		const updates = list.filter(e => e.phase !== "mount");
		const actuals = updates.map(e => e.actualMs).sort((a, b) => a - b);

		if (actuals.length === 0) {
			process.stderr.write(`  ${id}: ${mounts.length} mount(s), no updates\n`);
			continue;
		}

		const min = actuals[0]!;
		const max = actuals[actuals.length - 1]!;
		const median = actuals[Math.floor(actuals.length / 2)]!;
		const p95 = actuals[Math.floor(actuals.length * 0.95)]!;
		const avg = actuals.reduce((s, v) => s + v, 0) / actuals.length;
		const slow = actuals.filter(v => v > 16).length; // > 16ms = dropped frame at 60fps

		process.stderr.write(
			`  ${id}: ${updates.length} updates — ` +
			`min ${min.toFixed(1)}ms, median ${median.toFixed(1)}ms, ` +
			`p95 ${p95.toFixed(1)}ms, max ${max.toFixed(1)}ms, ` +
			`avg ${avg.toFixed(1)}ms` +
			(slow > 0 ? `, ${slow} >16ms` : "") +
			"\n",
		);
	}

	process.stderr.write(`  Total renders: ${entries.length}\n`);
	process.stderr.write("[profiler] ────────────────────────────────────\n");
}
