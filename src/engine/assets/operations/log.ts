// Shared helpers for reading / writing install_packages_log.json.

import {
	normalizeInstallLog,
	serializeInstallLog,
	type InstallLogEntry,
} from "../../../mock/contracts/assets/installLog.js";
import type { AssetEnvironment } from "../environment.js";
import { joinPath } from "../io.js";

export const INSTALL_LOG_BASENAME = "install_packages_log.json";

export function installLogPath(projectFolder: string): string {
	return joinPath(projectFolder, INSTALL_LOG_BASENAME);
}

export async function readInstallLog(
	env: AssetEnvironment,
	projectFolder: string,
): Promise<InstallLogEntry[]> {
	const path = installLogPath(projectFolder);
	if (!await env.fs.exists(path)) return [];
	const raw = await env.fs.readText(path);
	const trimmed = raw.trim();
	if (trimmed.length === 0) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(trimmed);
	} catch (err) {
		throw new Error(`${INSTALL_LOG_BASENAME} is corrupted (JSON parse): ${(err as Error).message}`);
	}
	try {
		return normalizeInstallLog(parsed);
	} catch (err) {
		throw new Error(`${INSTALL_LOG_BASENAME} is corrupted: ${(err as Error).message}`);
	}
}

export async function writeInstallLog(
	env: AssetEnvironment,
	projectFolder: string,
	entries: InstallLogEntry[],
): Promise<void> {
	const path = installLogPath(projectFolder);
	const json = JSON.stringify(serializeInstallLog(entries), null, 2);
	await env.fs.writeAtomic(path, json);
}

// Project-relative paths claimed by the existing log (file step targets only).
export function claimedPaths(entries: InstallLogEntry[]): Set<string> {
	const out = new Set<string>();
	for (const entry of entries) {
		if (entry.kind !== "active") continue;
		for (const step of entry.steps) {
			if (step.type === "File") out.add(step.target);
		}
	}
	return out;
}
