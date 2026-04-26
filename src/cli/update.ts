// ── Self-update ─────────────────────────────────────────────────────
//
// Resolves the latest GitHub release tag via the /releases/latest
// redirect (no auth, no rate limit), compares to the build-time
// __APP_VERSION__, and on macOS runs the signed .pkg installer; on
// Windows uses the rename trick (rename current .exe → .old, write new
// .exe at the original path).

import { spawnSync } from "node:child_process";
import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RELEASES_LATEST_URL = "https://github.com/christophhart/hise-cli/releases/latest";
const PKG_URL = "https://github.com/christophhart/hise-cli/releases/latest/download/hise-cli.pkg";
const INSTALLER_URL = "https://github.com/christophhart/hise-cli/releases/latest/download/hise-cli-setup.exe";

export interface UpdateInfo {
	current: string;
	latest: string;
	hasUpdate: boolean;
}

/**
 * Fetch the latest release tag without hitting the GitHub API (no auth,
 * no rate limit). Resolves the redirect of /releases/latest →
 * /releases/tag/v0.6.3 and parses the version out of the Location header.
 *
 * Returns null on any failure (network down, redirect missing, parse
 * error). Callers must handle null silently — this powers the TUI
 * background check, which must never surface errors to the user.
 */
export async function checkLatest(): Promise<UpdateInfo | null> {
	try {
		const res = await fetch(RELEASES_LATEST_URL, { redirect: "manual" });
		const loc = res.headers.get("location");
		if (!loc) return null;
		const match = loc.match(/\/tag\/v?([\d.]+)$/);
		if (!match) return null;
		const latest = match[1]!;
		const current = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0";
		return { current, latest, hasUpdate: compareSemver(latest, current) > 0 };
	} catch {
		return null;
	}
}

/**
 * Returns >0 if a > b, <0 if a < b, 0 if equal. Numeric segment
 * compare; sufficient for plain X.Y.Z tags. Pre-release suffixes
 * (e.g. v1.0.0-rc1) collapse to their numeric prefix and would be
 * treated as equal — fine until we ship a pre-release.
 */
export function compareSemver(a: string, b: string): number {
	const pa = a.split(".").map((s) => parseInt(s, 10) || 0);
	const pb = b.split(".").map((s) => parseInt(s, 10) || 0);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const da = pa[i] ?? 0;
		const db = pb[i] ?? 0;
		if (da !== db) return da - db;
	}
	return 0;
}

export interface UpdateOptions {
	check: boolean;
}

export async function executeUpdateCommand(opts: UpdateOptions): Promise<number> {
	const info = await checkLatest();
	if (!info) {
		process.stderr.write("update check failed (network or GitHub unreachable)\n");
		return 1;
	}

	const { current, latest, hasUpdate } = info;

	if (opts.check) {
		process.stdout.write(`current: ${current}\nlatest:  ${latest}\n`);
		process.stdout.write(hasUpdate ? "update available\n" : "up to date\n");
		return 0;
	}

	if (!hasUpdate) {
		process.stdout.write(`hise-cli v${current} (already latest)\n`);
		return 0;
	}

	process.stdout.write(`updating ${current} → ${latest}...\n`);

	if (process.platform === "darwin") {
		return installMacOS(latest);
	}
	if (process.platform === "win32") {
		return installWindows(latest);
	}
	process.stderr.write(`self-update not supported on platform: ${process.platform}\n`);
	process.stderr.write(`download from ${RELEASES_LATEST_URL}\n`);
	return 1;
}

async function installMacOS(latest: string): Promise<number> {
	const pkgPath = join(tmpdir(), "hise-cli-update.pkg");
	const ok = await downloadTo(PKG_URL, pkgPath);
	if (!ok) return 1;

	process.stdout.write("installing (sudo password required)...\n");
	const result = spawnSync("sudo", ["installer", "-pkg", pkgPath, "-target", "/"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		process.stderr.write(`installer exited ${result.status}\n`);
		return result.status ?? 1;
	}

	try {
		unlinkSync(pkgPath);
	} catch {
		// ignore
	}

	process.stdout.write(`updated to v${latest}. restart your shell or re-run hise-cli.\n`);
	return 0;
}

async function installWindows(latest: string): Promise<number> {
	const setupPath = join(tmpdir(), "hise-cli-setup.exe");
	const ok = await downloadTo(INSTALLER_URL, setupPath);
	if (!ok) return 1;

	const exe = process.execPath;
	const oldPath = `${exe}.old`;

	// Rename current .exe out of the way. Windows allows renaming a
	// running .exe but not deleting/overwriting it. The installer would
	// otherwise see the file as locked.
	try {
		renameSync(exe, oldPath);
	} catch (err) {
		process.stderr.write(`failed to rename current binary: ${String(err)}\n`);
		return 1;
	}

	process.stdout.write("running installer (silent)...\n");
	const result = spawnSync(setupPath, ["/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES"], {
		stdio: "inherit",
	});
	if (result.status !== 0) {
		// Best-effort restore on failure.
		try {
			renameSync(oldPath, exe);
		} catch {
			// ignore
		}
		process.stderr.write(`installer exited ${result.status}\n`);
		return result.status ?? 1;
	}

	try {
		unlinkSync(setupPath);
	} catch {
		// ignore
	}

	process.stdout.write(`updated to v${latest}. restart your shell to use the new version.\n`);
	process.stdout.write(`(${oldPath} will be cleaned up on next launch)\n`);
	return 0;
}

async function downloadTo(url: string, destPath: string): Promise<boolean> {
	try {
		process.stdout.write(`downloading ${url}...\n`);
		const res = await fetch(url, { redirect: "follow" });
		if (!res.ok) {
			process.stderr.write(`download failed: HTTP ${res.status}\n`);
			return false;
		}
		const buf = Buffer.from(await res.arrayBuffer());
		writeFileSync(destPath, buf);
		return true;
	} catch (err) {
		process.stderr.write(`download error: ${String(err)}\n`);
		return false;
	}
}
