// Engine I/O interfaces for the asset manager. Engine code talks only through
// these abstractions so it stays free of `node:` imports and is unit-testable
// against in-memory mocks.
//
// Path convention: all paths inside engine code are forward-slash strings.
// Filesystem implementations may convert to native separators internally.

export interface FileStat {
	size: number;
	mtimeIso: string; // ISO-8601 without milliseconds
}

export interface Filesystem {
	exists(path: string): Promise<boolean>;
	readText(path: string): Promise<string>;
	readBytes(path: string): Promise<Uint8Array>;
	writeText(path: string, data: string): Promise<void>;
	writeBytes(path: string, data: Uint8Array): Promise<void>;
	delete(path: string): Promise<void>;
	stat(path: string): Promise<FileStat | null>;
	// Recursive list of regular files under `dir`. Returns absolute paths
	// (prefix-matching `dir`) using forward-slash separators.
	listFiles(dir: string): Promise<string[]>;
	// Atomic write via temp file + rename. Used for install_packages_log.json.
	writeAtomic(path: string, data: string): Promise<void>;
}

export interface HttpRequest {
	method: "GET" | "POST" | "DELETE";
	url: string;
	headers?: Record<string, string>;
	body?: string | Uint8Array;
}

export interface HttpResponse {
	status: number;
	headers: Record<string, string>;
	text(): Promise<string>;
	bytes(): Promise<Uint8Array>;
	json(): Promise<unknown>;
}

export interface HttpClient {
	request(opts: HttpRequest): Promise<HttpResponse>;
}

export interface ZipEntry {
	path: string;        // forward-slash, archive-relative
	isDirectory: boolean;
	read(): Promise<Uint8Array>;
}

export interface ZipArchive {
	entries(): AsyncIterable<ZipEntry>;
	close(): Promise<void>;
}

export interface ZipReader {
	open(zipBytes: Uint8Array): Promise<ZipArchive>;
}

// Resolves the platform-specific HISE app data directory.
//   macOS  -> ~/Library/Application Support/HISE
//   Win    -> %APPDATA%/HISE
//   Linux  -> ~/.config/HISE
export interface AppDataPaths {
	hiseDir(): string;
}

// Path helpers that operate on forward-slash strings only. No node:path needed.
export function joinPath(...parts: string[]): string {
	return parts
		.filter((p) => p.length > 0)
		.map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
		.filter((p) => p.length > 0)
		.join("/");
}

export function dirname(path: string): string {
	const i = path.lastIndexOf("/");
	if (i < 0) return "";
	if (i === 0) return "/";
	return path.slice(0, i);
}

export function basename(path: string): string {
	const i = path.lastIndexOf("/");
	return i < 0 ? path : path.slice(i + 1);
}
