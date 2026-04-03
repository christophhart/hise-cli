import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		extensions: [".ts", ".tsx", ".js", ".jsx"],
		conditions: ["import", "module", "default"],
	},
	plugins: [
		{
			name: "resolve-js-to-ts",
			resolveId(source, importer) {
				if (importer && source.startsWith(".") && source.endsWith(".js")) {
					return this.resolve(source.replace(/\.js$/, ".ts"), importer, { skipSelf: true });
				}
				if (importer && source.startsWith(".") && source.endsWith(".jsx")) {
					return this.resolve(source.replace(/\.jsx$/, ".tsx"), importer, { skipSelf: true });
				}
				return null;
			},
		},
	],
	test: {
		include: ["src/tui/screencast/tape-runner.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		testTimeout: 60_000,
	},
});
