// ── Assets mode — package manager driven by hise-cli's own runtime ──
//
// Subcommand surface lives in `assets-parser.ts`; pure ops live in
// `engine/assets/operations`. This module is glue: parses input, runs ops
// against the AssetEnvironment, and renders the result as a CommandResult.

import type { AssetEnvironment } from "../assets/environment.js";
import {
	addLocalFolder,
	cleanup,
	describeLocalFolder,
	info,
	install,
	listInstalled,
	listLocal,
	listStore,
	login,
	logout,
	readInstallLog,
	readLocalFolders,
	removeLocalFolder,
	uninstall,
	type InstallResult,
	type StoreEntry,
	type InstalledEntrySummary,
	type LocalFolderInfo,
	type PackageInfo,
} from "../assets/operations/index.js";
import { getProjectFolder } from "../assets/hiseAdapter.js";
import type { CompletionEngine } from "../completion/engine.js";
import { tokenizeAssets } from "../highlight/assets.js";
import type { TokenSpan } from "../highlight/tokens.js";
import type { CommandResult } from "../result.js";
import { errorResult, markdownResult } from "../result.js";
import { parseAssetsCommand, type AssetsCommand } from "./assets-parser.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";

const HELP_MARKDOWN = `## Assets Commands

| Command | Description |
|---------|-------------|
| \`list [installed\\|uninstalled\\|local\\|store]\` | List packages by category |
| \`info <name>\` | Show installation state for a package |
| \`install <name> [--version=X.Y.Z] [--dry-run]\` | Install or upgrade a package |
| \`uninstall <name>\` | Remove an installed package |
| \`cleanup <name>\` | Force-remove files left over from a NeedsCleanup uninstall |
| \`local add <path>\` | Register a local HISE project folder as a package source |
| \`local remove <name\\|path>\` | Unregister a local folder |
| \`auth login [--token=<t>]\` | Persist a HISE store token |
| \`auth logout\` | Clear the persisted store token |
| \`help\` | Show this list |

Install resolves \`<name>\` against local folders first, then the store. Pass
\`--dry-run\` to preview changes without writing files.`;

interface CompletionCache {
	installedNames: string[];
	localNames: string[];
	needsCleanupNames: string[];
}

const EMPTY_CACHE: CompletionCache = {
	installedNames: [],
	localNames: [],
	needsCleanupNames: [],
};

const MUTATING_COMMANDS = new Set([
	"install", "uninstall", "cleanup", "localAdd", "localRemove",
]);

export class AssetsMode implements Mode {
	readonly id: Mode["id"] = "assets";
	readonly name = "Assets";
	readonly accent = MODE_ACCENTS.assets;
	readonly prompt = "[assets] > ";

	private readonly env: AssetEnvironment | null;
	private readonly completionEngine: CompletionEngine | null;
	private cache: CompletionCache = EMPTY_CACHE;

	constructor(env: AssetEnvironment | null, completionEngine?: CompletionEngine) {
		this.env = env;
		this.completionEngine = completionEngine ?? null;
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeAssets(value);
	}

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) return { items: [], from: 0, to: input.length };
		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const items = this.completionEngine.completeAssets(trimmed, this.cache);
		// Replace only the trailing token, not the whole input.
		const lastSpace = input.lastIndexOf(" ");
		const from = lastSpace === -1 ? leadingSpaces : lastSpace + 1;
		return { items, from, to: input.length, label: "Assets commands" };
	}

	async onEnter(_session: SessionContext): Promise<void> {
		await this.refreshCache();
	}

	async parse(input: string, _session: SessionContext): Promise<CommandResult> {
		const command = parseAssetsCommand(input);
		if (command.type === "help") return markdownResult(HELP_MARKDOWN);
		if (command.type === "error") return errorResult(command.message);

		if (!this.env) {
			return errorResult(
				"Asset operations are unavailable: no asset environment wired in this build.",
				"This frontend does not yet provide filesystem / HTTP / zip backends for the assets mode.",
			);
		}

		try {
			const result = await dispatch(this.env, command);
			if (MUTATING_COMMANDS.has(command.type)) {
				await this.refreshCache();
			}
			return result;
		} catch (err) {
			return errorResult(`Asset command failed: ${(err as Error).message}`);
		}
	}

	private async refreshCache(): Promise<void> {
		if (!this.env) return;
		const next: CompletionCache = {
			installedNames: [],
			localNames: [],
			needsCleanupNames: [],
		};
		try {
			const projectFolder = await getProjectFolder(this.env.hise);
			const log = await readInstallLog(this.env, projectFolder);
			next.installedNames = log.map((e) => e.name);
			next.needsCleanupNames = log
				.filter((e) => e.kind === "needsCleanup")
				.map((e) => e.name);
		} catch { /* HISE offline or log corrupt — leave list empty */ }
		try {
			const local = await listLocal(this.env);
			next.localNames = local
				.map((l) => l.name)
				.filter((n): n is string => typeof n === "string" && n.length > 0);
		} catch { /* keep empty */ }
		this.cache = next;
	}
}

async function dispatch(env: AssetEnvironment, cmd: AssetsCommand): Promise<CommandResult> {
	switch (cmd.type) {
		case "list":              return runList(env, cmd.filter);
		case "info":              return formatInfo(await info(env, cmd.name));
		case "install":           return formatInstall(await runInstall(env, cmd));
		case "uninstall":         return formatUninstall(await uninstall(env, cmd.name));
		case "cleanup":           return formatCleanup(await cleanup(env, cmd.name));
		case "localAdd":          return formatLocalAdd(await addLocalFolder(env, cmd.path));
		case "localRemove":       return formatLocalRemove(await removeLocalFolder(env, cmd.query));
		case "authLogin": {
			const token = cmd.token;
			if (!token) {
				return errorResult(
					"auth login requires a token (--token=<t>).",
					"Generate a personal access token at https://store.hise.dev/account/settings/",
				);
			}
			const r = await login(env, token);
			return formatLogin(r);
		}
		case "authLogout":        await logout(env); return markdownResult("Cleared stored token.");
		default:                  return errorResult("Internal: unhandled command kind");
	}
}

async function runInstall(env: AssetEnvironment, cmd: Extract<AssetsCommand, { type: "install" }>): Promise<InstallResult> {
	// Resolve <name> against local folders first; fall through to the store
	// when no local folder claims that package name. Use `local add <path>`
	// to register a folder before installing from it.
	const localFolder = await findLocalFolderByName(env, cmd.name);
	if (localFolder) {
		return install(env, {
			source: { kind: "local", folder: localFolder },
			dryRun: cmd.dryRun,
		});
	}
	return install(env, {
		source: { kind: "store", packageName: cmd.name, version: cmd.version },
		dryRun: cmd.dryRun,
	});
}

async function findLocalFolderByName(env: AssetEnvironment, name: string): Promise<string | null> {
	let folders: string[];
	try {
		folders = await readLocalFolders(env);
	} catch {
		return null;
	}
	for (const folder of folders) {
		try {
			const info = await describeLocalFolder(env, folder);
			if (info.name === name) return folder;
		} catch {
			// Skip folders that fail to parse rather than aborting the resolve.
			continue;
		}
	}
	return null;
}

// ── Formatters ────────────────────────────────────────────────────

async function runList(env: AssetEnvironment, filter: string): Promise<CommandResult> {
	if (filter === "installed") return formatInstalled(await listInstalled(env));
	if (filter === "local")     return formatLocal(await listLocal(env));
	if (filter === "store")     return formatStore(await listStore(env));
	if (filter === "uninstalled") {
		const [installed, local, store] = await Promise.all([
			listInstalled(env),
			listLocal(env),
			listStore(env).catch(() => [] as StoreEntry[]),
		]);
		const installedNames = new Set(installed.map((e) => e.name));
		const out: string[] = [];
		for (const l of local) if (l.name && !installedNames.has(l.name)) out.push(`local: ${l.name}@${l.version ?? "?"}`);
		for (const s of store) if (!installedNames.has(s.repoId)) out.push(`store: ${s.repoId} (${s.productName})`);
		if (out.length === 0) return markdownResult("All known packages are installed.");
		return markdownResult(`### Uninstalled\n\n${out.map((l) => `- ${l}`).join("\n")}`);
	}
	// "all"
	const [installed, local] = await Promise.all([
		listInstalled(env),
		listLocal(env),
	]);
	const sections: string[] = [];
	sections.push(formatInstalledMd(installed));
	sections.push(formatLocalMd(local));
	return markdownResult(sections.join("\n\n"));
}

function formatInstalled(rows: InstalledEntrySummary[]): CommandResult {
	return markdownResult(formatInstalledMd(rows));
}

function formatInstalledMd(rows: InstalledEntrySummary[]): string {
	if (rows.length === 0) return "### Installed\n\n_None._";
	const body = rows.map((r) => {
		const flag = r.needsCleanup ? " ⚠ NeedsCleanup" : "";
		return `| \`${r.name}\` | ${r.version} | ${r.mode}${flag} |`;
	}).join("\n");
	return `### Installed\n\n| Name | Version | Mode |\n|------|---------|------|\n${body}`;
}

function formatLocal(rows: LocalFolderInfo[]): CommandResult {
	return markdownResult(formatLocalMd(rows));
}

function formatLocalMd(rows: LocalFolderInfo[]): string {
	if (rows.length === 0) return "### Local Folders\n\n_None registered._";
	const body = rows.map((r) =>
		`| \`${r.name ?? "(unknown)"}\` | ${r.version ?? "?"} | ${r.company ?? ""} | \`${r.folder}\` |`).join("\n");
	return `### Local Folders\n\n| Name | Version | Company | Path |\n|------|---------|---------|------|\n${body}`;
}

function formatStore(rows: StoreEntry[]): CommandResult {
	if (rows.length === 0) return markdownResult("### Store\n\n_Empty catalog._");
	const body = rows.map((r) => {
		const owned = r.owned === null ? "?" : r.owned ? "✓" : "—";
		return `| \`${r.repoId}\` | ${r.productName} | ${r.vendor} | ${owned} |`;
	}).join("\n");
	return markdownResult(
		`### Store\n\n| ID | Product | Vendor | Owned |\n|----|---------|--------|-------|\n${body}`,
	);
}

function formatInfo(p: PackageInfo): CommandResult {
	const lines: string[] = [`# ${p.name}`, ""];
	lines.push(`**State**: \`${p.state}\``);
	if (p.installed) {
		lines.push("", "## Installed",
			`- Version: ${p.installed.version}`,
			`- Company: ${p.installed.company}`,
			`- Mode: ${p.installed.mode}`,
			`- Date: ${p.installed.date}`,
		);
		if (p.installed.needsCleanup) lines.push("- ⚠ NeedsCleanup");
	}
	if (p.local) {
		lines.push("", "## Local Source",
			`- Folder: \`${p.local.folder}\``,
			`- Version: ${p.local.version ?? "?"}`,
			`- Company: ${p.local.company ?? "?"}`,
		);
	}
	return markdownResult(lines.join("\n"));
}

function formatInstall(r: InstallResult): CommandResult {
	switch (r.kind) {
		case "ok": {
			const files = r.entry.steps
				.filter((s): s is Extract<typeof s, { type: "File" }> => s.type === "File")
				.map((s) => s.target);
			const lines = [
				`Installed **${r.entry.name}** ${r.entry.version} (${r.entry.mode}).`,
				"",
				`### Files (${files.length})`,
			];
			const FILE_CAP = 50;
			lines.push(...files.slice(0, FILE_CAP).map((f) => `- \`${f}\``));
			if (files.length > FILE_CAP) {
				lines.push(`- _… ${files.length - FILE_CAP} more_`);
			}
			if (r.warnings.length > 0) {
				lines.push("", "_Warnings:_", ...r.warnings.map((w) => `- ${w}`));
			}
			if (r.infoText.length > 0) lines.push("", r.infoText);
			if (r.clipboardWritten) lines.push("", "_Clipboard updated._");
			return markdownResult(lines.join("\n"));
		}
		case "alreadyInstalled":
			return markdownResult(`**${r.existingVersion}** is already installed.`);
		case "fileConflict":
			return errorResult(
				"File conflict: target paths exist on disk but are not claimed by an installed package.",
				r.collisions.map((p) => `- ${p}`).join("\n"),
			);
		case "invalidPackage":
			return errorResult(`Invalid package: ${r.message}`);
		case "corruptedLog":
			return errorResult(`install_packages_log.json is corrupted: ${r.message}`);
		case "transportError":
			return errorResult(`Transport error: ${r.message}`);
		case "needsCleanupFirst":
			return errorResult(
				`${r.package} has user-modified files from a previous uninstall.`,
				`Run \`cleanup ${r.package}\` first, then retry install.`,
			);
		case "missingToken":
			return errorResult(
				"Store install requires a token.",
				"Run `auth login --token=<t>` first, or pass `--token=<t>` to this command.",
			);
		case "dryRun": {
			const p = r.preview;
			const lines = [`# Dry-run: ${p.packageName}@${p.packageVersion}`, ""];
			lines.push(`### Files (${p.files.length})`);
			lines.push(...p.files.slice(0, 50).map((f) => `- ${f}`));
			if (p.files.length > 50) lines.push(`- ... ${p.files.length - 50} more`);
			if (Object.keys(p.preprocessors).length > 0) {
				lines.push("", "### Preprocessors");
				for (const [k, [oldV, newV]] of Object.entries(p.preprocessors)) {
					lines.push(`- ${k}: ${oldV ?? "(unset)"} → ${newV}`);
				}
			}
			if (Object.keys(p.settings).length > 0) {
				lines.push("", "### Settings");
				for (const [k, [oldV, newV]] of Object.entries(p.settings)) {
					lines.push(`- ${k}: ${oldV} → ${newV}`);
				}
			}
			if (p.infoText.length > 0) lines.push("", "### Info", p.infoText);
			if (p.clipboardContent.length > 0) lines.push("", "### Clipboard", "```", p.clipboardContent, "```");
			if (p.warnings.length > 0) lines.push("", "### Warnings", ...p.warnings.map((w) => `- ${w}`));
			return markdownResult(lines.join("\n"));
		}
	}
}

function formatUninstall(r: Awaited<ReturnType<typeof uninstall>>): CommandResult {
	switch (r.kind) {
		case "ok": {
			const lines = [`Uninstalled (${r.deleted.length} deleted, ${r.skipped.length} skipped).`];
			if (r.needsCleanup) {
				lines.push("", "⚠ NeedsCleanup state — run `cleanup <name>` to remove the modified files when ready.");
				lines.push(...r.skipped.slice(0, 10).map((p) => `- ${p}`));
				if (r.skipped.length > 10) lines.push(`- ... ${r.skipped.length - 10} more`);
			}
			return markdownResult(lines.join("\n"));
		}
		case "notFound":           return errorResult(`Package not installed: ${r.package}`);
		case "alreadyNeedsCleanup":return errorResult(`${r.package} is already in NeedsCleanup state. Run cleanup instead.`);
		case "transportError":     return errorResult(`Transport error: ${r.message}`);
	}
}

function formatCleanup(r: Awaited<ReturnType<typeof cleanup>>): CommandResult {
	switch (r.kind) {
		case "ok": {
			const lines = [`Cleanup: ${r.deleted.length} deleted, ${r.remaining.length} remaining.`];
			if (r.remaining.length > 0) lines.push("", "_Could not delete:_", ...r.remaining.map((p) => `- ${p}`));
			return markdownResult(lines.join("\n"));
		}
		case "notFound":          return errorResult(`Package not in install log: ${r.package}`);
		case "notNeedsCleanup":   return errorResult(`${r.package} is not in NeedsCleanup state.`);
	}
}

function formatLocalAdd(r: Awaited<ReturnType<typeof addLocalFolder>>): CommandResult {
	if (r.kind === "ok") {
		return markdownResult(`Registered local folder \`${r.folder}\` (${r.info.name ?? "?"}@${r.info.version ?? "?"}).`);
	}
	if (r.kind === "duplicate") return errorResult(`Folder already registered: ${r.folder}`);
	return errorResult(`Folder is missing project_info.xml: ${r.folder}`);
}

function formatLocalRemove(r: Awaited<ReturnType<typeof removeLocalFolder>>): CommandResult {
	if (r.kind === "ok") return markdownResult(`Removed \`${r.folder}\` from local folders.`);
	return errorResult(`No local folder matched: ${r.query}`);
}

function formatLogin(r: Awaited<ReturnType<typeof login>>): CommandResult {
	if (r.kind === "ok") return markdownResult(`Logged in as **${r.user.displayName}**.`);
	if (r.kind === "invalidToken") return errorResult(r.message);
	return errorResult(`Network error: ${r.message}`);
}

