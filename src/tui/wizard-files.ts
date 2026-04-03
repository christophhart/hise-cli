// ── Wizard file path completion — filesystem listing for file fields ──

import * as fs from "node:fs";
import * as path from "node:path";

const MAX_COMPLETIONS = 20;

export interface FileCompletionOptions {
	/** Only return directories (for directory picker fields). */
	directory?: boolean;
	/** Wildcard filter (e.g., "*.wav", "*.hxi,*.lwc"). */
	wildcard?: string;
}

/**
 * List filesystem path completions for a partial path string.
 * Returns full paths sorted alphabetically, directories with trailing "/".
 */
export function listPathCompletions(partial: string, opts?: FileCompletionOptions): string[] {
	if (!partial) return [];

	// Expand ~ to home directory
	const expanded = partial.startsWith("~")
		? path.join(process.env.HOME ?? "/", partial.slice(1))
		: partial;

	// Split into directory and basename prefix
	let dir: string;
	let prefix: string;

	if (expanded.endsWith("/") || expanded.endsWith(path.sep)) {
		dir = expanded;
		prefix = "";
	} else {
		dir = path.dirname(expanded);
		prefix = path.basename(expanded).toLowerCase();
	}

	// Read directory entries
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	// Filter by prefix
	let filtered = entries.filter((e) => {
		if (e.name.startsWith(".")) return false; // skip hidden files
		return prefix === "" || e.name.toLowerCase().startsWith(prefix);
	});

	// Filter by directory-only
	if (opts?.directory) {
		filtered = filtered.filter((e) => e.isDirectory());
	}

	// Filter by wildcard
	if (opts?.wildcard && !opts.directory) {
		const patterns = opts.wildcard.split(",").map((w) => w.trim().toLowerCase());
		filtered = filtered.filter((e) => {
			if (e.isDirectory()) return true; // always show directories for navigation
			return patterns.some((p) => matchWildcard(e.name.toLowerCase(), p));
		});
	}

	// Sort: directories first, then alphabetical
	filtered.sort((a, b) => {
		const aDir = a.isDirectory() ? 0 : 1;
		const bDir = b.isDirectory() ? 0 : 1;
		if (aDir !== bDir) return aDir - bDir;
		return a.name.localeCompare(b.name);
	});

	// Build full paths
	return filtered
		.slice(0, MAX_COMPLETIONS)
		.map((e) => {
			const full = path.join(dir, e.name);
			return e.isDirectory() ? full + "/" : full;
		});
}

/** Simple wildcard matching (supports *.ext patterns). */
function matchWildcard(filename: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.startsWith("*.")) {
		const ext = pattern.slice(1); // ".ext"
		return filename.endsWith(ext);
	}
	if (pattern.startsWith(".")) {
		return filename.endsWith(pattern);
	}
	return filename.includes(pattern);
}
