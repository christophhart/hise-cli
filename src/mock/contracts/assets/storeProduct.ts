// Contract for HISE store catalog (`https://store.hise.dev/api/products/`).
// Spec §5.1.

export interface StoreProduct {
	productName: string;
	shortDescription: string;
	path: string;
	thumbnail: string | null;
	repoLink: string;
	vendor: string;   // parsed from repoLink
	repoId: string;   // parsed from repoLink
}

export function normalizeStoreCatalog(value: unknown): StoreProduct[] {
	if (!Array.isArray(value)) {
		throw new Error("store catalog must be an array");
	}
	const out: StoreProduct[] = [];
	for (let i = 0; i < value.length; i++) {
		try {
			const product = normalizeStoreProduct(value[i]);
			if (product) out.push(product);
		} catch (err) {
			throw new Error(`store catalog[${i}]: ${(err as Error).message}`);
		}
	}
	return out;
}

function normalizeStoreProduct(value: unknown): StoreProduct | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("product must be an object");
	}
	const data = value as Record<string, unknown>;
	const repoLink = optionalString(data.repo_link, "repo_link");
	if (!repoLink) {
		// Products without a repo_link cannot be installed; skip silently.
		return null;
	}
	const parsed = parseRepoLink(repoLink);
	if (!parsed) {
		throw new Error(`repo_link does not parse as gitea URL: ${repoLink}`);
	}
	return {
		productName: requireString(data.product_name, "product_name"),
		shortDescription: optionalString(data.product_short_description, "product_short_description") ?? "",
		path: optionalString(data.path, "path") ?? "",
		thumbnail: optionalString(data.thumbnail, "thumbnail") ?? null,
		repoLink,
		vendor: parsed.vendor,
		repoId: parsed.repoId,
	};
}

export function parseRepoLink(repoLink: string): { vendor: string; repoId: string } | null {
	let url: URL;
	try {
		url = new URL(repoLink);
	} catch {
		return null;
	}
	const segments = url.pathname.split("/").filter((s) => s.length > 0);
	if (segments.length < 2) return null;
	return { vendor: segments[0], repoId: segments[1] };
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
