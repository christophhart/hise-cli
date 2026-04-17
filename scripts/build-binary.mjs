#!/usr/bin/env node
// Produces standalone binaries using bun build --compile.
// Uses the esbuild output (dist/index.js) as input — Bun acts purely
// as a JS-to-EXE compiler.
//
// Usage:
//   node scripts/build-binary.mjs                     # all targets
//   node scripts/build-binary.mjs --target bun-darwin-arm64  # single target

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const args = process.argv.slice(2);

const targets = [
	"bun-darwin-arm64",
	"bun-darwin-x64",
	"bun-linux-x64",
	"bun-windows-x64",
];

const requestedTarget = args.includes("--target")
	? args[args.indexOf("--target") + 1]
	: null;

const buildTargets = requestedTarget ? [requestedTarget] : targets;

for (const target of buildTargets) {
	const ext = target.includes("windows") ? ".exe" : "";
	const outName = requestedTarget
		? `dist/hise-cli${ext}`
		: `dist/hise-cli-${target}${ext}`;

	const cmd = [
		"bun", "build", "--compile",
		"--minify",
		"--target", target,
		"--define", `__APP_VERSION__='"${pkg.version}"'`,
		"--outfile", outName,
		"dist/index.js",
	].join(" ");

	console.log(`Building ${target}...`);
	execSync(cmd, { stdio: "inherit" });
	console.log(`  → ${outName}`);
}
