// ── Node.js asset I/O implementations ───────────────────────────────
//
// Realises the engine's I/O interfaces (Filesystem, HttpClient, ZipReader,
// AppDataPaths) on top of node:fs, fetch, yauzl, and node:os/path. Used by
// the TUI/CLI bootstrap to back the /assets mode.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fromBuffer as yauzlFromBuffer, type ZipFile, type Entry } from "yauzl";

import type {
	AppDataPaths,
	Filesystem,
	FileStat,
	HttpClient,
	HttpRequest,
	HttpResponse,
	ZipArchive,
	ZipEntry,
	ZipReader,
} from "../engine/assets/io.js";

// ── Filesystem ────────────────────────────────────────────────────

export class NodeFilesystem implements Filesystem {
	async exists(p: string): Promise<boolean> {
		try {
			await fs.access(toNative(p));
			return true;
		} catch {
			return false;
		}
	}

	async readText(p: string): Promise<string> {
		return fs.readFile(toNative(p), "utf8");
	}

	async readBytes(p: string): Promise<Uint8Array> {
		return new Uint8Array(await fs.readFile(toNative(p)));
	}

	async writeText(p: string, data: string): Promise<void> {
		await ensureDir(p);
		await fs.writeFile(toNative(p), data, "utf8");
	}

	async writeBytes(p: string, data: Uint8Array): Promise<void> {
		await ensureDir(p);
		await fs.writeFile(toNative(p), data);
	}

	async delete(p: string): Promise<void> {
		await fs.unlink(toNative(p));
	}

	async stat(p: string): Promise<FileStat | null> {
		try {
			const s = await fs.stat(toNative(p));
			return { size: s.size, mtimeIso: toIsoNoMs(s.mtime) };
		} catch {
			return null;
		}
	}

	async listFiles(dir: string): Promise<string[]> {
		const out: string[] = [];
		await walk(toNative(dir), out);
		// Convert back to forward-slash paths for engine consumption.
		return out.map((p) => p.replaceAll(path.sep, "/")).sort();
	}

	async writeAtomic(p: string, data: string): Promise<void> {
		await ensureDir(p);
		const native = toNative(p);
		const tmp = `${native}.tmp.${process.pid}.${Date.now()}`;
		await fs.writeFile(tmp, data, "utf8");
		await fs.rename(tmp, native);
	}
}

async function walk(dir: string, out: string[]): Promise<void> {
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(full, out);
		} else if (entry.isFile()) {
			out.push(full);
		}
	}
}

async function ensureDir(p: string): Promise<void> {
	const native = toNative(p);
	const parent = path.dirname(native);
	if (parent && parent !== native) {
		await fs.mkdir(parent, { recursive: true });
	}
}

function toNative(p: string): string {
	if (path.sep === "/") return p;
	// Convert forward-slash engine paths to native Windows paths.
	return p.replaceAll("/", path.sep);
}

function toIsoNoMs(d: Date): string {
	const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
	return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${
		pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// ── HttpClient ────────────────────────────────────────────────────

export class NodeHttpClient implements HttpClient {
	async request(opts: HttpRequest): Promise<HttpResponse> {
		const init: RequestInit = {
			method: opts.method,
			headers: opts.headers,
		};
		if (opts.body !== undefined) {
			init.body = typeof opts.body === "string"
				? opts.body
				: new Uint8Array(opts.body);
		}
		const res = await fetch(opts.url, init);
		const headers: Record<string, string> = {};
		res.headers.forEach((value, key) => { headers[key] = value; });
		// Buffer body once; expose via the three accessors. For very large
		// responses (zipballs) we still pay one allocation here — Tier 2
		// streaming would replace this with a chunked iterator.
		const buf = new Uint8Array(await res.arrayBuffer());
		return {
			status: res.status,
			headers,
			async text() { return new TextDecoder().decode(buf); },
			async bytes() { return buf; },
			async json() { return JSON.parse(new TextDecoder().decode(buf)); },
		};
	}
}

// ── ZipReader ─────────────────────────────────────────────────────

export class NodeZipReader implements ZipReader {
	async open(zipBytes: Uint8Array): Promise<ZipArchive> {
		const zipFile = await openYauzlBuffer(zipBytes);
		return new YauzlArchive(zipFile);
	}
}

function openYauzlBuffer(bytes: Uint8Array): Promise<ZipFile> {
	return new Promise((resolve, reject) => {
		const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		yauzlFromBuffer(buf, { lazyEntries: true }, (err, zipFile) => {
			if (err || !zipFile) {
				reject(err ?? new Error("yauzl returned no zipFile"));
				return;
			}
			resolve(zipFile);
		});
	});
}

class YauzlArchive implements ZipArchive {
	constructor(private readonly zipFile: ZipFile) {}

	async *entries(): AsyncIterable<ZipEntry> {
		const queue: Entry[] = [];
		let done = false;
		let resolveNext: ((value: Entry | null) => void) | null = null;
		let reject: ((err: Error) => void) | null = null;

		this.zipFile.on("entry", (entry: Entry) => {
			if (resolveNext) {
				const r = resolveNext;
				resolveNext = null;
				r(entry);
			} else {
				queue.push(entry);
			}
		});
		this.zipFile.on("end", () => {
			done = true;
			if (resolveNext) {
				const r = resolveNext;
				resolveNext = null;
				r(null);
			}
		});
		this.zipFile.on("error", (err: Error) => {
			done = true;
			if (reject) reject(err);
		});

		this.zipFile.readEntry();

		while (true) {
			let entry: Entry | null;
			if (queue.length > 0) {
				entry = queue.shift()!;
			} else if (done) {
				entry = null;
			} else {
				entry = await new Promise<Entry | null>((resolve, rej) => {
					resolveNext = resolve;
					reject = rej;
				});
			}
			if (!entry) break;

			const isDirectory = /\/$/.test(entry.fileName);
			const path = entry.fileName.replaceAll("\\", "/");
			const zipFile = this.zipFile;
			let cachedBytes: Uint8Array | null = null;
			yield {
				path,
				isDirectory,
				async read(): Promise<Uint8Array> {
					if (cachedBytes) return cachedBytes;
					if (isDirectory) {
						cachedBytes = new Uint8Array();
						return cachedBytes;
					}
					cachedBytes = await readEntryBytes(zipFile, entry);
					return cachedBytes;
				},
			};
			// Continue to the next entry only after the consumer has had a
			// chance to call read(). yauzl streams are sequential — readEntry
			// must be called before the next "entry" event fires.
			this.zipFile.readEntry();
		}
	}

	async close(): Promise<void> {
		this.zipFile.close();
	}
}

function readEntryBytes(zipFile: ZipFile, entry: Entry): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		zipFile.openReadStream(entry, (err, stream) => {
			if (err || !stream) {
				reject(err ?? new Error("yauzl returned no read stream"));
				return;
			}
			const chunks: Buffer[] = [];
			stream.on("data", (chunk: Buffer) => chunks.push(chunk));
			stream.on("end", () => {
				const total = Buffer.concat(chunks);
				resolve(new Uint8Array(total.buffer, total.byteOffset, total.byteLength));
			});
			stream.on("error", reject);
		});
	});
}

// ── AppDataPaths ──────────────────────────────────────────────────

export class NodeAppDataPaths implements AppDataPaths {
	private readonly dir: string;

	constructor() {
		this.dir = resolveAppDataDir();
	}

	hiseDir(): string {
		return this.dir;
	}
}

function resolveAppDataDir(): string {
	const platform = process.platform;
	if (platform === "darwin") {
		return joinFS(os.homedir(), "Library", "Application Support", "HISE");
	}
	if (platform === "win32") {
		const appData = process.env.APPDATA ?? joinFS(os.homedir(), "AppData", "Roaming");
		return joinFS(appData, "HISE");
	}
	// Linux + others: XDG_CONFIG_HOME or ~/.config
	const xdg = process.env.XDG_CONFIG_HOME ?? joinFS(os.homedir(), ".config");
	return joinFS(xdg, "HISE");
}

function joinFS(...parts: string[]): string {
	// Always emit forward-slash engine paths; node accepts them everywhere.
	return path.join(...parts).replaceAll(path.sep, "/");
}

// ── Bundle helper ─────────────────────────────────────────────────

import type { AssetEnvironment } from "../engine/assets/environment.js";
import type { HiseConnection } from "../engine/hise.js";

export interface NodeAssetEnvironmentOptions {
	hise: HiseConnection;
	/** Optional clipboard — TUI wires OSC 52 here; CLI leaves it unset so
	 *  manifest ClipboardContent is recorded but not written anywhere. */
	clipboard?: AssetEnvironment["clipboard"];
}

export function createNodeAssetEnvironment(opts: NodeAssetEnvironmentOptions): AssetEnvironment {
	return {
		fs: new NodeFilesystem(),
		http: new NodeHttpClient(),
		zip: new NodeZipReader(),
		appData: new NodeAppDataPaths(),
		hise: opts.hise,
		now: () => new Date(),
		clipboard: opts.clipboard,
	};
}
