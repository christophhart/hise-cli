import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../../hise.js";
import { MockAppDataPaths, MockFilesystem, MockHttpClient, MockZipReader } from "../../../mock/assetIo.js";
import type { AssetEnvironment } from "../environment.js";
import { login, logout, readStoredToken, tokenFilePath } from "./auth.js";

function makeEnv(): { env: AssetEnvironment; fs: MockFilesystem; http: MockHttpClient } {
	const fs = new MockFilesystem();
	const http = new MockHttpClient();
	const env: AssetEnvironment = {
		fs,
		http,
		zip: new MockZipReader(),
		appData: new MockAppDataPaths(),
		hise: new MockHiseConnection(),
		now: () => new Date("2026-04-09T14:30:00Z"),
	};
	return { env, fs, http };
}

describe("readStoredToken", () => {
	it("returns null when file missing", async () => {
		const { env } = makeEnv();
		expect(await readStoredToken(env)).toBeNull();
	});

	it("returns trimmed contents", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(tokenFilePath(env), "  abc123\n");
		expect(await readStoredToken(env)).toBe("abc123");
	});

	it("returns null on empty/whitespace file", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(tokenFilePath(env), "   \n");
		expect(await readStoredToken(env)).toBeNull();
	});
});

describe("login", () => {
	it("rejects empty token without HTTP call", async () => {
		const { env } = makeEnv();
		const r = await login(env, "");
		expect(r).toEqual({ kind: "invalidToken", message: "Token is empty" });
	});

	it("persists token and returns user on 200", async () => {
		const { env, http, fs } = makeEnv();
		http.onGet("https://git.hise.dev/api/v1/user", (req) => {
			expect(req.headers?.Authorization).toBe("Bearer good-token");
			return { status: 200, body: JSON.stringify({ username: "vendor", email: "vendor@example.com" }) };
		});
		const r = await login(env, "good-token");
		expect(r.kind).toBe("ok");
		if (r.kind !== "ok") return;
		expect(r.user.displayName).toBe("vendor@example.com");
		expect(await fs.readText(tokenFilePath(env))).toBe("good-token");
	});

	it("does not persist on 401", async () => {
		const { env, http, fs } = makeEnv();
		http.onGet("https://git.hise.dev/api/v1/user", () => ({ status: 401, body: "" }));
		const r = await login(env, "bad-token");
		expect(r).toEqual({ kind: "invalidToken", message: "Invalid token" });
		expect(await fs.exists(tokenFilePath(env))).toBe(false);
	});

	it("treats other non-200 as networkError", async () => {
		const { env, http } = makeEnv();
		http.onGet("https://git.hise.dev/api/v1/user", () => ({ status: 500, body: "" }));
		const r = await login(env, "x");
		expect(r.kind).toBe("networkError");
	});

	it("trims whitespace before posting", async () => {
		const { env, http, fs } = makeEnv();
		let received = "";
		http.onGet("https://git.hise.dev/api/v1/user", (req) => {
			received = req.headers?.Authorization ?? "";
			return { status: 200, body: JSON.stringify({ username: "u" }) };
		});
		await login(env, "  spaced  ");
		expect(received).toBe("Bearer spaced");
		expect(await fs.readText(tokenFilePath(env))).toBe("spaced");
	});
});

describe("logout", () => {
	it("deletes token file when present", async () => {
		const { env, fs } = makeEnv();
		fs.seedText(tokenFilePath(env), "abc");
		await logout(env);
		expect(await fs.exists(tokenFilePath(env))).toBe(false);
	});

	it("is a no-op when token absent", async () => {
		const { env } = makeEnv();
		await expect(logout(env)).resolves.toBeUndefined();
	});
});
