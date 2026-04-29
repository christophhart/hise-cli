// ── /project mode tokenizer ─────────────────────────────────────────

import type { TokenSpan, TokenType } from "./tokens.js";
import { tokenizeSlash } from "./slash.js";

const PROJECT_KEYWORDS = new Set([
	"info", "show", "describe", "switch", "save", "load", "get", "set", "clear",
	"snippet", "create", "help",
	"projects", "settings", "files", "preprocessors", "tree",
	"export", "import",
	"as", "on", "for",
	"xml", "hip",
	"preprocessor",
	"all", "any",
	"windows", "macos", "mac", "osx", "macosx", "linux", "darwin", "win", "x64",
	"project", "plugin", "dll",
	"true", "false", "yes", "no", "on", "off",
	"default",
]);

const ARG_RULES: Array<{ pattern: RegExp; token: TokenType }> = [
	{ pattern: /^"(?:[^"\\]|\\.)*"/, token: "string" },
	{ pattern: /^'(?:[^'\\]|\\.)*'/, token: "string" },
	{ pattern: /^\d+\.\d+(?:[eE][+-]?\d+)?/, token: "float" },
	{ pattern: /^-?\d+/, token: "integer" },
	{ pattern: /^\/[A-Za-z0-9_./-]+/, token: "string" },
	{ pattern: /^[a-zA-Z_$][a-zA-Z0-9_$.-]*/, token: "identifier" },
	{ pattern: /^\s+/, token: "plain" },
];

export function tokenizeProject(source: string): TokenSpan[] {
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
				if (token === "identifier" && PROJECT_KEYWORDS.has(text.toLowerCase())) {
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
