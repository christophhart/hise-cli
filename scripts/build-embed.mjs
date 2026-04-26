// ── Build pipeline for the docs-site embed bundle ───────────────────
//
// 1. esbuild bundles src/web-embed/index.ts → dist/embed/hise-embed.js
//    (browser-targeted ESM, no React/Ink/Monaco)
// 2. Copies the runtime-required dataset JSONs to dist/embed/data/
//    (skips scripting_api.json — only needed for HiseScript completion)
//
// Output is meant to be served as static files (CDN / docs site /assets).

import { build } from "esbuild";
import {
	copyFileSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "dist", "embed");
const dataOut = resolve(out, "data");
const dataIn = resolve(root, "data");
const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(dataOut, { recursive: true });

// ── 1. Bundle the embed entry ───────────────────────────────────────

const buildOptions = {
	entryPoints: [resolve(root, "src", "web-embed", "index.ts")],
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	minify: !watch,
	sourcemap: true,
	splitting: false,
	outfile: resolve(out, "hise-embed.js"),
	define: {
		"__APP_VERSION__": JSON.stringify(pkg.version),
	},
	logLevel: "info",
};

if (watch) {
	const ctx = await (await import("esbuild")).context(buildOptions);
	await ctx.watch();
	console.log("[build-embed] watching for changes...");
} else {
	await build(buildOptions);
}

// ── 2. Copy dataset JSONs ───────────────────────────────────────────

const datasets = [
	"moduleList.json",
	"scriptnodeList.json",
	"ui_component_properties.json",
];

for (const file of datasets) {
	const src = resolve(dataIn, file);
	const dst = resolve(dataOut, file);
	copyFileSync(src, dst);
	const sizeKb = (statSync(dst).size / 1024).toFixed(1);
	console.log(`[build-embed] copied ${file} (${sizeKb} KB)`);
}

// ── 3. Report bundle size ───────────────────────────────────────────

if (!watch) {
	const bundleSize = statSync(resolve(out, "hise-embed.js")).size;
	console.log(
		`[build-embed] bundle: ${(bundleSize / 1024).toFixed(1)} KB → ${out}`,
	);
}
