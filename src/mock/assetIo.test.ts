import { describe, expect, it } from "vitest";
import { MockFilesystem, MockHttpClient, MockZipReader } from "./assetIo.js";

describe("MockFilesystem", () => {
	it("read after seedText", async () => {
		const fs = new MockFilesystem();
		fs.seedText("/proj/a.js", "hello");
		expect(await fs.exists("/proj/a.js")).toBe(true);
		expect(await fs.readText("/proj/a.js")).toBe("hello");
	});

	it("missing file -> exists false, read throws", async () => {
		const fs = new MockFilesystem();
		expect(await fs.exists("/missing")).toBe(false);
		await expect(fs.readText("/missing")).rejects.toThrow(/ENOENT/);
	});

	it("delete removes path", async () => {
		const fs = new MockFilesystem();
		fs.seedText("/x.js", "a");
		await fs.delete("/x.js");
		expect(await fs.exists("/x.js")).toBe(false);
	});

	it("listFiles returns sorted prefixed keys only", async () => {
		const fs = new MockFilesystem();
		fs.seedText("/a/b.js", "");
		fs.seedText("/a/c.js", "");
		fs.seedText("/other/x.js", "");
		expect(await fs.listFiles("/a")).toEqual(["/a/b.js", "/a/c.js"]);
	});

	it("normalizes backslashes", async () => {
		const fs = new MockFilesystem();
		fs.seedText("/a/b.js", "x");
		expect(await fs.exists("\\a\\b.js")).toBe(true);
	});

	it("stat returns size and mtime; null when missing", async () => {
		const fs = new MockFilesystem();
		fs.seedText("/x", "hello", "2026-01-01T00:00:00");
		const s = await fs.stat("/x");
		expect(s).toEqual({ size: 5, mtimeIso: "2026-01-01T00:00:00" });
		expect(await fs.stat("/missing")).toBeNull();
	});
});

describe("MockHttpClient", () => {
	it("dispatches by method and url", async () => {
		const http = new MockHttpClient();
		http.onGet("https://x/y", () => ({ status: 200, body: "ok" }));
		const res = await http.request({ method: "GET", url: "https://x/y" });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("ok");
	});

	it("supports regex url match", async () => {
		const http = new MockHttpClient();
		http.onGet(/\/api\/.*/, () => ({ status: 200, body: "{}" }));
		const res = await http.request({ method: "GET", url: "https://x/api/users" });
		expect(res.status).toBe(200);
	});

	it("returns 404 with body when no handler matches", async () => {
		const http = new MockHttpClient();
		const res = await http.request({ method: "GET", url: "https://nope" });
		expect(res.status).toBe(404);
	});

	it("handler can return Uint8Array body", async () => {
		const http = new MockHttpClient();
		http.onGet("https://x", () => ({ status: 200, body: new Uint8Array([1, 2, 3]) }));
		const res = await http.request({ method: "GET", url: "https://x" });
		expect(await res.bytes()).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("json parses body as JSON", async () => {
		const http = new MockHttpClient();
		http.onGet("https://x", () => ({ status: 200, body: '{"a":1}' }));
		const res = await http.request({ method: "GET", url: "https://x" });
		expect(await res.json()).toEqual({ a: 1 });
	});
});

describe("MockZipReader", () => {
	it("registers and reads entries", async () => {
		const zip = new MockZipReader();
		zip.register("v1.0.0", [
			{ path: "vendor-repo-abc/package_install.json", content: "{}" },
			{ path: "vendor-repo-abc/Scripts/main.js", content: "alert(1)" },
		]);
		const arc = await zip.open(zip.bytesFor("v1.0.0"));
		const collected: { path: string; bytes: Uint8Array }[] = [];
		for await (const entry of arc.entries()) {
			collected.push({ path: entry.path, bytes: await entry.read() });
		}
		expect(collected).toHaveLength(2);
		expect(collected[0].path).toBe("vendor-repo-abc/package_install.json");
		expect(new TextDecoder().decode(collected[0].bytes)).toBe("{}");
	});

	it("throws on unknown archive id", async () => {
		const zip = new MockZipReader();
		await expect(zip.open(zip.bytesFor("missing"))).rejects.toThrow(/unknown archive id/);
	});

	it("throws on non-mock bytes", async () => {
		const zip = new MockZipReader();
		await expect(zip.open(new TextEncoder().encode("garbage"))).rejects.toThrow(/not a mock zip/);
	});
});
