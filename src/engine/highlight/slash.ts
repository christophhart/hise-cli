// ── Slash command tokenizer ──────────────────────────────────────────

// Tokenizes input that starts with "/". The command name is classified
// as a mode token type (if it matches a mode ID) or "command" (generic).
// Arguments after the command are tokenized as identifiers/strings/numbers.

import type { TokenSpan, TokenType } from "./tokens.js";

// Mode IDs that get their own token type (= accent color)
const MODE_IDS = new Set<TokenType>([
	"builder", "script", "dsp", "sampler",
	"inspect", "project", "compile", "undo", "ui",
]);

// Argument token rules (applied after the slash command)
const ARG_RULES: Array<{ pattern: RegExp; token: TokenType }> = [
	{ pattern: /^"(?:[^"\\]|\\.)*"/, token: "string" },
	{ pattern: /^'(?:[^'\\]|\\.)*'/, token: "string" },
	{ pattern: /^\d+\.\d+(?:[eE][+-]?\d+)?/, token: "float" },
	{ pattern: /^0x[0-9a-fA-F]+/, token: "integer" },
	{ pattern: /^\d+/, token: "integer" },
	{ pattern: /^[a-zA-Z_$][a-zA-Z0-9_$.:]*/, token: "identifier" },
	{ pattern: /^\s+/, token: "plain" },
];

/**
 * Tokenize a slash command input string.
 * "/builder add SineGenerator" → ["/builder"=builder, " "=plain, "add"=identifier, ...]
 */
export function tokenizeSlash(source: string): TokenSpan[] {
	if (!source.startsWith("/")) {
		// Not a slash command — return as plain
		return [{ text: source, token: "plain" }];
	}

	const spans: TokenSpan[] = [];

	// Extract the command name: /name
	const cmdMatch = source.match(/^\/([a-zA-Z_][a-zA-Z0-9_]*)/);
	if (!cmdMatch) {
		// Just a "/" with no command name
		return [{ text: source, token: "plain" }];
	}

	const cmdName = cmdMatch[1];
	const cmdText = cmdMatch[0]; // includes the "/"

	// Classify the command
	const cmdToken: TokenType = MODE_IDS.has(cmdName as TokenType)
		? (cmdName as TokenType)
		: "command";

	spans.push({ text: cmdText, token: cmdToken, bold: true });

	// Tokenize the rest as arguments
	let pos = cmdText.length;

	while (pos < source.length) {
		let matched = false;

		for (const rule of ARG_RULES) {
			const match = source.slice(pos).match(rule.pattern);
			if (match) {
				spans.push({ text: match[0], token: rule.token });
				pos += match[0].length;
				matched = true;
				break;
			}
		}

		if (!matched) {
			// Consume one character as plain text
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
		if (prev.token === curr.token && prev.bold === curr.bold) {
			prev.text += curr.text;
		} else {
			merged.push({ ...curr });
		}
	}
	return merged;
}
