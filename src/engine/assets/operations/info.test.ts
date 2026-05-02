import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../../hise.js";
import {
	MockAppDataPaths,
	MockFilesystem,
	MockHttpClient,
	MockZipReader,
} from "../../../mock/assetIo.js";
import type { AssetEnvironment } from "../environment.js";
import { info } from "./info.js";
import { installLogPath } from "./log.js";
import { writeLocalFolders } from "./local.js";

const PROJECT = "/projects/Demo";

function makeEnv() {
	const fs = new MockFilesystem();
	const hise = new MockHiseConnection();
	hise.onGet("/api/status", () => ({
		success: true,
		server: { version: "1.0", buildCommit: "x" },
		project: { name: "Demo", projectFolder: PROJECT, scriptsFolder: `${PROJECT}/Scripts` },
		scriptProcessors: [],
		logs: [], errors: [],
	}));
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

const PROJECT_XML_V1 = `<?xml version="1.0"?>
<ProjectSettings><Name value="MyLib"/><Version value="1.0.0"/></ProjectSettings>`;

const PROJECT_XML_V2 = `<?xml version="1.0"?>
<ProjectSettings><Name value="MyLib"/><Version value="2.0.0"/></ProjectSettings>`;

describe("info", () => {
	it("Uninstalled when not in log and not local", async () => {
		const { env } = makeEnv();
		const r = await info(env, "MyLib");
		expect(r.state).toBe("Uninstalled");
		expect(r.installed).toBeNull();
		expect(r.local).toBeNull();
	});

	it("UpToDate when installed version equals local version", async () => {
		const { env, fs } = makeEnv();
		fs.seedText("/local/MyLib/project_info.xml", PROJECT_XML_V1);
		await writeLocalFolders(env, ["/local/MyLib"]);
		fs.seedText(installLogPath(PROJECT), JSON.stringify([{
			Name: "MyLib", Company: "v", Version: "1.0.0",
			Date: "2026-01-01T00:00:00", Mode: "LocalFolder", Steps: [],
		}]));
		const r = await info(env, "MyLib");
		expect(r.state).toBe("UpToDate");
		expect(r.installed?.version).toBe("1.0.0");
		expect(r.local?.version).toBe("1.0.0");
	});

	it("UpdateAvailable when local has newer version than installed", async () => {
		const { env, fs } = makeEnv();
		fs.seedText("/local/MyLib/project_info.xml", PROJECT_XML_V2);
		await writeLocalFolders(env, ["/local/MyLib"]);
		fs.seedText(installLogPath(PROJECT), JSON.stringify([{
			Name: "MyLib", Company: "v", Version: "1.0.0",
			Date: "2026-01-01T00:00:00", Mode: "LocalFolder", Steps: [],
		}]));
		const r = await info(env, "MyLib");
		expect(r.state).toBe("UpdateAvailable");
	});

	it("NeedsCleanup overrides version comparison", async () => {
		const { env, fs } = makeEnv();
		fs.seedText("/local/MyLib/project_info.xml", PROJECT_XML_V2);
		await writeLocalFolders(env, ["/local/MyLib"]);
		fs.seedText(installLogPath(PROJECT), JSON.stringify([{
			Name: "MyLib", Company: "v", Version: "1.0.0",
			Date: "2026-01-01T00:00:00", Mode: "LocalFolder",
			NeedsCleanup: true, SkippedFiles: ["/x"],
		}]));
		const r = await info(env, "MyLib");
		expect(r.state).toBe("NeedsCleanup");
		expect(r.installed?.needsCleanup).toBe(true);
	});

	it("Unknown when installed but no local source available", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(installLogPath(PROJECT), JSON.stringify([{
			Name: "MyLib", Company: "v", Version: "1.0.0",
			Date: "2026-01-01T00:00:00", Mode: "StoreDownload", Steps: [],
		}]));
		const r = await info(env, "MyLib");
		expect(r.state).toBe("Unknown");
	});
});
