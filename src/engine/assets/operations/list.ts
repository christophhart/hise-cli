// `list [installed|uninstalled|local|store]`. Spec §14 + §12 (state derivation).

import { normalizeStoreCatalog, type StoreProduct } from "../../../mock/contracts/assets/storeProduct.js";
import {
	normalizeGiteaRepos,
	type GiteaRepo,
} from "../../../mock/contracts/assets/giteaUser.js";
import type {
	InstallLogEntry,
	InstallMode,
} from "../../../mock/contracts/assets/installLog.js";
import type { AssetEnvironment } from "../environment.js";
import { getProjectFolder } from "../hiseAdapter.js";
import { readInstallLog } from "./log.js";
import {
	describeLocalFolder,
	readLocalFolders,
	type LocalFolderInfo,
} from "./local.js";
import { readStoredToken } from "./auth.js";

export interface InstalledEntrySummary {
	name: string;
	company: string;
	version: string;
	date: string;
	mode: InstallMode;
	needsCleanup: boolean;
}

export async function listInstalled(env: AssetEnvironment): Promise<InstalledEntrySummary[]> {
	const projectFolder = await getProjectFolder(env.hise);
	const log = await readInstallLog(env, projectFolder);
	return log.map(toSummary);
}

export async function listLocal(env: AssetEnvironment): Promise<LocalFolderInfo[]> {
	const folders = await readLocalFolders(env);
	return Promise.all(folders.map((f) => describeLocalFolder(env, f)));
}

export interface StoreEntry {
	productName: string;
	shortDescription: string;
	repoLink: string;
	vendor: string;
	repoId: string;
	owned: boolean | null; // null when ownership info unavailable (no token)
}

export async function listStore(env: AssetEnvironment): Promise<StoreEntry[]> {
	const res = await env.http.request({
		method: "GET",
		url: "https://store.hise.dev/api/products/",
	});
	if (res.status !== 200) {
		throw new Error(`Store catalog request failed: HTTP ${res.status}`);
	}
	const catalog = normalizeStoreCatalog(await res.json());

	const ownedSet = await readOwnedRepos(env);

	return catalog.map((p) => productToEntry(p, ownedSet));
}

function productToEntry(p: StoreProduct, owned: Set<string> | null): StoreEntry {
	let isOwned: boolean | null = null;
	if (owned !== null) {
		isOwned = owned.has(`${p.vendor}/${p.repoId}`);
	}
	return {
		productName: p.productName,
		shortDescription: p.shortDescription,
		repoLink: p.repoLink,
		vendor: p.vendor,
		repoId: p.repoId,
		owned: isOwned,
	};
}

async function readOwnedRepos(env: AssetEnvironment): Promise<Set<string> | null> {
	const token = await readStoredToken(env);
	if (!token) return null;
	const res = await env.http.request({
		method: "GET",
		url: "https://git.hise.dev/api/v1/user/repos",
		headers: { Authorization: `Bearer ${token}` },
	});
	if (res.status !== 200) return null;
	const repos = normalizeGiteaRepos(await res.json());
	return new Set(repos.map((r: GiteaRepo) => `${r.owner}/${r.name}`));
}

function toSummary(e: InstallLogEntry): InstalledEntrySummary {
	return {
		name: e.name,
		company: e.company,
		version: e.version,
		date: e.date,
		mode: e.mode,
		needsCleanup: e.kind === "needsCleanup",
	};
}
