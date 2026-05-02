import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../hise.js";
import {
	MockAppDataPaths,
	MockFilesystem,
	MockHttpClient,
	MockZipReader,
} from "../../mock/assetIo.js";
import type { AssetEnvironment } from "../assets/environment.js";
import { AssetsMode } from "./assets.js";
import type { Mode, SessionContext } from "./mode.js";

const PROJECT = "/projects/Demo";

function statusFixture() {
	return {
		success: true,
		server: { version: "1.0", buildCommit: "x" },
		project: { name: "Demo", projectFolder: PROJECT, scriptsFolder: `${PROJECT}/Scripts` },
		scriptProcessors: [],
		logs: [], errors: [],
	};
}

function makeEnv(): { env: AssetEnvironment; fs: MockFilesystem; http: MockHttpClient } {
	const fs = new MockFilesystem();
	const http = new MockHttpClient();
	const hise = new MockHiseConnection();
	hise.onGet("/api/status", () => statusFixture());
	const env: AssetEnvironment = {
		fs,
		http,
		zip: new MockZipReader(),
		appData: new MockAppDataPaths(),
		hise,
		now: () => new Date("2026-04-09T14:30:00Z"),
	};
	return { env, fs, http };
}

const dummySession = {} as SessionContext;

describe("AssetsMode.parse", () => {
	it("help returns markdown listing commands", async () => {
		const mode = new AssetsMode(null);
		const r = await mode.parse("help", dummySession);
		expect(r.type).toBe("markdown");
		if (r.type !== "markdown") return;
		expect(r.content).toMatch(/Assets Commands/);
	});

	it("returns error when no env wired and command needs work", async () => {
		const mode = new AssetsMode(null);
		const r = await mode.parse("list", dummySession);
		expect(r.type).toBe("error");
	});

	it("error variant on bad input", async () => {
		const { env } = makeEnv();
		const mode = new AssetsMode(env);
		const r = await mode.parse("explode pkg", dummySession);
		expect(r.type).toBe("error");
	});

	it("list installed via env", async () => {
		const { env } = makeEnv();
		const mode = new AssetsMode(env);
		const r = await mode.parse("list installed", dummySession);
		expect(r.type).toBe("markdown");
		if (r.type !== "markdown") return;
		expect(r.content).toMatch(/Installed/);
	});

	it("auth login without --token returns error", async () => {
		const { env } = makeEnv();
		const mode = new AssetsMode(env);
		const r = await mode.parse("auth login", dummySession);
		expect(r.type).toBe("error");
	});

	it("auth login with --token persists and returns ok", async () => {
		const { env, http } = makeEnv();
		http.onGet("https://git.hise.dev/api/v1/user", () => ({
			status: 200,
			body: JSON.stringify({ username: "vendor", email: "v@example.com" }),
		}));
		const mode = new AssetsMode(env);
		const r = await mode.parse("auth login --token=abc", dummySession);
		expect(r.type).toBe("markdown");
		if (r.type !== "markdown") return;
		expect(r.content).toMatch(/Logged in as/);
	});

	it("info returns markdown with state", async () => {
		const { env } = makeEnv();
		const mode = new AssetsMode(env);
		const r = await mode.parse("info pkg", dummySession);
		expect(r.type).toBe("markdown");
		if (r.type !== "markdown") return;
		expect(r.content).toMatch(/Uninstalled/);
	});

	it("uninstall returns notFound error for missing package", async () => {
		const { env } = makeEnv();
		const mode = new AssetsMode(env);
		const r = await mode.parse("uninstall ghost", dummySession);
		expect(r.type).toBe("error");
	});
});

describe("AssetsMode interface", () => {
	it("has expected id and accent", () => {
		const mode: Mode = new AssetsMode(null);
		expect(mode.id).toBe("assets");
		expect(mode.name).toBe("Assets");
		expect(mode.accent.startsWith("#")).toBe(true);
	});

	it("tokenizeInput recognises subcommand keywords", () => {
		const mode = new AssetsMode(null);
		const tokens = mode.tokenizeInput?.("install pkg --dry-run") ?? [];
		const installSpan = tokens.find((t) => t.text.startsWith("install"));
		expect(installSpan?.token).toBe("keyword");
		const flagSpan = tokens.find((t) => t.text === "--dry-run");
		expect(flagSpan?.token).toBe("keyword");
	});

	it("complete returns assets-mode items", () => {
		// CompletionEngine import is heavy; emulate the engine's contract minimally.
		const stubEngine = {
			completeAssets: (prefix: string) => [
				{ label: "list" }, { label: "install" }, { label: "info" },
			].filter((i) => i.label.startsWith(prefix)),
		} as unknown as import("../completion/engine.js").CompletionEngine;
		const mode = new AssetsMode(null, stubEngine);
		const r = mode.complete!("inst", 4);
		const labels = r.items.map((i) => i.label);
		expect(labels).toContain("install");
		expect(labels).not.toContain("list");
	});
});
