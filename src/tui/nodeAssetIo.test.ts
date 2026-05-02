// Tests for the node-backed asset I/O implementations. FS tests run against a
// real tmp dir (created per-test, cleaned in afterEach). NodeHttpClient and
// NodeZipReader are exercised via integration / live runs — unit testing them
// here would either need network access or a hand-built zip fixture.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NodeAppDataPaths, NodeFilesystem } from "./nodeAssetIo.js";

describe("NodeFilesystem", () => {
	let dir: string;
	let fs: NodeFilesystem;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "hise-cli-asset-io-"));
		fs = new NodeFilesystem();
	});
	afterEach(async () => {
		try { await rm(dir, { recursive: true, force: true }); } catch { /* noop */ }
	});

	it("writeText then readText round-trips", async () => {
		const p = `${dir}/a.txt`;
		await fs.writeText(p, "hello");
		expect(await fs.readText(p)).toBe("hello");
	});

	it("creates parent directories on write", async () => {
		const p = `${dir}/nested/sub/dir/x.txt`;
		await fs.writeText(p, "x");
		expect(await fs.exists(p)).toBe(true);
	});

	it("readBytes returns Uint8Array", async () => {
		await fs.writeBytes(`${dir}/bin`, new Uint8Array([1, 2, 3]));
		const got = await fs.readBytes(`${dir}/bin`);
		expect(got).toBeInstanceOf(Uint8Array);
		expect([...got]).toEqual([1, 2, 3]);
	});

	it("delete removes file", async () => {
		await fs.writeText(`${dir}/x`, "x");
		await fs.delete(`${dir}/x`);
		expect(await fs.exists(`${dir}/x`)).toBe(false);
	});

	it("stat returns size + mtime; null when missing", async () => {
		await fs.writeText(`${dir}/x`, "hello");
		const s = await fs.stat(`${dir}/x`);
		expect(s?.size).toBe(5);
		expect(s?.mtimeIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
		expect(await fs.stat(`${dir}/missing`)).toBeNull();
	});

	it("listFiles is recursive and forward-slash normalized", async () => {
		await fs.writeText(`${dir}/a.txt`, "a");
		await fs.writeText(`${dir}/sub/b.txt`, "b");
		await fs.writeText(`${dir}/sub/deeper/c.txt`, "c");
		const out = await fs.listFiles(dir);
		// All paths use forward slash even on Windows.
		for (const p of out) expect(p).not.toContain("\\");
		expect(out).toHaveLength(3);
		expect(out.some((p) => p.endsWith("/a.txt"))).toBe(true);
		expect(out.some((p) => p.endsWith("/sub/b.txt"))).toBe(true);
		expect(out.some((p) => p.endsWith("/sub/deeper/c.txt"))).toBe(true);
	});

	it("writeAtomic produces final file with target content", async () => {
		const p = `${dir}/log.json`;
		await fs.writeAtomic(p, JSON.stringify({ a: 1 }));
		expect(await fs.readText(p)).toBe('{"a":1}');
		// No leftover .tmp files.
		const list = await fs.listFiles(dir);
		expect(list.every((f) => !f.endsWith(".tmp"))).toBe(true);
	});

	it("exists returns false on missing path", async () => {
		expect(await fs.exists(`${dir}/never`)).toBe(false);
	});

	it("readText throws on missing path", async () => {
		await expect(fs.readText(`${dir}/missing`)).rejects.toThrow();
	});
});

describe("NodeAppDataPaths", () => {
	it("returns a non-empty platform-specific directory ending with HISE", () => {
		const p = new NodeAppDataPaths();
		const dir = p.hiseDir();
		expect(dir.length).toBeGreaterThan(0);
		expect(dir.replaceAll("\\", "/").endsWith("/HISE") || dir.endsWith("HISE")).toBe(true);
	});

	it("uses forward-slash separators", () => {
		const p = new NodeAppDataPaths();
		expect(p.hiseDir()).not.toContain("\\");
	});
});
