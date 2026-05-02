// Contract for gitea tag list (`/api/v1/repos/{owner}/{repo}/tags`).
// Spec §5.2.

export interface GiteaTag {
	name: string;
	commitSha: string;
	commitCreated: string;
	zipballUrl: string;
}

export function normalizeGiteaTags(value: unknown): GiteaTag[] {
	if (!Array.isArray(value)) {
		throw new Error("gitea tags response must be an array");
	}
	return value.map((tag, i) => {
		try {
			return normalizeTag(tag);
		} catch (err) {
			throw new Error(`gitea tags[${i}]: ${(err as Error).message}`);
		}
	});
}

function normalizeTag(value: unknown): GiteaTag {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("tag must be an object");
	}
	const data = value as Record<string, unknown>;
	const commit = data.commit;
	if (!commit || typeof commit !== "object" || Array.isArray(commit)) {
		throw new Error("tag.commit must be an object");
	}
	const c = commit as Record<string, unknown>;
	return {
		name: requireString(data.name, "name"),
		commitSha: requireString(c.sha, "commit.sha"),
		commitCreated: requireString(c.created, "commit.created"),
		zipballUrl: requireString(data.zipball_url, "zipball_url"),
	};
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}
