import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// ── Renderer selection ──────────────────────────────────────────────
// Both renderers are bundled; runtime detection picks the right one.
// Pass --ink to force stock Ink only (disables Rezi at build time).
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
	},
	loader: {
		".yaml": "text",
	},
	// Rezi mode: two aliases for runtime renderer dispatch.
	//   "ink" → "@rezi-ui/ink-compat"  (third-party packages get Rezi)
	//   "ink-stock" → "ink"            (shim imports real Ink for fallback)
	// --ink mode: only stock Ink, everything bundled.
	external: useRezi
		? ["@rezi-ui/ink-compat", "@rezi-ui/native", "ink", "ink-stock", "react", "react-reconciler"]
		: [],
	...(useRezi ? { alias: { "ink-stock": "ink", "ink": "@rezi-ui/ink-compat" } } : {}),
	sourcemap: false,
	logLevel: "info",
});

try {
	chmodSync("dist/index.js", 0o755);
} catch {
	// Best effort on Windows.
}

console.log(`  renderer: ${useRezi ? "runtime dispatch (Rezi + Ink)" : "stock Ink"}`);
