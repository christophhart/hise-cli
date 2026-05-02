import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../../hise.js";
import {
	MockAppDataPaths,
	MockFilesystem,
	MockHttpClient,
	MockZipReader,
} from "../../../mock/assetIo.js";
import type { AssetEnvironment } from "../environment.js";
import { tokenFilePath } from "./auth.js";
import { listInstalled, listLocal, listStore } from "./list.js";
import { installLogPath } from "./log.js";
import { writeLocalFolders } from "./local.js";

const PROJECT = "/projects/Demo";

function makeEnv() {
	const fs = new MockFilesystem();
	const hise = new MockHiseConnection();
	const http = new MockHttpClient();
	hise.onGet("/api/status", () => ({
		success: true,
		server: { version: "1.0", buildCommit: "x" },
		project: { name: "Demo", projectFolder: PROJECT, scriptsFolder: `${PROJECT}/Scripts` },
		scriptProcessors: [],
		logs: [], errors: [],
	}));
	const env: AssetEnvironment = {
		fs,
		http,
		zip: new MockZipReader(),
		appData: new MockAppDataPaths(),
		hise,
		now: () => new Date("2026-04-09T14:30:00Z"),
	};
	return { env, fs, http, hise };
}

describe("listInstalled", () => {
	it("returns empty when log absent", async () => {
		const { env } = makeEnv();
		expect(await listInstalled(env)).toEqual([]);
	});

	it("summarizes active and needsCleanup entries", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), JSON.stringify([
			{ Name: "a", Company: "v", Version: "1.0.0", Date: "2026-01-01T00:00:00", Mode: "StoreDownload", Steps: [] },
			{ Name: "b", Company: "v", Version: "0.9.0", Date: "2026-01-01T00:00:00", Mode: "LocalFolder", NeedsCleanup: true, SkippedFiles: [] },
		]));
		const r = await listInstalled(env);
		expect(r).toEqual([
			{ name: "a", company: "v", version: "1.0.0", date: "2026-01-01T00:00:00", mode: "StoreDownload", needsCleanup: false },
			{ name: "b", company: "v", version: "0.9.0", date: "2026-01-01T00:00:00", mode: "LocalFolder", needsCleanup: true },
		]);
	});
});

describe("listLocal", () => {
	it("returns describeLocalFolder for each registered folder", async () => {
		const { env, fs } = makeEnv();
		fs.seedText("/local/MyLib/project_info.xml", `<?xml version="1.0"?>
<ProjectSettings>
  <Name value="MyLib"/>
  <Version value="2.0"/>
</ProjectSettings>`);
		fs.seedText("/local/MyLib/user_info.xml", `<?xml version="1.0"?>
<UserInfo><Company value="vendor"/></UserInfo>`);
		await writeLocalFolders(env, ["/local/MyLib"]);

		const r = await listLocal(env);
		expect(r).toEqual([{
			folder: "/local/MyLib",
			name: "MyLib",
			version: "2.0",
			company: "vendor",
		}]);
	});
});

describe("listStore", () => {
	it("returns catalog with owned=null when no token", async () => {
		const { env, http } = makeEnv();
		http.onGet("https://store.hise.dev/api/products/", () => ({
			status: 200,
			body: JSON.stringify([{
				product_name: "Synth", repo_link: "https://git.hise.dev/v/r",
			}]),
		}));
		const r = await listStore(env);
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({
			productName: "Synth",
			vendor: "v",
			repoId: "r",
			owned: null,
		});
	});

	it("annotates ownership when token present", async () => {
		const { env, fs, http } = makeEnv();
		fs.seedText(tokenFilePath(env), "good-token");
		http.onGet("https://store.hise.dev/api/products/", () => ({
			status: 200,
			body: JSON.stringify([
				{ product_name: "Owned", repo_link: "https://git.hise.dev/v/owned" },
				{ product_name: "NotOwned", repo_link: "https://git.hise.dev/v/notowned" },
			]),
		}));
		http.onGet("https://git.hise.dev/api/v1/user/repos", () => ({
			status: 200,
			body: JSON.stringify([
				{ name: "owned", owner: { username: "v" }, url: "https://git.hise.dev/api/v1/repos/v/owned" },
			]),
		}));
		const r = await listStore(env);
		expect(r.find((p) => p.repoId === "owned")?.owned).toBe(true);
		expect(r.find((p) => p.repoId === "notowned")?.owned).toBe(false);
	});

	it("throws on store catalog HTTP error", async () => {
		const { env, http } = makeEnv();
		http.onGet("https://store.hise.dev/api/products/", () => ({ status: 500, body: "" }));
		await expect(listStore(env)).rejects.toThrow(/HTTP 500/);
	});
});
