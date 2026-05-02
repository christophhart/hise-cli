// AssetEnvironment bundles every dependency the asset operations need.
// Constructed once per session — by the node platform glue (live mode) or by
// the mock runtime (mock mode and tests).

import type { HiseConnection } from "../hise.js";
import type { AppDataPaths, Filesystem, HttpClient, ZipReader } from "./io.js";

export interface AssetClipboard {
	write(text: string): void | Promise<void>;
}

export interface AssetEnvironment {
	fs: Filesystem;
	http: HttpClient;
	zip: ZipReader;
	appData: AppDataPaths;
	hise: HiseConnection;
	clipboard?: AssetClipboard;
	// Provides a `Date` so tests can pin "now". ISO-8601 conversion happens at
	// the call site that records into the install log.
	now(): Date;
}

export function isoDate(date: Date): string {
	const pad = (n: number, w = 2) => n.toString().padStart(w, "0");
	return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${
		pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}
