// ── Publish wizard init handler — preflight detection ────────────────
//
// Resolves the active HISE project folder, reads project metadata, runs
// binary discovery, and probes for tooling + certs (ISCC, signtool, cert
// store on Windows; pkgbuild, Developer ID, notary profile on macOS).
//
// Critical failures (no project, no binaries, missing iscc/pkgbuild)
// throw WizardInitAbortError so the wizard never opens. Non-critical
// findings (no cert, no notary profile) flip the corresponding `has*`
// flag to "0" so the form gates the relevant toggle.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { InternalInitHandler } from "../../engine/wizard/handler-registry.js";
import type { PhaseExecutor } from "../../engine/wizard/phase-executor.js";
import { WizardInitAbortError } from "../../engine/wizard/executor.js";
import {
	parseProjectInfo,
	parseUserInfo,
	ProjectInfoParseError,
	type ProjectInfo,
	type UserInfo,
} from "../../engine/project/project-info-xml.js";
import {
	discoverBinaries,
	discoveryToCsv,
	type Platform,
} from "../../engine/project/binary-discovery.js";

export interface PublishDetectDeps {
	readonly executor: PhaseExecutor;
	/** Resolves the active HISE project folder. Returning null aborts the
	 *  wizard with a friendly message. The default resolver chains
	 *  env → HISE projects.xml → cwd; tests typically supply a stub. */
	readonly resolveProjectFolder?: () => Promise<string | null>;
}

/** Default project-folder resolution chain used by `bootstrapNodeRuntime`. */
export function defaultResolveProjectFolder(): () => Promise<string | null> {
	return async () => {
		const fromEnv = process.env.HISE_PROJECT_FOLDER;
		if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
		const fromXml = await readActiveProjectFromHiseAppData();
		if (fromXml) return fromXml;
		const cwd = process.cwd();
		if (await fileExists(join(cwd, "project_info.xml"))) return cwd;
		return null;
	};
}

export function createPublishDetectHandler(
	deps: PublishDetectDeps,
): InternalInitHandler {
	return async (_wizardId) => {
		const platform = detectPlatform();
		const defaults: Record<string, string> = { platform };

		if (platform === "Linux") {
			throw new WizardInitAbortError(
				"Linux installer builds are not yet supported. /publish currently " +
					"targets Windows (Inno Setup) and macOS (pkgbuild) only.",
			);
		}

		// 1. Resolve project folder via the supplied resolver (or default chain).
		const resolver = deps.resolveProjectFolder ?? defaultResolveProjectFolder();
		const projectFolder = await resolver();
		if (!projectFolder) {
			throw new WizardInitAbortError(
				"No HISE project folder set. Run `/project switch <path>` first, " +
					"or set HISE_PROJECT_FOLDER in your environment.",
			);
		}

		// 2. Read project_info.xml + user_info.xml.
		const project = await readProjectMetadata(projectFolder);
		if (!project) {
			throw new WizardInitAbortError(
				`Could not read project_info.xml in ${projectFolder}. The folder ` +
					`does not look like a HISE project.`,
			);
		}
		defaults.version = project.info.version;
		defaults.projectName = project.info.name;
		defaults.bundleIdentifier = project.info.bundleIdentifier;
		defaults.companyName = project.user?.company ?? "";
		defaults.projectFolder = projectFolder;

		// 3. Discover binaries.
		const discovery = await discoverBinaries({
			projectFolder,
			platform,
			list: async (dir: string) => {
				try {
					return await readdir(dir);
				} catch {
					return [];
				}
			},
		});
		const csv = discoveryToCsv(discovery);
		defaults.discoveredBinaries = csv;
		defaults.payload = csv;
		if (discovery.vst3) defaults.vst3Path = discovery.vst3;
		if (discovery.au) defaults.auPath = discovery.au;
		if (discovery.aax) defaults.aaxPath = discovery.aax;
		if (discovery.standalone) defaults.standalonePath = discovery.standalone;
		if (csv.length === 0) {
			throw new WizardInitAbortError(
				`No plugin binaries discovered under ${projectFolder}/Binaries/. ` +
					`Run \`/project export project --default\` first.`,
			);
		}

		// 4. Platform-specific tool + cert detection.
		if (platform === "Windows") {
			await detectWindows(deps.executor, defaults);
		} else {
			await detectMacOS(deps.executor, defaults);
		}

		return defaults;
	};
}

// ── Project folder resolution helpers ────────────────────────────────

async function readActiveProjectFromHiseAppData(): Promise<string | null> {
	const platform = detectPlatform();
	let xmlPath: string;
	if (platform === "Windows") {
		const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
		xmlPath = join(appData, "HISE", "projects.xml");
	} else if (platform === "macOS") {
		xmlPath = join(homedir(), "Library", "Application Support", "HISE", "projects.xml");
	} else {
		const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
		xmlPath = join(xdg, "HISE", "projects.xml");
	}
	try {
		const xml = await readFile(xmlPath, "utf-8");
		const match = xml.match(/current="([^"]+)"/);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await readFile(path, "utf-8");
		return true;
	} catch {
		return false;
	}
}

// ── Project metadata ─────────────────────────────────────────────────

interface ProjectMetadata {
	readonly info: ProjectInfo;
	readonly user?: UserInfo;
}

async function readProjectMetadata(folder: string): Promise<ProjectMetadata | null> {
	let xml: string;
	try {
		xml = await readFile(join(folder, "project_info.xml"), "utf-8");
	} catch {
		return null;
	}
	let info: ProjectInfo;
	try {
		info = parseProjectInfo(xml);
	} catch (err) {
		if (err instanceof ProjectInfoParseError) return null;
		throw err;
	}

	let user: UserInfo | undefined;
	try {
		const userXml = await readFile(join(folder, "user_info.xml"), "utf-8");
		user = parseUserInfo(userXml);
	} catch {
		// user_info.xml is optional — older / minimal projects may not have it.
	}

	return { info, user };
}

// ── Platform detection ───────────────────────────────────────────────

function detectPlatform(): Platform {
	if (process.platform === "win32") return "Windows";
	if (process.platform === "darwin") return "macOS";
	return "Linux";
}

// ── Windows tooling + cert detection ─────────────────────────────────

async function detectWindows(
	executor: PhaseExecutor,
	defaults: Record<string, string>,
): Promise<void> {
	const iscc = await executor.spawn("where", ["iscc"], {});
	defaults.hasIscc = iscc.exitCode === 0 ? "1" : "0";

	if (defaults.hasIscc !== "1") {
		throw new WizardInitAbortError(
			"Inno Setup compiler (iscc) not found on PATH. Install Inno Setup 6 " +
				"and ensure ISCC is on the system PATH, then retry.",
		);
	}

	const signtool = await executor.spawn("where", ["signtool"], {});
	defaults.hasSigntool = signtool.exitCode === 0 ? "1" : "0";

	const cert = await detectWindowsSigningCert(executor);
	defaults.hasWinCert = cert ? "1" : "0";
	if (cert) defaults.codesignThumbprint = cert.thumbprint;
	defaults.codesign = defaults.hasWinCert === "1" ? "1" : "0";

	// macOS-only fields default to "0" / empty so the form has values to read.
	defaults.hasPkgbuild = "0";
	defaults.hasDevId = "0";
	defaults.hasNotaryProfile = "0";
	defaults.notarize = "0";
}

interface WindowsCert {
	readonly thumbprint: string;
	readonly subject: string;
}

async function detectWindowsSigningCert(
	executor: PhaseExecutor,
): Promise<WindowsCert | null> {
	const cmd =
		"Get-ChildItem Cert:\\CurrentUser\\My -CodeSigningCert | " +
		"Select-Object -First 1 Thumbprint, Subject | ConvertTo-Json -Compress";
	const result = await executor.spawn(
		"powershell",
		["-NoProfile", "-Command", cmd],
		{},
	);
	if (result.exitCode !== 0) return null;
	const trimmed = result.stdout.trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed) as {
			Thumbprint?: unknown;
			Subject?: unknown;
		};
		if (
			typeof parsed.Thumbprint === "string" &&
			typeof parsed.Subject === "string"
		) {
			return { thumbprint: parsed.Thumbprint, subject: parsed.Subject };
		}
	} catch {
		// PowerShell sometimes emits non-JSON when the store is empty — treat
		// as "no cert" rather than crashing the preflight.
	}
	return null;
}

// ── macOS tooling + cert detection ───────────────────────────────────

async function detectMacOS(
	executor: PhaseExecutor,
	defaults: Record<string, string>,
): Promise<void> {
	const pkgbuild = await executor.spawn("which", ["pkgbuild"], {});
	defaults.hasPkgbuild = pkgbuild.exitCode === 0 ? "1" : "0";

	if (defaults.hasPkgbuild !== "1") {
		throw new WizardInitAbortError(
			"pkgbuild not found on PATH. Install Xcode Command Line Tools " +
				"(xcode-select --install) and retry.",
		);
	}

	const identity = await detectDeveloperIdApplication(executor);
	defaults.hasDevId = identity ? "1" : "0";
	if (identity) defaults.signingIdentity = identity;
	defaults.codesign = defaults.hasDevId === "1" ? "1" : "0";

	const profile = await detectNotaryProfile(executor, "notarize");
	defaults.hasNotaryProfile = profile ? "1" : "0";
	defaults.notarize = profile ? "1" : "0";

	// Windows-only fields stub out so form has values.
	defaults.hasIscc = "0";
	defaults.hasSigntool = "0";
	defaults.hasWinCert = "0";
}

async function detectDeveloperIdApplication(
	executor: PhaseExecutor,
): Promise<string | null> {
	const result = await executor.spawn(
		"security",
		["find-identity", "-v", "-p", "codesigning"],
		{},
	);
	if (result.exitCode !== 0) return null;
	const match = /"(Developer ID Application: [^"]+)"/.exec(result.stdout);
	return match?.[1] ?? null;
}

async function detectNotaryProfile(
	executor: PhaseExecutor,
	profileName: string,
): Promise<boolean> {
	const result = await executor.spawn(
		"xcrun",
		["notarytool", "history", "--keychain-profile", profileName, "--limit", "1"],
		{},
	);
	return result.exitCode === 0;
}
