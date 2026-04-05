import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// ── Renderer selection ──────────────────────────────────────────────
// Pass --ink to build with stock Ink renderer (default: Rezi ink-compat)
const useInk = process.argv.includes("--ink");
const useRezi = !useInk;

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "node",
	target: "node18",
	format: "esm",
	outfile: "dist/index.js",
	banner: {
		js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
	},
	define: {
		"__APP_VERSION__": JSON.stringify(pkg.version),
		"__REZI_COMPAT__": String(useRezi),
	},
	loader: {
		".yaml": "text",
	},
	// Rezi mode: alias ink → ink-compat, externalize ink-compat + React (single-copy requirement).
	// Ink mode: everything bundled.
	external: useRezi
		? ["@rezi-ui/ink-compat", "@rezi-ui/native", "react", "react-reconciler"]
		: [],
	...(useRezi ? { alias: { "ink": "@rezi-ui/ink-compat" } } : {}),
	sourcemap: false,
	logLevel: "info",
});

try {
	chmodSync("dist/index.js", 0o755);
} catch {
	// Best effort on Windows.
}

console.log(`  renderer: ${useRezi ? "Rezi ink-compat" : "stock Ink"}`);
