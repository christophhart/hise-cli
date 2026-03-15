// ── Minimal XML regex tokenizer (~30 lines) ─────────────────────────

import type { TokenSpan } from "./tokens.js";

// Simple tokenizer for XML/HTML content appearing in code blocks.
// Not a full parser — just enough for syntax highlighting.

const XML_RULES: Array<{ pattern: RegExp; token: "comment" | "string" | "keyword" | "punctuation" | "plain" }> = [
	{ pattern: /^<!--[\s\S]*?-->/, token: "comment" },
	{ pattern: /^"[^"]*"/, token: "string" },
	{ pattern: /^'[^']*'/, token: "string" },
	{ pattern: /^<\/?[a-zA-Z][a-zA-Z0-9_:-]*/, token: "keyword" },
	{ pattern: /^\/?>/, token: "punctuation" },
	{ pattern: /^[a-zA-Z_][a-zA-Z0-9_:-]*(?==)/, token: "scopedStatement" as "keyword" },
	{ pattern: /^[=]/, token: "punctuation" },
	{ pattern: /^[^<"'=/>]+/, token: "plain" },
];

export function tokenizeXml(source: string): TokenSpan[] {
	const spans: TokenSpan[] = [];
	let pos = 0;

	while (pos < source.length) {
		let matched = false;
		for (const rule of XML_RULES) {
			const match = source.slice(pos).match(rule.pattern);
			if (match) {
				spans.push({ text: match[0], token: rule.token });
				pos += match[0].length;
				matched = true;
				break;
			}
		}
		if (!matched) {
			spans.push({ text: source[pos], token: "plain" });
			pos++;
		}
	}

	return spans;
}
