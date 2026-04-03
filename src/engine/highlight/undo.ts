// ── Undo mode tokenizer ──────────────────────────────────────────────

import type { TokenSpan, TokenType } from "./tokens.js";
import { tokenizeSlash } from "./slash.js";

const UNDO_KEYWORDS = new Set([
	"back", "forward", "clear",
	"plan", "apply", "discard",
	"diff", "history",
]);

const RULES: Array<{ pattern: RegExp; token: TokenType }> = [
	{ pattern: /^"(?:[^"\\]|\\.)*"/, token: "string" },
	{ pattern: /^'(?:[^'\\]|\\.)*'/, token: "string" },
	{ pattern: /^\d+/, token: "integer" },
	{ pattern: /^[a-zA-Z_][a-zA-Z0-9_]*/, token: "identifier" },
	{ pattern: /^\s+/, token: "plain" },
];

export function tokenizeUndo(source: string): TokenSpan[] {
	if (source.startsWith("/")) {
		return tokenizeSlash(source);
	}

	const spans: TokenSpan[] = [];
	let pos = 0;

	while (pos < source.length) {
		let matched = false;

		for (const rule of RULES) {
			const match = source.slice(pos).match(rule.pattern);
			if (match) {
				let token = rule.token;
				const text = match[0];

				if (token === "identifier" && UNDO_KEYWORDS.has(text.toLowerCase())) {
					token = "keyword";
				}

				spans.push({ text, token });
				pos += text.length;
				matched = true;
				break;
			}
		}

		if (!matched) {
			spans.push({ text: source[pos]!, token: "plain" });
			pos++;
		}
	}

	return spans;
}
