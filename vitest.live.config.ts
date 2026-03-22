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
		include: ["src/live-contract/**/*.live.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		passWithNoTests: true,
	},
});
