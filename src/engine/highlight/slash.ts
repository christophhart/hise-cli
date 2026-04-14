// ── Slash command tokenizer ──────────────────────────────────────────

// Tokenizes input that starts with "/". The command name is classified
// as a mode token type (if it matches a mode ID) or "command" (generic).
// Arguments after the command are tokenized as identifiers/strings/numbers.

import type { TokenSpan, TokenType } from "./tokens.js";
import { SLASH_MODE_IDS } from "../modes/mode.js";

const MIDI_CALLBACKS = new Set([
	"onNoteOn",
	"onNoteOff",
	"onController",
	"onTimer",
	"onControl",
]);

const MODE_IDS = SLASH_MODE_IDS as Set<string> & Set<TokenType>;

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

	if (cmdName === "callback") {
		return tokenizeCallbackSlash(source, cmdText);
	}

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

function tokenizeCallbackSlash(source: string, cmdText: string): TokenSpan[] {
	const spans: TokenSpan[] = [{ text: cmdText, token: "command", bold: true }];
	let pos = cmdText.length;

	while (pos < source.length) {
		const remainder = source.slice(pos);
		const wsMatch = remainder.match(/^\s+/);
		if (wsMatch) {
			spans.push({ text: wsMatch[0], token: "plain" });
			pos += wsMatch[0].length;
			continue;
		}

		const tokenMatch = remainder.match(/^[A-Za-z_$][A-Za-z0-9_$.:]*/);
		if (tokenMatch) {
			const token = tokenMatch[0];
			const dotIndex = token.lastIndexOf(".");
			const callbackName = dotIndex === -1 ? token : token.slice(dotIndex + 1);
			const isCallback = isKnownMidiCallback(callbackName);

			if (dotIndex !== -1) {
				const processorId = token.slice(0, dotIndex);
				if (processorId) {
					spans.push({ text: processorId, token: "identifier" });
					spans.push({ text: ".", token: "punctuation" });
				}
				spans.push({ text: callbackName, token: isCallback ? "keyword" : "identifier" });
			} else {
				spans.push({ text: token, token: isCallback ? "keyword" : "identifier" });
			}

			pos += token.length;
			continue;
		}

		spans.push({ text: source[pos]!, token: "plain" });
		pos++;
	}

	return mergeAdjacentSpans(spans);
}

function isKnownMidiCallback(name: string): boolean {
	if (MIDI_CALLBACKS.has(name)) {
		return true;
	}

	for (const callbackName of MIDI_CALLBACKS) {
		if (callbackName.toLowerCase().startsWith(name.toLowerCase())) {
			return true;
		}
	}

	return false;
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
