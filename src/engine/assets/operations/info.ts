// `info <packageName>` — describes a package's installed/local/store presence
// and current state. Spec §14.

import type { InstallLogEntry, InstallMode } from "../../../mock/contracts/assets/installLog.js";
import type { AssetEnvironment } from "../environment.js";
import { getProjectFolder } from "../hiseAdapter.js";
import { compareVersions } from "../semver.js";
import { readInstallLog } from "./log.js";
import {
	describeLocalFolder,
	readLocalFolders,
	type LocalFolderInfo,
} from "./local.js";

export type PackageState =
	| "Uninstalled"
	| "UpToDate"
	| "UpdateAvailable"
	| "NeedsCleanup"
	| "Unknown";

export interface PackageInfo {
	name: string;
	installed: InstalledSummary | null;
	local: LocalFolderInfo | null;
	state: PackageState;
}

export interface InstalledSummary {
	version: string;
	company: string;
	date: string;
	mode: InstallMode;
	needsCleanup: boolean;
}

export async function info(env: AssetEnvironment, packageName: string): Promise<PackageInfo> {
	const projectFolder = await getProjectFolder(env.hise);
	const log = await readInstallLog(env, projectFolder);
	const installedEntry = log.find((e) => e.name === packageName) ?? null;
	const installed = installedEntry ? summarize(installedEntry) : null;

	const local = await findLocal(env, packageName);

	let state: PackageState = "Uninstalled";
	if (installed) {
		if (installed.needsCleanup) state = "NeedsCleanup";
		else if (local && local.version) {
			state = compareVersions(installed.version, local.version) < 0 ? "UpdateAvailable" : "UpToDate";
		} else {
			state = "Unknown";
		}
	}

	return { name: packageName, installed, local, state };
}

async function findLocal(env: AssetEnvironment, packageName: string): Promise<LocalFolderInfo | null> {
	const folders = await readLocalFolders(env);
	for (const folder of folders) {
		const info = await describeLocalFolder(env, folder);
		if (info.name === packageName) return info;
	}
	return null;
}

function summarize(e: InstallLogEntry): InstalledSummary {
	return {
		version: e.version,
		company: e.company,
		date: e.date,
		mode: e.mode,
		needsCleanup: e.kind === "needsCleanup",
	};
}
