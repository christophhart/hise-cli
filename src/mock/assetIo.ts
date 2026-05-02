// In-memory implementations of the asset I/O interfaces. Used by mock runtime
// and unit tests for engine asset operations. No node imports.

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

// ── MockFilesystem ────────────────────────────────────────────────

export class MockFilesystem implements Filesystem {
	private store = new Map<string, { data: Uint8Array; mtimeIso: string }>();

	private normalize(path: string): string {
		return path.replaceAll("\\", "/").replace(/\/+$/, "") || "/";
	}

	seedText(path: string, data: string, mtimeIso = "2026-01-01T00:00:00"): void {
		this.store.set(this.normalize(path), {
			data: new TextEncoder().encode(data),
			mtimeIso,
		});
	}

	seedBytes(path: string, data: Uint8Array, mtimeIso = "2026-01-01T00:00:00"): void {
		this.store.set(this.normalize(path), { data, mtimeIso });
	}

	allPaths(): string[] {
		return [...this.store.keys()];
	}

	async exists(path: string): Promise<boolean> {
		return this.store.has(this.normalize(path));
	}

	async readText(path: string): Promise<string> {
		const entry = this.store.get(this.normalize(path));
		if (!entry) throw new Error(`ENOENT: ${path}`);
		return new TextDecoder().decode(entry.data);
	}

	async readBytes(path: string): Promise<Uint8Array> {
		const entry = this.store.get(this.normalize(path));
		if (!entry) throw new Error(`ENOENT: ${path}`);
		return entry.data;
	}

	async writeText(path: string, data: string): Promise<void> {
		this.seedText(path, data, isoNow());
	}

	async writeBytes(path: string, data: Uint8Array): Promise<void> {
		this.seedBytes(path, data, isoNow());
	}

	async delete(path: string): Promise<void> {
		const key = this.normalize(path);
		if (!this.store.has(key)) throw new Error(`ENOENT: ${path}`);
		this.store.delete(key);
	}

	async stat(path: string): Promise<FileStat | null> {
		const entry = this.store.get(this.normalize(path));
		if (!entry) return null;
		return { size: entry.data.byteLength, mtimeIso: entry.mtimeIso };
	}

	async listFiles(dir: string): Promise<string[]> {
		const prefix = this.normalize(dir) + "/";
		const out: string[] = [];
		for (const key of this.store.keys()) {
			if (key.startsWith(prefix)) out.push(key);
		}
		out.sort();
		return out;
	}

	async writeAtomic(path: string, data: string): Promise<void> {
		// In-memory mock: atomicity is implicit.
		await this.writeText(path, data);
	}
}

function isoNow(): string {
	const d = new Date();
	return `${d.getUTCFullYear().toString().padStart(4, "0")}-${
		(d.getUTCMonth() + 1).toString().padStart(2, "0")}-${
		d.getUTCDate().toString().padStart(2, "0")}T${
		d.getUTCHours().toString().padStart(2, "0")}:${
		d.getUTCMinutes().toString().padStart(2, "0")}:${
		d.getUTCSeconds().toString().padStart(2, "0")}`;
}

// ── MockHttpClient ────────────────────────────────────────────────

export type MockHttpHandler = (req: HttpRequest) => MockHttpResult | Promise<MockHttpResult>;

export interface MockHttpResult {
	status: number;
	headers?: Record<string, string>;
	body: Uint8Array | string;
}

export class MockHttpClient implements HttpClient {
	private handlers: Array<{ method: string; url: string | RegExp; handler: MockHttpHandler }> = [];

	on(method: HttpRequest["method"], url: string | RegExp, handler: MockHttpHandler): void {
		this.handlers.push({ method, url, handler });
	}

	onGet(url: string | RegExp, handler: MockHttpHandler): void { this.on("GET", url, handler); }
	onPost(url: string | RegExp, handler: MockHttpHandler): void { this.on("POST", url, handler); }

	async request(opts: HttpRequest): Promise<HttpResponse> {
		for (const h of this.handlers) {
			if (h.method !== opts.method) continue;
			const matches = typeof h.url === "string" ? h.url === opts.url : h.url.test(opts.url);
			if (!matches) continue;
			const result = await h.handler(opts);
			return wrapResponse(result);
		}
		return wrapResponse({
			status: 404,
			body: `No mock handler for ${opts.method} ${opts.url}`,
		});
	}
}

function wrapResponse(result: MockHttpResult): HttpResponse {
	const body = typeof result.body === "string"
		? new TextEncoder().encode(result.body)
		: result.body;
	const headers = result.headers ?? {};
	return {
		status: result.status,
		headers,
		async text() { return new TextDecoder().decode(body); },
		async bytes() { return body; },
		async json() { return JSON.parse(new TextDecoder().decode(body)); },
	};
}

// ── MockZipReader ─────────────────────────────────────────────────
//
// Real zip format is not parsed; tests register synthetic archives by id, and
// MockHttpClient handlers serve `mockZipReader.bytesFor(id)` as the zipball
// download payload.

export interface MockZipEntryInput {
	path: string;
	content: Uint8Array | string;
}

const MOCK_ZIP_PREFIX = "MOCKZIP:";

export class MockZipReader implements ZipReader {
	private archives = new Map<string, ZipEntry[]>();

	register(id: string, entries: MockZipEntryInput[]): void {
		const built = entries.map((e) => buildEntry(e));
		this.archives.set(id, built);
	}

	bytesFor(id: string): Uint8Array {
		return new TextEncoder().encode(MOCK_ZIP_PREFIX + id);
	}

	async open(bytes: Uint8Array): Promise<ZipArchive> {
		const txt = new TextDecoder().decode(bytes);
		if (!txt.startsWith(MOCK_ZIP_PREFIX)) {
			throw new Error("MockZipReader: bytes are not a mock zip token");
		}
		const id = txt.slice(MOCK_ZIP_PREFIX.length);
		const entries = this.archives.get(id);
		if (!entries) throw new Error(`MockZipReader: unknown archive id "${id}"`);
		return new MockZipArchive(entries);
	}
}

function buildEntry(input: MockZipEntryInput): ZipEntry {
	const isDirectory = input.path.endsWith("/");
	const data = typeof input.content === "string"
		? new TextEncoder().encode(input.content)
		: input.content;
	return {
		path: input.path,
		isDirectory,
		async read() { return data; },
	};
}

class MockZipArchive implements ZipArchive {
	constructor(private readonly _entries: ZipEntry[]) {}

	async *entries(): AsyncIterable<ZipEntry> {
		for (const e of this._entries) yield e;
	}

	async close(): Promise<void> {}
}

// ── MockAppDataPaths ──────────────────────────────────────────────

export class MockAppDataPaths implements AppDataPaths {
	constructor(private readonly dir: string = "/mock/AppData/HISE") {}
	hiseDir(): string { return this.dir; }
}
