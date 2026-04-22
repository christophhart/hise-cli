// ── Shared Node.js file I/O wiring for Session ──────────────────────
//
// Both TUI (app.tsx) and CLI (run.ts) need to wire file operations onto
// Session. This module provides the shared implementations that use
// session.resolvePath() for path resolution.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import type { Session } from "./engine/session.js";

/**
 * Wire script file operations (load, save, glob) onto a Session.
 * If session.loadScriptFile is already set (e.g. CLI sets a raw readFile),
 * it wraps it with resolvePath. Otherwise creates a fresh implementation.
 */
export function wireScriptFileOps(session: Session): void {
	const origLoad = session.loadScriptFile;
	if (origLoad) {
		session.loadScriptFile = async (fp: string) => origLoad(resolve(session.resolvePath(fp)));
	} else {
		session.loadScriptFile = async (fp: string) => {
			return readFile(resolve(session.resolvePath(fp)), "utf-8");
		};
	}

	session.saveScriptFile = async (fp: string, content: string) => {
		await writeFile(resolve(session.resolvePath(fp)), content, "utf-8");
	};

	session.globScriptFiles = async (pattern: string) => {
		const resolved = resolve(session.resolvePath(pattern));
		const dir = dirname(resolved);
		const glob = basename(resolved);
		const re = new RegExp("^" + glob.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
		const entries = await readdir(dir, { recursive: true, withFileTypes: true });
		return entries
			.filter(e => e.isFile() && re.test(e.name))
			.map(e => resolve(e.parentPath ?? e.path ?? dir, e.name))
			.sort();
	};
}

/**
 * Wire extended file operations (binary read, text write, directory listing)
 * onto a Session. Used by the TUI; the CLI does not need these.
 */
export function wireExtendedFileOps(session: Session): void {
	session.readBinaryFile = async (path: string) => {
		return new Uint8Array(await readFile(resolve(session.resolvePath(path))));
	};

	session.writeTextFile = async (path: string, content: string) => {
		await writeFile(resolve(session.resolvePath(path)), content, "utf-8");
	};

	session.listDirectory = async (dir: string) => {
		const entries = await readdir(resolve(session.resolvePath(dir)), { withFileTypes: true });
		return entries
			.map(e => ({ name: e.name, isDir: e.isDirectory() }))
			.sort((a, b) => {
				if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
				return a.name.localeCompare(b.name);
			});
	};
}
