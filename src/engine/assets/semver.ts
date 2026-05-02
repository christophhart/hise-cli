// Semantic version compare for asset package versions.
// Parses tag names like "1.2.3" with optional pre-release suffix ("1.2.3-rc1").
// Mirrors HISE's SemanticVersionChecker behavior: numeric component compare,
// fall back to lexical compare on non-numeric parts.

export interface ParsedVersion {
	major: number;
	minor: number;
	patch: number;
	preRelease: string | null;
	raw: string;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/;

export function parseSemver(tag: string): ParsedVersion | null {
	const m = SEMVER_RE.exec(tag);
	if (!m) return null;
	return {
		major: Number(m[1]),
		minor: Number(m[2]),
		patch: Number(m[3]),
		preRelease: m[4] ?? null,
		raw: tag,
	};
}

// Compare two version strings. Returns negative / 0 / positive in the style of
// Array.sort comparators. Semver-formatted tags compare numerically; non-semver
// tags fall back to lexical compare. A semver tag is always considered greater
// than a non-semver tag.
export function compareVersions(a: string, b: string): number {
	const pa = parseSemver(a);
	const pb = parseSemver(b);
	if (pa && pb) return compareParsed(pa, pb);
	if (pa && !pb) return 1;
	if (!pa && pb) return -1;
	return a < b ? -1 : a > b ? 1 : 0;
}

function compareParsed(a: ParsedVersion, b: ParsedVersion): number {
	if (a.major !== b.major) return a.major - b.major;
	if (a.minor !== b.minor) return a.minor - b.minor;
	if (a.patch !== b.patch) return a.patch - b.patch;
	// Pre-release: a release version (no suffix) outranks any pre-release.
	if (a.preRelease === null && b.preRelease !== null) return 1;
	if (a.preRelease !== null && b.preRelease === null) return -1;
	if (a.preRelease === null && b.preRelease === null) return 0;
	return comparePreRelease(a.preRelease!, b.preRelease!);
}

function comparePreRelease(a: string, b: string): number {
	const pa = a.split(".");
	const pb = b.split(".");
	const n = Math.max(pa.length, pb.length);
	for (let i = 0; i < n; i++) {
		const x = pa[i];
		const y = pb[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const xn = Number(x);
		const yn = Number(y);
		const xIsNum = /^\d+$/.test(x);
		const yIsNum = /^\d+$/.test(y);
		if (xIsNum && yIsNum) {
			if (xn !== yn) return xn - yn;
			continue;
		}
		if (xIsNum && !yIsNum) return -1;
		if (!xIsNum && yIsNum) return 1;
		if (x !== y) return x < y ? -1 : 1;
	}
	return 0;
}

// Pick the largest version from a list. Returns null on empty input.
export function pickLatest(tags: string[]): string | null {
	if (tags.length === 0) return null;
	return [...tags].sort(compareVersions).at(-1)!;
}
