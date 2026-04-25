import { defineConfig } from "vitest/config";

export default defineConfig({
	define: {
		"__APP_VERSION__": '"0.0.0-test"',
	},
	resolve: {
		// Node16 module resolution requires .js extensions on local imports,
		// but vitest needs to resolve them to .ts source files.
		extensions: [".ts", ".tsx", ".js", ".jsx"],
		conditions: ["import", "module", "default"],
	},
	plugins: [
		{
			name: "resolve-js-to-ts",
			resolveId(source, importer) {
				if (
					importer &&
					source.startsWith(".") &&
					source.endsWith(".js")
				) {
					const tsSource = source.replace(/\.js$/, ".ts");
					return this.resolve(tsSource, importer, {
						skipSelf: true,
					});
				}
				if (
					importer &&
					source.startsWith(".") &&
					source.endsWith(".jsx")
				) {
					const tsxSource = source.replace(/\.jsx$/, ".tsx");
					return this.resolve(tsxSource, importer, {
						skipSelf: true,
					});
				}
				return null;
			},
		},
	],
	test: {
		include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"src/tui/screencast/tape-runner.test.ts",
			"src/live-contract/**/*.live.test.ts",
		],
		environment: "node",
		passWithNoTests: true,
	},
});
