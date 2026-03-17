// ── Tape Tester — vitest wrapper: parse → run → assert → write .cast ─

import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { parseTape } from "../../engine/screencast/tape-parser.js";
import { runTape, type RunnerConfig } from "./runner.js";
import {
	writeAsciicast,
	castPathFromTape,
	titleFromTapePath,
} from "./writer.js";

// ── Types ───────────────────────────────────────────────────────────

export interface TestTapeOptions {
	/** Directory to write .cast files. Defaults to same dir as .tape. */
	castDir?: string;
	/** Include input events in .cast file. */
	includeInputEvents?: boolean;
	/** Skip writing .cast file (test assertions only). */
	skipCast?: boolean;
	/** Extra runner config (entryPoint, extraArgs, etc.). */
	runner?: Partial<RunnerConfig>;
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Parse a .tape file, run it against the real app via pty,
 * check all assertions, and write a .cast file as artifact.
 *
 * Usage in vitest:
 * ```ts
 * it("mode-switching", () => testTape("screencasts/mode-switching.tape"));
 * ```
 */
export async function testTape(
	tapePath: string,
	options?: TestTapeOptions,
): Promise<void> {
	// ── Parse ────────────────────────────────────────────────────────

	const absolutePath = path.isAbsolute(tapePath)
		? tapePath
		: path.resolve(tapePath);

	const source = fs.readFileSync(absolutePath, "utf8");
	const { commands, errors } = parseTape(source);

	// Parse errors are a hard fail
	expect(errors, `Parse errors in ${path.basename(tapePath)}`).toHaveLength(0);
	expect(commands.length, `No commands in ${path.basename(tapePath)}`).toBeGreaterThan(0);

	// ── Run ──────────────────────────────────────────────────────────

	const result = await runTape(commands, options?.runner);

	// ── Write .cast (before assertions — always produce the file) ───

	if (!options?.skipCast) {
		const castPath = options?.castDir
			? path.join(options.castDir, path.basename(castPathFromTape(tapePath)))
			: castPathFromTape(absolutePath);

		writeAsciicast(result, castPath, {
			title: titleFromTapePath(tapePath),
			includeInputEvents: options?.includeInputEvents,
		});
	}

	// ── Assert ───────────────────────────────────────────────────────

	const failures: string[] = [];

	for (const assertion of result.assertions) {
		if (!assertion.pass) {
			failures.push(assertion.message);
		}
	}

	if (failures.length > 0) {
		expect.fail(
			`${failures.length} assertion(s) failed in ${path.basename(tapePath)}:\n` +
			failures.map((f, i) => `  ${i + 1}. ${f}`).join("\n"),
		);
	}
}
