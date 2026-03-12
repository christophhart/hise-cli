// ── Platform & Architecture ─────────────────────────────────────────

export type Platform = "windows" | "macos" | "linux";
export type Architecture = "x64" | "arm64";

// ── Setup Configuration ─────────────────────────────────────────────

export interface SetupConfig {
	platform: Platform;
	architecture: Architecture;
	installPath: string;
	includeFaust: boolean;
	includeIPP: boolean; // Windows only
	targetCommit?: string; // specific commit SHA, or undefined for latest passing CI
	faustVersion?: string; // latest Faust version string
}

export interface UpdateConfig {
	platform: Platform;
	architecture: Architecture;
	hisePath: string;
	hasFaust: boolean;
	targetCommit?: string;
	faustVersion?: string;
}

export interface MigrateConfig {
	platform: Platform;
	architecture: Architecture;
	existingPath: string;
	hasFaust: boolean;
	keepBackup: boolean;
	targetCommit?: string;
	faustVersion?: string;
}

export interface NukeConfig {
	platform: Platform;
	installationPaths: string[];
	removeSettings: boolean;
	removePathEntries: boolean;
}

// ── Detection ───────────────────────────────────────────────────────

export interface DetectedEnvironment {
	platform: Platform;
	architecture: Architecture;
	hasGit: boolean;
	hasCompiler: boolean;
	compilerInfo?: string; // e.g. "Visual Studio 2022 Community" or "Xcode 15.2"
	hasFaust: boolean;
	faustPath?: string;
	hasIPP: boolean; // Windows only
	hiseInstallations: DetectedHiseInstall[];
}

export interface DetectedHiseInstall {
	path: string;
	isGitRepo: boolean;
	hasFaust: boolean;
	commitHash?: string;
}

// ── Phase Execution ─────────────────────────────────────────────────

export type PhaseStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface PhaseDefinition {
	id: string;
	name: string;
	description: string;
	/** If true, phase needs elevated privileges (sudo / admin) */
	requiresElevation?: boolean;
	/** If true, phase is destructive and needs extra confirmation */
	destructive?: boolean;
	/**
	 * Platform-specific shell commands to execute.
	 * Each string is one command line.
	 * Commands run in the working directory set by `cwd`.
	 */
	commands: (config: SetupConfig | UpdateConfig | MigrateConfig | NukeConfig) => PhaseCommands;
}

export interface PhaseCommands {
	/** Shell to use: "powershell" on Windows, "bash" on macOS/Linux */
	shell: "powershell" | "bash";
	/** Working directory for this phase */
	cwd: string;
	/** Lines of shell script to execute as a single block */
	script: string;
	/** Environment variables to set for this phase */
	env?: Record<string, string>;
}

export interface PhaseResult {
	id: string;
	status: PhaseStatus;
	exitCode?: number;
	stdout: string;
	stderr: string;
	durationMs: number;
	error?: string;
}

// ── CI Status ───────────────────────────────────────────────────────

export interface CICommitInfo {
	sha: string;
	shortSha: string;
	message: string;
	date: string;
}

export interface CIStatus {
	latestCommit: CICommitInfo & {
		conclusion: "success" | "failure" | "pending" | "unknown";
	};
	lastPassingCommit: CICommitInfo | null;
	isLatestPassing: boolean;
	checkedAt: string;
}

// ── Prerequisite Check ──────────────────────────────────────────────

export type PrereqStatus = "found" | "missing" | "wrong-version";

export interface PrereqAction {
	label: string;
	action: "open-url" | "run-command" | "recheck";
	url?: string;
	command?: string;
}

export interface PrereqCheckResult {
	id: string;
	name: string;
	status: PrereqStatus;
	detail?: string;
	required: boolean;
	actions: PrereqAction[];
}

// ── Default Paths ───────────────────────────────────────────────────

export const DEFAULT_INSTALL_PATHS: Record<Platform, string> = {
	windows: "C:\\HISE",
	macos: "~/HISE",
	linux: "~/HISE",
};

// ── Settings Paths ──────────────────────────────────────────────────

export const SETTINGS_PATHS: Record<Platform, string> = {
	windows: "%APPDATA%\\HISE",
	macos: "~/Library/Application Support/HISE",
	linux: "~/.config/HISE",
};
