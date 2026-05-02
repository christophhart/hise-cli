// `cleanup <packageName>` — finishes a NeedsCleanup uninstall by force-deleting
// the SkippedFiles list. Spec §10.

import type { InstallLogEntry } from "../../../mock/contracts/assets/installLog.js";
import type { AssetEnvironment } from "../environment.js";
import { getProjectFolder } from "../hiseAdapter.js";
import { readInstallLog, writeInstallLog } from "./log.js";

export type CleanupResult =
	| { kind: "ok"; deleted: string[]; remaining: string[]; logUpdated: boolean }
	| { kind: "notFound"; package: string }
	| { kind: "notNeedsCleanup"; package: string };

export async function cleanup(
	env: AssetEnvironment,
	packageName: string,
): Promise<CleanupResult> {
	const projectFolder = await getProjectFolder(env.hise);
	const entries = await readInstallLog(env, projectFolder);
	const idx = entries.findIndex((e) => e.name === packageName);
	if (idx < 0) return { kind: "notFound", package: packageName };
	const entry = entries[idx];
	if (entry.kind !== "needsCleanup") {
		return { kind: "notNeedsCleanup", package: packageName };
	}

	const deleted: string[] = [];
	const remaining: string[] = [];
	for (const abs of entry.skippedFiles) {
		if (!await env.fs.exists(abs)) {
			deleted.push(abs);
			continue;
		}
		try {
			await env.fs.delete(abs);
			deleted.push(abs);
		} catch {
			remaining.push(abs);
		}
	}

	let nextEntries: InstallLogEntry[];
	if (remaining.length === 0) {
		nextEntries = entries.filter((_, i) => i !== idx);
	} else {
		nextEntries = entries.map((e, i) =>
			i === idx ? { ...entry, skippedFiles: remaining } : e,
		);
	}
	await writeInstallLog(env, projectFolder, nextEntries);

	return { kind: "ok", deleted, remaining, logUpdated: true };
}
