import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

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
	sourcemap: false,
	logLevel: "info",
});

try {
	chmodSync("dist/index.js", 0o755);
} catch {
	// Best effort on Windows.
}
