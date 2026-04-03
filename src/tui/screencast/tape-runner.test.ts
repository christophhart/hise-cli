// ── Tape screencast tests — real pty execution ──────────────────────
//
// Each .tape file is parsed, run against the real app in a
// pseudo-terminal (via node-pty with --mock), assertions checked,
// and a .cast asciicast file is generated as artifact.
//
// After all tests, generate.py gzips the .cast files and creates
// an index.html preview page.
//
// IMPORTANT: requires `npm run build` before running — the pty
// spawns dist/index.js, not source.

import * as path from "node:path";
import { execSync } from "node:child_process";
import { describe, it, afterAll } from "vitest";
import { testTape } from "./tester.js";

const SCREENCASTS_DIR = path.resolve(import.meta.dirname, "../../../screencasts");

function tape(name: string): string {
	return path.join(SCREENCASTS_DIR, `${name}.tape`);
}

describe("screencasts", () => {
	it("mode-switching", async () => {
		await testTape(tape("mode-switching"));
	}, 30_000);

	it("script-repl", async () => {
		await testTape(tape("script-repl"));
	}, 30_000);

	it("builder-validation", async () => {
		await testTape(tape("builder-validation"));
	}, 30_000);

	it("tab-completion", async () => {
		await testTape(tape("tab-completion"));
	}, 30_000);

	it("builder-tree-expanded", async () => {
		await testTape(tape("builder-tree-expanded"));
	}, 30_000);

	it("builder-execution", async () => {
		await testTape(tape("builder-execution"));
	}, 30_000);

	it("undo-mode", async () => {
		await testTape(tape("undo-mode"));
	}, 30_000);

	afterAll(() => {
		// Gzip .cast files and generate HTML preview page
		const script = path.join(SCREENCASTS_DIR, "generate.py");
		try {
			execSync(`python3 "${script}"`, {
				cwd: SCREENCASTS_DIR,
				stdio: "inherit",
			});
		} catch {
			// Non-fatal — tests pass even if post-processing fails
			console.error("Warning: generate.py failed");
		}
	});
});
