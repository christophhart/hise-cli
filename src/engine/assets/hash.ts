// JUCE String::hashCode64() byte-equivalent.
// Iterates Unicode codepoints (not UTF-16 units), accumulates with multiplier 101,
// wraps on uint64 overflow, reinterprets as int64 for storage.

const MASK_64 = (1n << 64n) - 1n;
const SIGN_BIT = 1n << 63n;
const TWO_64 = 1n << 64n;

export function hashCode64(text: string): bigint {
	let h = 0n;
	for (const ch of text) {
		h = (h * 101n + BigInt(ch.codePointAt(0)!)) & MASK_64;
	}
	return h >= SIGN_BIT ? h - TWO_64 : h;
}

export function hashCode64String(text: string): string {
	return hashCode64(text).toString();
}

// Parse a hash field from the install log. Accepts either a JSON string
// (post-fix HISE / CLI output) or a JSON number (legacy HISE).
export function parseHashField(raw: unknown): bigint | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "string") {
		if (raw === "") return null;
		try {
			return BigInt(raw);
		} catch {
			throw new Error(`Hash field is not a valid integer string: ${raw}`);
		}
	}
	if (typeof raw === "number") {
		if (!Number.isInteger(raw)) {
			throw new Error(`Hash field number is not an integer: ${raw}`);
		}
		return BigInt(raw);
	}
	throw new Error(`Hash field has unsupported type: ${typeof raw}`);
}
