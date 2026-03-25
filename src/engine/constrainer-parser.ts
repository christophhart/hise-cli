/**
 * ConstrainerParser - TypeScript port of ProcessorMetadata::ConstrainerParser from HISE.
 *
 * Parses a pipe-separated wildcard pattern string used by HISE's module constrainer system.
 * Patterns can be:
 *   - "*"              : match all (no filtering)
 *   - "SubtypeA"       : positive match against module subtype
 *   - "!TypeA|!TypeB"  : negative match against module type id
 *   - "SubtypeA|!TypeB": mixed positive + negative
 *
 * Usage:
 *   const cp = new ConstrainerParser("MasterEffect|MonophonicEffect|!RouteEffect|!SlotFX");
 *   const result = cp.check({ id: "SlotFX", subtype: "MasterEffect" });
 *   // result = { ok: false, error: "negative match" }
 */

export interface ConstrainerTarget {
	id: string;
	subtype: string;
}

export interface ConstrainerResult {
	ok: boolean;
	error?: string;
}

export class ConstrainerParser {
	readonly matchAll: boolean;
	readonly positivePatterns: string[];
	readonly negativePatterns: string[];

	constructor(wildcardPattern: string) {
		this.matchAll = wildcardPattern === "*";
		this.positivePatterns = [];
		this.negativePatterns = [];

		if (!this.matchAll) {
			const tokens = wildcardPattern.split("|");

			for (const t of tokens) {
				if (t.startsWith("!")) {
					this.negativePatterns.push(t.substring(1));
				} else {
					this.positivePatterns.push(t);
				}
			}
		}
	}

	check(md: ConstrainerTarget): ConstrainerResult {
		if (this.matchAll) {
			return { ok: true };
		}

		// Negative check: module type id must not match any exclusion
		for (const n of this.negativePatterns) {
			if (md.id === n) {
				return { ok: false, error: `${md.id} is excluded by constrainer` };
			}
		}

		// Special rule: PolyFilterEffect can match as a positive pattern by id
		const isFilter = md.id === "PolyFilterEffect";

		for (const p of this.positivePatterns) {
			if (isFilter && md.id === p) {
				return { ok: true };
			}

			if (p === md.subtype) {
				return { ok: true };
			}
		}

		if (this.positivePatterns.length > 0) {
			return {
				ok: false,
				error: `${md.subtype} not accepted (expected: ${this.positivePatterns.join(", ")})`,
			};
		}

		return { ok: true };
	}
}
