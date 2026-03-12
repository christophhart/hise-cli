import type { CICommitInfo, CIStatus } from "./types.js";

const HISE_REPO = "christophhart/HISE";
const BRANCH = "develop";
const API_BASE = "https://api.github.com";
const CI_WORKFLOW_ID = 39324714; // "CI Build" workflow
const FAUST_REPO = "grame-cncm/faust";

// ── Types for GitHub Actions API ────────────────────────────────────

interface GitHubWorkflowRun {
	id: number;
	name: string;
	head_branch: string;
	head_sha: string;
	status: "queued" | "in_progress" | "completed";
	conclusion:
		| "success"
		| "failure"
		| "cancelled"
		| "skipped"
		| "neutral"
		| null;
	created_at: string;
	updated_at: string;
	head_commit: {
		id: string;
		message: string;
		timestamp: string;
	};
}

interface GitHubActionsResponse {
	total_count: number;
	workflow_runs: GitHubWorkflowRun[];
}

// ── Helpers ─────────────────────────────────────────────────────────

function truncateMessage(message: string, maxLength = 50): string {
	const firstLine = message.split("\n")[0];
	if (firstLine.length <= maxLength) return firstLine;
	return firstLine.substring(0, maxLength - 3) + "...";
}

function mapConclusion(
	status: GitHubWorkflowRun["status"],
	conclusion: GitHubWorkflowRun["conclusion"]
): "success" | "failure" | "pending" | "unknown" {
	if (status !== "completed") return "pending";
	if (conclusion === "success") return "success";
	if (conclusion === "failure") return "failure";
	return "unknown";
}

async function fetchJSON<T>(url: string): Promise<T> {
	const response = await fetch(url, {
		headers: {
			Accept: "application/vnd.github.v3+json",
			"User-Agent": "HISE-CLI",
		},
	});

	if (!response.ok) {
		throw new Error(
			`GitHub API error: ${response.status} ${response.statusText}`
		);
	}

	return (await response.json()) as T;
}

// ── CI Status ───────────────────────────────────────────────────────

export async function fetchCIStatus(): Promise<CIStatus> {
	const runsUrl = `${API_BASE}/repos/${HISE_REPO}/actions/workflows/${CI_WORKFLOW_ID}/runs?branch=${BRANCH}&per_page=50`;
	const data = await fetchJSON<GitHubActionsResponse>(runsUrl);

	if (data.workflow_runs.length === 0) {
		throw new Error("No workflow runs found for develop branch");
	}

	const latestRun = data.workflow_runs[0];
	const latestConclusion = mapConclusion(
		latestRun.status,
		latestRun.conclusion
	);

	const latestCommit: CIStatus["latestCommit"] = {
		sha: latestRun.head_sha,
		shortSha: latestRun.head_sha.substring(0, 7),
		message: truncateMessage(latestRun.head_commit.message),
		date: latestRun.created_at,
		conclusion: latestConclusion,
	};

	if (latestConclusion === "success") {
		return {
			latestCommit,
			lastPassingCommit: null,
			isLatestPassing: true,
			checkedAt: new Date().toISOString(),
		};
	}

	const passingRun = data.workflow_runs.find(
		(run) => run.status === "completed" && run.conclusion === "success"
	);

	if (!passingRun) {
		throw new Error(
			"No passing CI build found in recent history. Cannot determine a safe commit to install."
		);
	}

	const lastPassingCommit: CICommitInfo = {
		sha: passingRun.head_sha,
		shortSha: passingRun.head_sha.substring(0, 7),
		message: truncateMessage(passingRun.head_commit.message),
		date: passingRun.created_at,
	};

	return {
		latestCommit,
		lastPassingCommit,
		isLatestPassing: false,
		checkedAt: new Date().toISOString(),
	};
}

/**
 * Returns the SHA of the latest passing CI commit.
 * This is the recommended commit for new installs/updates.
 */
export async function fetchLatestPassingCommit(): Promise<string> {
	const status = await fetchCIStatus();

	if (status.isLatestPassing) {
		return status.latestCommit.sha;
	}

	if (status.lastPassingCommit) {
		return status.lastPassingCommit.sha;
	}

	throw new Error("No passing CI commit found");
}

// ── Faust Version ───────────────────────────────────────────────────

export async function fetchLatestFaustVersion(): Promise<string> {
	const data = await fetchJSON<{ tag_name: string }>(
		`${API_BASE}/repos/${FAUST_REPO}/releases/latest`
	);

	return data.tag_name.replace(/^v/, "");
}
