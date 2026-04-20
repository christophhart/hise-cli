// ── Sequence mode tokenizer ────────────────────────────────────────

import type { TokenSpan, TokenType } from "./tokens.js";
import { tokenizeSlash } from "./slash.js";

const COMMAND_KEYWORDS = new Set([
	"create", "flush", "show", "play", "record", "stop", "get", "help",
]);

const EVENT_VERBS = new Set([
	"play", "send", "set", "eval",
]);

const SIGNAL_NAMES = new Set([
	"sine", "saw", "sweep", "dirac", "noise", "silence",
]);

const CONNECTORS = new Set([
	"for", "at", "as", "from", "to",
]);

const MIDI_KEYWORDS = new Set([
	"cc", "pitchbend",
]);

const TIMESTAMP_RE = /^\d+(?:\.\d+)?(?:ms|s)\b/i;
const FREQUENCY_RE = /^\d+(?:\.\d+)?k?Hz\b/i;
const NOTE_NAME_RE = /^[A-Ga-g][#b]?\d\b/;
const QUOTED_RE = /^"(?:[^"\\]|\\.)*"|^'(?:[^'\\]|\\.)*'/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?/;
const WORD_RE = /^[a-zA-Z_$.][a-zA-Z0-9_$.]*/;
const WHITESPACE_RE = /^\s+/;

export function tokenizeSequence(source: string): TokenSpan[] {
	if (source.startsWith("/")) {
		return tokenizeSlash(source);
	}

	const spans: TokenSpan[] = [];
	let pos = 0;
	let isFirstWord = true;
	let hasTimestamp = false;

	while (pos < source.length) {
		const rest = source.slice(pos);

		// Whitespace
		const wsMatch = rest.match(WHITESPACE_RE);
		if (wsMatch) {
			spans.push({ text: wsMatch[0], token: "plain" });
			pos += wsMatch[0].length;
			continue;
		}

		// Timestamp / duration values (e.g. 500ms, 1.2s)
		const tsMatch = rest.match(TIMESTAMP_RE);
		if (tsMatch) {
			spans.push({ text: tsMatch[0], token: "float" });
			pos += tsMatch[0].length;
			if (isFirstWord) hasTimestamp = true;
			isFirstWord = false;
			continue;
		}

		// Quoted strings
		const qMatch = rest.match(QUOTED_RE);
		if (qMatch) {
			spans.push({ text: qMatch[0], token: "string" });
			pos += qMatch[0].length;
			isFirstWord = false;
			continue;
		}

		// Frequency values (before generic numbers)
		const fMatch = rest.match(FREQUENCY_RE);
		if (fMatch) {
			spans.push({ text: fMatch[0], token: "float" });
			pos += fMatch[0].length;
			isFirstWord = false;
			continue;
		}

		// Note names (before generic words)
		const nMatch = rest.match(NOTE_NAME_RE);
		if (nMatch && hasTimestamp) {
			spans.push({ text: nMatch[0], token: "identifier" });
			pos += nMatch[0].length;
			isFirstWord = false;
			continue;
		}

		// Numbers
		const numMatch = rest.match(NUMBER_RE);
		if (numMatch && !rest.match(/^-?\d+[a-zA-Z]/)) {
			spans.push({ text: numMatch[0], token: "integer" });
			pos += numMatch[0].length;
			isFirstWord = false;
			continue;
		}

		// Words
		const wMatch = rest.match(WORD_RE);
		if (wMatch) {
			const word = wMatch[0];
			const lower = word.toLowerCase();
			let token: TokenType = "plain";

			if (!hasTimestamp && COMMAND_KEYWORDS.has(lower)) {
				token = "keyword";
			} else if (hasTimestamp && EVENT_VERBS.has(lower)) {
				token = "keyword";
			} else if (SIGNAL_NAMES.has(lower)) {
				token = "keyword";
			} else if (CONNECTORS.has(lower)) {
				token = "comment"; // dim connectors
			} else if (MIDI_KEYWORDS.has(lower)) {
				token = "keyword";
			} else {
				token = "identifier";
			}

			spans.push({ text: word, token });
			pos += word.length;
			isFirstWord = false;
			continue;
		}

		// Fallback
		spans.push({ text: source[pos]!, token: "plain" });
		pos++;
		isFirstWord = false;
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
