// ── Shared string parsing utilities ──────────────────────────────────

/** Strip surrounding double quotes and unescape internal escaped quotes. */
export function stripQuotes(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1).replace(/\\"/g, '"');
	}
	return s;
}

/** Find the last comma not inside quotes. Returns -1 if none. */
export function findLastUnquotedComma(input: string): number {
	let inQuote = false;
	let last = -1;
	for (let i = 0; i < input.length; i++) {
		if (input[i] === '"') inQuote = !inQuote;
		else if (input[i] === "," && !inQuote) last = i;
	}
	return last;
}

/** Split input by commas, respecting quoted strings. */
export function splitByComma(input: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inQuote = false;

	for (const ch of input) {
		if (ch === '"') {
			inQuote = !inQuote;
			current += ch;
		} else if (ch === "," && !inQuote) {
			segments.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	segments.push(current);
	return segments;
}

/** Replace escaped quotes (\\") with literal quotes ("). */
export function unescapeQuotes(s: string): string {
	return s.replace(/\\"/g, '"');
}
