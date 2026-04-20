// ── Inspect mode tokenizer ──────────────────────────────────────────

// Simple tokenizer: inspect commands as keywords, rest as identifiers.

import type { TokenSpan, TokenType } from "./tokens.js";
import { tokenizeSlash } from "./slash.js";

const INSPECT_KEYWORDS = new Set([
	"version", "project", "help",
]);

const ARG_RULES: Array<{ pattern: RegExp; token: TokenType }> = [
	{ pattern: /^"(?:[^"\\]|\\.)*"/, token: "string" },
	{ pattern: /^'(?:[^'\\]|\\.)*'/, token: "string" },
	{ pattern: /^\d+\.\d+(?:[eE][+-]?\d+)?/, token: "float" },
	{ pattern: /^\d+/, token: "integer" },
	{ pattern: /^[a-zA-Z_$][a-zA-Z0-9_$]*/, token: "identifier" },
	{ pattern: /^\s+/, token: "plain" },
];

/**
 * Tokenize inspect mode input.
 * "version" → [version=keyword]
 * "project" → [project=keyword]
 *
 * Delegates to tokenizeSlash for "/" prefixed input.
 */
export function tokenizeInspect(source: string): TokenSpan[] {
	if (source.startsWith("/")) {
		return tokenizeSlash(source);
	}

	const spans: TokenSpan[] = [];
	let pos = 0;

	while (pos < source.length) {
		let matched = false;

		for (const rule of ARG_RULES) {
			const match = source.slice(pos).match(rule.pattern);
			if (match) {
				let token = rule.token;
				const text = match[0];

				if (token === "identifier" && INSPECT_KEYWORDS.has(text.toLowerCase())) {
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

	return mergeAdjacentSpans(spans);
}

// Merge consecutive spans of the same token type
function mergeAdjacentSpans(spans: TokenSpan[]): TokenSpan[] {
	if (spans.length === 0) return [];

	const merged: TokenSpan[] = [{ ...spans[0] }];
	for (let i = 1; i < spans.length; i++) {
		const prev = merged[merged.length - 1]!;
		const curr = spans[i]!;
		if (prev.token === curr.token) {
			prev.text += curr.text;
		} else {
			merged.push({ ...curr });
		}
	}
	return merged;
}
