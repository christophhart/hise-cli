#!/usr/bin/env node
// ── Sync src/engine/highlight/ → highlight-export/ ──────────────────
//
// Copies the highlighter source dir verbatim (minus tests and terminal-
// only split.ts) into highlight-export/ for consumption by the docs
// website. Since `src/engine/highlight/` is fully self-contained (no
// imports outside the directory), this is a pure file copy — no
// patching needed.
//
// Usage: node scripts/export-highlight.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "src", "engine", "highlight");
const DEST = join(ROOT, "highlight-export");

// Files to exclude from export
const EXCLUDE = new Set([
	"split.ts",          // terminal viewport slicing — not needed for docs fences
]);

const EXCLUDE_SUFFIX = [".test.ts"];

function shouldCopy(filename) {
	if (EXCLUDE.has(filename)) return false;
	if (EXCLUDE_SUFFIX.some((s) => filename.endsWith(s))) return false;
	return filename.endsWith(".ts");
}

mkdirSync(DEST, { recursive: true });

const files = readdirSync(SRC).filter(shouldCopy);
let copied = 0;

for (const file of files) {
	const srcPath = join(SRC, file);
	const destPath = join(DEST, file);
	if (!statSync(srcPath).isFile()) continue;
	const content = readFileSync(srcPath, "utf8");
	writeFileSync(destPath, content);
	copied++;
	console.log(`  ${file}`);
}

console.log(`\nExported ${copied} file(s) to ${DEST}`);
