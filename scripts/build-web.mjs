// ── Build pipeline for the --web frontend SPA ───────────────────────
//
// 1. esbuild bundles src/web/client/main.tsx → dist/web/main.js
// 2. Copies index.html → dist/web/index.html
// 3. Copies node_modules/monaco-editor/min/vs/ → dist/web/vs/
// 4. Future: emit src/web/embedded-assets.ts for `bun build --compile`

import { build } from "esbuild";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const out = resolve(root, "dist", "web");
const watch = process.argv.includes("--watch");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// ── 1. Bundle the React SPA ─────────────────────────────────────────

const buildOptions = {
	entryPoints: [resolve(root, "src", "web", "client", "main.tsx")],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	jsx: "automatic",
	jsxImportSource: "react",
	minify: !watch,
	sourcemap: watch ? "inline" : false,
	splitting: false,
	outfile: resolve(out, "main.js"),
	// monaco-editor is loaded at runtime via the AMD loader (vs/loader.js)
	// which handles its own worker bootstrapping. Mark as external so
	// esbuild doesn't try to bundle it (its ESM bundle requires Vite/Webpack
	// worker plugins we don't have).
	external: ["monaco-editor"],
	loader: {
		".css": "css",
		".png": "file",
		".svg": "file",
		".woff": "file",
		".woff2": "file",
		".ttf": "file",
	},
	define: {
		"process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production"),
	},
	logLevel: "info",
};

if (watch) {
	const ctx = await (await import("esbuild")).context(buildOptions);
	await ctx.watch();
	console.log("[build-web] watching for changes...");
} else {
	await build(buildOptions);
}

// ── 2. Emit index.html ──────────────────────────────────────────────

const htmlSrc = resolve(root, "src", "web", "client", "index.html");
const htmlDst = resolve(out, "index.html");
if (existsSync(htmlSrc)) {
	const html = readFileSync(htmlSrc, "utf-8");
	writeFileSync(htmlDst, html);
} else {
	writeFileSync(
		htmlDst,
		`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>hise-cli</title>
    <link rel="stylesheet" href="/main.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`,
	);
}

// ── 3. Copy Monaco vs/ ──────────────────────────────────────────────

const vsSrc = resolve(root, "node_modules", "monaco-editor", "min", "vs");
const vsDst = resolve(out, "vs");
if (existsSync(vsSrc)) {
	cpSync(vsSrc, vsDst, { recursive: true });
	console.log(`[build-web] copied monaco vs/ → ${vsDst}`);
} else {
	console.warn(`[build-web] monaco-editor not installed; skipping vs/ copy`);
}

console.log(`[build-web] dist → ${out}`);
