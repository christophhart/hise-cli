import { build } from "esbuild";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Ink conditionally imports its optional React DevTools peer when DEV=true.
// esbuild still resolves that dynamic module while producing release bundles,
// even though release binaries never enable it. Replace it with a no-op so
// standalone builds do not depend on an optional development-only package.
const disableReactDevtools = {
	name: "disable-react-devtools",
	setup(build) {
		const namespace = "disabled-react-devtools";
		build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
			path: "react-devtools-core",
			namespace,
		}));
		build.onLoad({ filter: /.*/, namespace }, () => ({
			contents: "export default { initialize() {}, connectToDevTools() {} };",
			loader: "js",
		}));
	},
};

// Bun does not currently implement worker_threads.markAsUncloneable, which
// undici uses only to prevent structured-cloning certain web objects. Keep
// the native implementation when available and make the unsupported call a
// no-op otherwise.
const undiciBunCompatibility = {
	name: "undici-mark-as-uncloneable-fallback",
	setup(build) {
		build.onLoad({ filter: /[\\/]undici[\\/]lib[\\/]web[\\/]webidl[\\/]index\.js$/ }, ({ path }) => {
			const source = readFileSync(path, "utf8");
			const target = "const { markAsUncloneable } = require('node:worker_threads')";
			if (!source.includes(target)) {
				throw new Error(`Expected undici worker_threads import not found in ${path}`);
			}
			return {
				contents: source.replace(target, "const { markAsUncloneable = () => {} } = require('node:worker_threads')"),
				loader: "js",
			};
		});
	},
};

{
	const result = spawnSync(process.execPath, ["scripts/generate-agent-context.mjs"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.stderr.write("[build] agent context generation failed\n");
		process.exit(1);
	}
}

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

// Build the docs-site embed bundle (browser-targeted ESM).
{
	const result = spawnSync(process.execPath, ["scripts/build-embed.mjs"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.stderr.write("[build] embed build failed\n");
		process.exit(1);
	}
}

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
		".html": "text",
	},
	plugins: [disableReactDevtools, undiciBunCompatibility],
	sourcemap: false,
	logLevel: "info",
});

try {
	chmodSync("dist/index.js", 0o755);
} catch {
	// Best effort on Windows.
}
