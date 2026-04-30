// ── Plugin binary discovery — pure module ───────────────────────────
//
// Probes the well-known output paths HISE writes after `export project`
// finishes. Hardcoded paths come from the existing CI workflow at the
// repo root (`develop-build.yml`). The function takes an injected
// `list()` so unit tests can simulate the filesystem; the Node-side
// caller binds it to `node:fs/promises.readdir`.
//
// One target = one bundle / one binary. We return only the *first*
// match per target — HISE doesn't produce sibling builds inside the
// same Compiled/Release folder. Callers needing multi-arch enumeration
// can adapt later.

export type Platform = "macOS" | "Windows" | "Linux";
export type BinaryTarget = "VST3" | "AU" | "AAX" | "Standalone";

export interface BinaryDiscovery {
	readonly vst3?: string;
	readonly au?: string;
	readonly aax?: string;
	readonly standalone?: string;
}

export interface DiscoverOptions {
	readonly projectFolder: string;
	readonly platform: Platform;
	/** Returns the entries (file or dir names) inside `dir`, or [] if dir missing. */
	readonly list: (dir: string) => Promise<string[]>;
	/** Optional override for path joining; default uses platform separator. */
	readonly join?: (...parts: string[]) => string;
}

const WIN_PROBES: Record<Exclude<BinaryTarget, "AU">, {
	dir: string[];
	suffix: string;
}> = {
	VST3: { dir: ["Binaries", "Compiled", "VST3"], suffix: ".vst3" },
	AAX: { dir: ["Binaries", "Compiled", "AAX"], suffix: ".aaxplugin" },
	Standalone: { dir: ["Binaries", "Compiled", "App"], suffix: ".exe" },
};

const MAC_PROBES: Record<BinaryTarget, { dir: string[]; suffix: string }> = {
	VST3: {
		dir: ["Binaries", "Builds", "MacOSXMakefile", "build", "Release"],
		suffix: ".vst3",
	},
	AU: {
		dir: ["Binaries", "Builds", "MacOSXMakefile", "build", "Release"],
		suffix: ".component",
	},
	AAX: {
		dir: ["Binaries", "Builds", "MacOSXMakefile", "build", "Release"],
		suffix: ".aaxplugin",
	},
	Standalone: {
		dir: ["Binaries", "Builds", "MacOSXMakefile", "build", "Release"],
		suffix: ".app",
	},
};

function defaultJoin(separator: string) {
	return (...parts: string[]) => parts.join(separator);
}

export async function discoverBinaries(
	opts: DiscoverOptions,
): Promise<BinaryDiscovery> {
	const join = opts.join ?? defaultJoin(opts.platform === "Windows" ? "\\" : "/");
	const probes = opts.platform === "Windows" ? WIN_PROBES : MAC_PROBES;

	const result: { -readonly [K in keyof BinaryDiscovery]: BinaryDiscovery[K] } =
		{};

	for (const [targetRaw, probe] of Object.entries(probes)) {
		const target = targetRaw as BinaryTarget;
		const dir = join(opts.projectFolder, ...probe.dir);
		let entries: string[];
		try {
			entries = await opts.list(dir);
		} catch {
			continue;
		}
		const match = entries.find((e) =>
			e.toLowerCase().endsWith(probe.suffix.toLowerCase()),
		);
		if (!match) continue;
		const fullPath = join(dir, match);
		switch (target) {
			case "VST3":
				result.vst3 = fullPath;
				break;
			case "AU":
				result.au = fullPath;
				break;
			case "AAX":
				result.aax = fullPath;
				break;
			case "Standalone":
				result.standalone = fullPath;
				break;
		}
	}

	return result;
}

export function discoveryToCsv(d: BinaryDiscovery): string {
	const out: BinaryTarget[] = [];
	if (d.vst3) out.push("VST3");
	if (d.au) out.push("AU");
	if (d.aax) out.push("AAX");
	if (d.standalone) out.push("Standalone");
	return out.join(",");
}
