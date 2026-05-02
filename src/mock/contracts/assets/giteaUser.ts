// Contract for gitea user/repo responses. Spec §5.2 + §13.1.

export interface GiteaUser {
	username: string;
	email: string | null;
	displayName: string;
}

export interface GiteaRepo {
	name: string;
	owner: string;
	url: string;
}

export function normalizeGiteaUser(value: unknown): GiteaUser {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("gitea user response must be an object");
	}
	const data = value as Record<string, unknown>;
	// Gitea may use "login" or "username" depending on version.
	const username = optionalString(data.username, "username")
		?? optionalString(data.login, "login");
	if (!username) {
		throw new Error("gitea user response missing username/login");
	}
	const email = optionalString(data.email, "email") ?? null;
	return {
		username,
		email,
		displayName: email ?? username,
	};
}

export function normalizeGiteaRepos(value: unknown): GiteaRepo[] {
	if (!Array.isArray(value)) {
		throw new Error("gitea repos response must be an array");
	}
	return value.map((repo, i) => {
		try {
			return normalizeRepo(repo);
		} catch (err) {
			throw new Error(`gitea repos[${i}]: ${(err as Error).message}`);
		}
	});
}

function normalizeRepo(value: unknown): GiteaRepo {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("repo must be an object");
	}
	const data = value as Record<string, unknown>;
	const owner = data.owner;
	if (!owner || typeof owner !== "object" || Array.isArray(owner)) {
		throw new Error("repo.owner must be an object");
	}
	const o = owner as Record<string, unknown>;
	return {
		name: requireString(data.name, "name"),
		owner: requireString(o.username ?? o.login, "owner.username"),
		url: requireString(data.url, "url"),
	};
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}
