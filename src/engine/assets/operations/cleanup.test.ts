import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../../hise.js";
import {
	MockAppDataPaths,
	MockFilesystem,
	MockHttpClient,
	MockZipReader,
} from "../../../mock/assetIo.js";
import type { AssetEnvironment } from "../environment.js";
import { cleanup } from "./cleanup.js";
import { installLogPath, readInstallLog } from "./log.js";

const PROJECT = "/projects/Demo";

function statusFixture() {
	return {
		success: true,
		server: { version: "1.0", buildCommit: "x" },
		project: { name: "Demo", projectFolder: PROJECT, scriptsFolder: `${PROJECT}/Scripts` },
		scriptProcessors: [],
		logs: [],
		errors: [],
	};
}

function makeEnv() {
	const fs = new MockFilesystem();
	const hise = new MockHiseConnection();
	hise.onGet("/api/status", () => statusFixture());
	const env: AssetEnvironment = {
		fs,
		http: new MockHttpClient(),
		zip: new MockZipReader(),
		appData: new MockAppDataPaths(),
		hise,
		now: () => new Date("2026-04-09T14:30:00Z"),
	};
	return { env, fs };
}

const NEEDS_CLEANUP_LOG = JSON.stringify([
	{
		Name: "pkg", Company: "v", Version: "1.0.0",
		Date: "2026-04-09T14:30:00", Mode: "StoreDownload",
		NeedsCleanup: true,
		SkippedFiles: ["/projects/Demo/Scripts/a.js", "/projects/Demo/Images/logo.png"],
	},
]);

describe("cleanup", () => {
	it("deletes existing skipped files and removes the log entry", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), NEEDS_CLEANUP_LOG);
		fs.seedText("/projects/Demo/Scripts/a.js", "x");
		fs.seedText("/projects/Demo/Images/logo.png", "y");

		const r = await cleanup(env, "pkg");
		expect(r.kind).toBe("ok");
		if (r.kind !== "ok") return;
		expect(r.deleted.sort()).toEqual([
			"/projects/Demo/Images/logo.png",
			"/projects/Demo/Scripts/a.js",
		]);
		expect(r.remaining).toEqual([]);
		expect(await readInstallLog(env, PROJECT)).toEqual([]);
	});

	it("treats already-missing files as deleted", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), NEEDS_CLEANUP_LOG);
		// Neither file exists.

		const r = await cleanup(env, "pkg");
		expect(r.kind).toBe("ok");
		if (r.kind !== "ok") return;
		expect(r.deleted).toHaveLength(2);
		expect(await readInstallLog(env, PROJECT)).toEqual([]);
	});

	it("returns notFound when package not in log", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), NEEDS_CLEANUP_LOG);
		const r = await cleanup(env, "missing");
		expect(r).toEqual({ kind: "notFound", package: "missing" });
	});

	it("returns notNeedsCleanup for active entries", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), JSON.stringify([
			{
				Name: "pkg", Company: "v", Version: "1.0.0",
				Date: "2026-04-09T14:30:00", Mode: "StoreDownload",
				Steps: [],
			},
		]));
		const r = await cleanup(env, "pkg");
		expect(r).toEqual({ kind: "notNeedsCleanup", package: "pkg" });
	});
});
