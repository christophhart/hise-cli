// ── Pure parsers for /publish mode arguments ────────────────────────

export const ALLOWED_PAYLOAD = ["VST3", "AU", "AAX", "Standalone"] as const;
export type PayloadTarget = (typeof ALLOWED_PAYLOAD)[number];

export type PayloadParseResult =
	| { readonly ok: true; readonly targets: PayloadTarget[] }
	| { readonly ok: false; readonly error: string };

/** Parse a comma-separated list of binary targets (case-insensitive).
 *  Rejects empty input, unknown tokens, and duplicates. */
export function parsePayloadList(raw: string): PayloadParseResult {
	const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
	if (tokens.length === 0) {
		return { ok: false, error: "Empty payload list." };
	}
	const out: PayloadTarget[] = [];
	for (const token of tokens) {
		const match = ALLOWED_PAYLOAD.find(
			(allowed) => allowed.toLowerCase() === token.toLowerCase(),
		);
		if (!match) {
			return {
				ok: false,
				error: `Unknown payload "${token}". Allowed: ${ALLOWED_PAYLOAD.join(", ")}`,
			};
		}
		if (out.includes(match)) {
			return { ok: false, error: `Duplicate payload "${match}".` };
		}
		out.push(match);
	}
	return { ok: true, targets: out };
}
