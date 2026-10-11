// ── HISE discovery and reviewed permanent cleanup ────────────────────
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile, rename } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { WizardInitAbortError } from "../../engine/wizard/executor.js";
import type { InternalInitHandler, InternalTaskHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import type { WizardExecResult } from "../../engine/wizard/types.js";

interface DirectoryIdentity {
	path: string;
	canonical: string;
	dev: string;
	ino: string;
	birthtime: string;
}

interface Candidate extends DirectoryIdentity {
	id: string;
	kind: "source" | "application";
}

interface Inventory {
	version: 2;
	createdAt: string;
	platform: string;
	candidates: Candidate[];
	unreadable: number;
	settings?: DirectoryIdentity;
}

const inventoryPath = join(tmpdir(), "hise-cli-nuke-inventory-v2.json");
const ok = (message: string, logs?: string[]): WizardExecResult => ({ success: true, message, logs });
const fail = (message: string, logs?: string[]): WizardExecResult => ({ success: false, message, logs });
const enabled = (value: string | undefined) => value === "true" || value === "1";
const displayPath = (path: string) => JSON.stringify(path);

async function identity(path: string): Promise<DirectoryIdentity> {
	const stat = await lstat(path, { bigint: true });
	if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Not a regular directory: ${displayPath(path)}`);
	const canonical = await realpath(path);
	if (canonical === parse(canonical).root) throw new Error("Refusing a filesystem root.");
	return { path, canonical, dev: String(stat.dev), ino: String(stat.ino), birthtime: String(stat.birthtimeNs) };
}

async function verify(expected: DirectoryIdentity): Promise<void> {
	const current = await identity(expected.path);
	if (current.canonical !== expected.canonical || current.dev !== expected.dev || current.ino !== expected.ino || current.birthtime !== expected.birthtime) {
		throw new Error(`Directory changed since scan: ${displayPath(expected.path)}. Scan again.`);
	}
}

function overlaps(a: string, b: string): boolean {
	const contains = (parent: string, child: string) => {
		const rel = relative(parent, child);
		return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
	};
	return contains(a, b) || contains(b, a);
}

async function readInventory(): Promise<Inventory | null> {
	try {
		const data = JSON.parse(await readFile(inventoryPath, "utf8")) as Inventory;
		const age = Date.now() - Date.parse(data.createdAt);
		if (data.version !== 2 || data.platform !== process.platform || !Number.isFinite(age) || age < 0 || age > 24 * 60 * 60 * 1000 || !Array.isArray(data.candidates)) return null;
		if (!data.candidates.every(c => typeof c.id === "string" && /^[a-f0-9-]{36}$/.test(c.id) && typeof c.path === "string" && isAbsolute(c.path) && typeof c.canonical === "string" && isAbsolute(c.canonical) && typeof c.dev === "string" && typeof c.ino === "string" && typeof c.birthtime === "string" && (c.kind === "source" || c.kind === "application"))) return null;
		if (new Set(data.candidates.map(c => c.id)).size !== data.candidates.length) return null;
		return data;
	} catch { return null; }
}

function settingsPath(): string {
	return process.platform === "win32" ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "HISE") : process.platform === "darwin" ? join(homedir(), "Library", "Application Support", "HISE") : join(homedir(), ".config", "HISE");
}

export function createNukeRouteHandler(): InternalInitHandler {
	return async () => ({ route: (await readInventory())?.candidates.length ? "cleanup" : "scan" });
}

export function createNukeCleanupInitHandler(): InternalInitHandler {
	return async () => {
		const inventory = await readInventory();
		if (!inventory || inventory.candidates.length === 0) throw new WizardInitAbortError("No verified HISE installations in the recent inventory. Run /wizard nuke_scan to scan again.");
		return {
			defaults: { installations: "", retained: "none", backedUp: "false", removeSettings: "false", removePathEntries: "false", confirmation: "" },
			items: { installations: inventory.candidates.map(c => c.id), retained: ["none", ...inventory.candidates.map(c => c.id)] },
			itemDescriptions: {
				installations: inventory.candidates.map(c => `${c.kind}: ${displayPath(c.path)}`),
				retained: ["No explicitly retained installation; deleting the sole or all installations is allowed.", ...inventory.candidates.map(c => `${c.kind}: ${displayPath(c.path)}`)],
			},
		};
	};
}

async function installationKind(dir: string): Promise<Candidate["kind"] | null> {
	const isType = async (path: string, directory: boolean) => {
		try {
			const stat = await lstat(path);
			return !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile());
		} catch { return false; }
	};
	if (basename(dir).toLowerCase() === "hise.app") {
		if (!await isType(join(dir, "Contents", "Info.plist"), false)) return null;
		try {
			const executables = await readdir(join(dir, "Contents", "MacOS"));
			for (const name of executables) if (/^hise(?: standalone)?$/i.test(name) && await isType(join(dir, "Contents", "MacOS", name), false)) return "application";
		} catch { /* An incomplete bundle is not an installation. */ }
		return null;
	}
	if (basename(dir).toLowerCase() !== "hise") return null;
	if (await isType(join(dir, "hi_core"), true) && await isType(join(dir, "hi_modules"), true) && await isType(join(dir, "hi_tools"), true)) return "source";
	if (await isType(join(dir, "HISE.exe"), false) || await isType(join(dir, "HISE"), false)) return "application";
	return null;
}

async function filesystemRoots(executor: PhaseExecutor): Promise<string[]> {
	if (process.platform !== "win32") return [parse(homedir()).root || "/"];
	const result = await executor.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Root }"], {});
	if (result.exitCode !== 0) throw new Error(`Cannot enumerate disks: ${result.stderr}`);
	return result.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

export function createNukeScanHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		if (!enabled(answers.confirmed)) return fail("Scan cancelled; no files were changed.");
		try {
			const pending = await filesystemRoots(executor);
			const candidates: Candidate[] = [];
			const seen = new Set<string>();
			let unreadable = 0;
			let visited = 0;
			while (pending.length) {
				if (signal?.aborted) throw new Error("Scan cancelled.");
				const dir = pending.pop()!;
				try {
					const snapshot = await identity(dir);
					if (seen.has(snapshot.canonical)) continue;
					seen.add(snapshot.canonical);
				} catch {
					// Roots are allowed for traversal, never for deletion.
					if (dir !== parse(dir).root) { unreadable++; continue; }
				}
				let entries;
				try { entries = await readdir(dir, { withFileTypes: true }); }
				catch { unreadable++; continue; }
				if (++visited % 500 === 0) onProgress({ phase: "scan", message: `Visited ${visited} directories; found ${candidates.length} candidates.` });
				for (const entry of entries) {
					if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
					if ((dir === "/" || dir === "/private") && ["proc", "sys", "dev", "run"].includes(entry.name)) continue;
					const path = resolve(dir, entry.name);
					if (["hise", "hise.app"].includes(entry.name.toLowerCase())) {
						const kind = await installationKind(path);
						if (kind) {
							try { candidates.push({ ...await identity(path), id: randomUUID(), kind }); }
							catch { unreadable++; }
						}
					}
					pending.push(path);
				}
			}
			let settings: DirectoryIdentity | undefined;
			try { settings = await identity(settingsPath()); } catch { /* Missing or linked settings cannot be selected for deletion. */ }
			const inventory: Inventory = { version: 2, createdAt: new Date().toISOString(), platform: process.platform, candidates: candidates.sort((a, b) => a.path.localeCompare(b.path)), unreadable, settings };
			if (signal?.aborted) throw new Error("Scan cancelled.");
			const temp = `${inventoryPath}.${randomUUID()}.tmp`;
			await writeFile(temp, JSON.stringify(inventory, null, 2), { mode: 0o600, flag: "wx" });
			await rename(temp, inventoryPath);
			return ok(`Scan complete: ${candidates.length} candidate(s). Run /nuke to review. These are not proven identical duplicates. ${unreadable} directories were unreadable.`);
		} catch (error) { return fail(String(error)); }
	};
}

async function verifyDeletionTree(target: DirectoryIdentity, signal?: AbortSignal): Promise<void> {
	const pending = [target.canonical];
	while (pending.length) {
		if (signal?.aborted) throw new Error("Cleanup cancelled.");
		const dir = pending.pop()!;
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			const stat = await lstat(path, { bigint: true });
			// Recursive rm unlinks symlinks; never traverse their destinations.
			if (stat.isSymbolicLink()) continue;
			if (String(stat.dev) !== target.dev) throw new Error(`Refusing mounted filesystem inside deletion target: ${displayPath(path)}`);
			if (stat.isDirectory()) pending.push(path);
		}
	}
}

async function verifyInstallation(candidate: Candidate, executor: PhaseExecutor, signal?: AbortSignal): Promise<void> {
	await verify(candidate);
	if (await installationKind(candidate.canonical) !== candidate.kind) throw new Error(`Installation markers changed: ${displayPath(candidate.path)}`);
	if (candidate.kind === "source") {
		const root = await executor.spawn(process.platform === "win32" ? "git.exe" : "git", ["-C", candidate.canonical, "rev-parse", "--show-toplevel"], { signal });
		if (root.exitCode !== 0 || await realpath(root.stdout.trim()) !== candidate.canonical) throw new Error(`Source folder must be its own Git checkout: ${displayPath(candidate.path)}`);
		const status = await executor.spawn(process.platform === "win32" ? "git.exe" : "git", ["-C", candidate.canonical, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"], { signal });
		if (status.exitCode !== 0 || status.stdout.trim()) throw new Error(`Refusing source checkout with changed/untracked files or unreadable Git status: ${displayPath(candidate.path)}`);
	}
}

export function createNukeCleanupHandler(executor: PhaseExecutor): InternalTaskHandler {
	return async (answers, onProgress, signal) => {
		if (answers.confirmation !== "NUKE" || !enabled(answers.backedUp)) return fail('Refusing cleanup: acknowledge backups and type exactly "NUKE".');
		const inventory = await readInventory();
		if (!inventory) return fail("No valid recent scan inventory. Scan again.");
		const ids = [...new Set((answers.installations ?? "").split(", ").filter(Boolean))];
		const selected = ids.map(id => inventory.candidates.find(c => c.id === id));
		const retained = inventory.candidates.find(c => c.id === answers.retained);
		if (!ids.length || selected.some(c => !c)) return fail("Select at least one valid installation candidate ID.");
		if (answers.retained && answers.retained !== "none" && !retained) return fail("Invalid retained installation candidate ID.");
		if (retained && ids.includes(retained.id)) return fail("The retained installation cannot also be selected for deletion.");
		const targets = selected as Candidate[];
		const logs: string[] = [];
		let auditPath: string | undefined;
		const checkCancelled = () => { if (signal?.aborted) throw new Error("Cleanup cancelled; completed deletions are not rolled back."); };
		const record = async (message: string) => {
			logs.push(message);
			if (auditPath) {
				const temp = `${auditPath}.${randomUUID()}.tmp`;
				await writeFile(temp, JSON.stringify({ createdAt: new Date().toISOString(), retained: retained?.path ?? null, selected: targets.map(c => c.path), logs }, null, 2), { mode: 0o600, flag: "wx" });
				await rename(temp, auditPath);
			}
		};
		try {
			checkCancelled();
			if (retained) {
				await verify(retained);
				if (await installationKind(retained.canonical) !== retained.kind) throw new Error("Retained installation markers changed.");
			}
			for (const target of targets) {
				checkCancelled();
				if ((retained && overlaps(target.canonical, retained.canonical)) || targets.some(other => other !== target && overlaps(target.canonical, other.canonical))) throw new Error("Selected installations overlap each other or the retained installation.");
				await verifyInstallation(target, executor, signal);
				await verifyDeletionTree(target, signal);
			}
			const settings = enabled(answers.removeSettings) ? inventory.settings : undefined;
			if (enabled(answers.removeSettings)) {
				if (!settings || settings.path !== settingsPath()) throw new Error("Settings were not safely identified during the scan.");
				if ([...(retained ? [retained] : []), ...targets].some(c => overlaps(c.canonical, settings.canonical))) throw new Error("Settings overlap an installation; refusing cleanup.");
				await verify(settings);
				await verifyDeletionTree(settings, signal);
			}
			const auditDir = join(homedir(), ".hise", "cleanup-logs");
			if ([...targets, ...(settings ? [settings] : [])].some(c => overlaps(c.canonical, resolve(auditDir)))) throw new Error("Deletion target overlaps the cleanup log directory.");
			await mkdir(auditDir, { recursive: true, mode: 0o700 });
			const canonicalAuditDir = await realpath(auditDir);
			if ([...targets, ...(settings ? [settings] : [])].some(c => overlaps(c.canonical, canonicalAuditDir))) throw new Error("Deletion target overlaps the canonical cleanup log directory.");
			auditPath = join(auditDir, `${randomUUID()}.json`);
			await writeFile(auditPath, "{}", { mode: 0o600, flag: "wx" });
			logs.push(`Audit log: ${displayPath(auditPath)}`);
			const remove = async (target: DirectoryIdentity) => {
				checkCancelled();
				if (retained) await verify(retained);
				await verify(target);
				const staged = join(dirname(target.canonical), `.hise-cli-delete-${randomUUID()}`);
				await record(`Pending permanent deletion: ${displayPath(target.path)}; staging location: ${displayPath(staged)}`);
				checkCancelled();
				await verify(target);
				// Rename isolates the selected directory before recursive removal.
				// If interrupted before rm, the logged staging path can be restored manually.
				await rename(target.canonical, staged);
				const stagedIdentity = { ...target, path: staged, canonical: staged };
				await verify(stagedIdentity);
				await verifyDeletionTree(stagedIdentity, signal);
				await verify(stagedIdentity);
				checkCancelled();
				if (retained) await verify(retained);
				onProgress({ phase: "delete", message: `Permanently removing ${displayPath(target.path)}` });
				checkCancelled();
				await rm(staged, { recursive: true, force: false });
				await record(`Deleted: ${displayPath(target.path)}`);
			};
			for (const target of targets) {
				await verifyInstallation(target, executor, signal);
				await remove(target);
			}
			if (settings) await remove(settings);
			if (enabled(answers.removePathEntries)) {
				checkCancelled();
				if (process.platform === "win32") {
					// JSON is data, not interpolated PowerShell syntax. Remove only exact
					// components naming deleted folders; preserve retained and unrelated entries.
					const encoded = Buffer.from(JSON.stringify(targets.flatMap(c => [c.path, c.canonical])), "utf8").toString("base64");
					const backup = join(auditDir, `${randomUUID()}.path-backup.txt`);
					const encodedBackup = Buffer.from(backup, "utf8").toString("base64");
					await record(`User PATH backup: ${displayPath(backup)}`);
					const script = `$ErrorActionPreference='Stop'; $targets=@(ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}')))); $backup=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedBackup}')); $p=[Environment]::GetEnvironmentVariable('Path','User'); if ($null -ne $p) { [IO.File]::WriteAllText($backup,$p); $parts=@($p -split ';'); $keep=@($parts | Where-Object { $entry=$_.Trim().Trim('"'); $match=$false; if ([IO.Path]::IsPathRooted($entry)) { foreach ($target in $targets) { if ([String]::Equals($entry.TrimEnd('\\','/'),$target.TrimEnd('\\','/'),[StringComparison]::OrdinalIgnoreCase)) { $match=$true } } }; -not $match }); [Environment]::SetEnvironmentVariable('Path',($keep -join ';'),'User') }`;
					checkCancelled();
					const result = await executor.spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { signal });
					if (result.exitCode !== 0) throw new Error(`User PATH cleanup failed: ${result.stderr || result.stdout}`);
					await record("Removed exact selected-installation components from user PATH.");
				} else {
					await record(`Shell configuration was NOT modified. Manually remove only PATH components for: ${targets.map(c => displayPath(c.path)).join("; ")}`);
				}
			}
			checkCancelled();
			await record("Cleanup complete. No rollback is available for deleted folders.");
			await rm(inventoryPath, { force: true });
			return ok(`Permanently removed ${targets.length} installation(s). ${retained ? `Retained ${displayPath(retained.path)}.` : "No installation was explicitly retained."} See cleanup log for optional settings/PATH outcomes.`, logs);
		} catch (error) {
			const message = `Cleanup stopped: ${String(error)}. Completed or partial deletions are not rolled back; inspect the log and any staging paths before retrying.`;
			try { await record(message); } catch (auditError) { logs.push(`Could not update audit log: ${String(auditError)}`); }
			return fail(message, logs);
		}
	};
}
