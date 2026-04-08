import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// ── Renderer selection ──────────────────────────────────────────────
// Both renderers are bundled; runtime detection picks the right one.
// Pass --ink to force stock Ink only (disables Rezi at build time).
const useInk = process.argv.includes("--ink");
const useRezi = !useInk;

// ── Ink shim plugin ─────────────────────────────────────────────────
// Third-party packages (in node_modules/) that import "ink" get
// redirected to src/tui/ink-shim.ts, which provides runtime-dispatched
// exports (Rezi or stock Ink depending on terminal capabilities).
// Our own "ink-stock" import resolves to real "ink" via alias + external.
const inkShimPlugin = {
	name: "ink-shim-redirect",
	setup(build) {
		build.onResolve({ filter: /^ink$/ }, (args) => {
			if (args.importer.includes("node_modules")) {
				return { path: resolve("src/tui/ink-shim.ts") };
			}
			return null;
		});
	},
};

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
	plugins: useRezi ? [inkShimPlugin] : [],
	// Rezi mode: "ink-stock" → "ink" lets the shim import real Ink for
	// fallback.  Third-party "ink" imports are handled by inkShimPlugin
	// (redirected to the shim), NOT aliased to Rezi at build time.
	// --ink mode: only stock Ink, everything bundled.
	external: useRezi
		? ["@rezi-ui/ink-compat", "@rezi-ui/native", "ink", "react", "react-reconciler"]
		: [],
	...(useRezi ? { alias: { "ink-stock": "ink" } } : {}),
	sourcemap: false,
	logLevel: "info",
});

try {
	chmodSync("dist/index.js", 0o755);
} catch {
	// Best effort on Windows.
}

console.log(`  renderer: ${useRezi ? "runtime dispatch (Rezi + Ink)" : "stock Ink"}`);
