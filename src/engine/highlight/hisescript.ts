// ── HiseScript tokenizer — stub (keyword/string/number level) ───────

// This is a lightweight regex-based tokenizer for syntax highlighting.
// A full Lezer grammar will replace this when complete syntax analysis
// is needed (multi-line parsing, bracket matching, etc.)

import type { TokenSpan, TokenType } from "./tokens.js";

const HISESCRIPT_KEYWORDS = new Set([
	"var", "reg", "const", "local", "function", "inline",
	"if", "else", "for", "while", "do", "switch", "case", "default",
	"return", "break", "continue", "namespace", "true", "false",
	"new", "delete", "typeof", "instanceof", "this",
]);

const SCOPED_STATEMENTS = new Set([
	"Engine", "Synth", "Console", "Math", "Content", "Message",
	"Server", "Settings", "FileSystem", "Sampler", "Selection",
	"Transport", "MidiList", "Buffer", "UserPresetHandler",
	"MidiAutomationHandler", "Broadcaster", "Path", "Graphics",
	"ScriptPanel", "Timer", "ExpansionHandler", "Colours",
	"AudioFile", "AudioSampleProcessor", "ChildSynth", "Date",
	"Download", "ErrorHandler", "File", "FixObjectFactory",
	"GlobalCable", "GlobalRoutingManager", "MacroHandler",
	"MarkdownRenderer", "MessageHolder", "MidiPlayer",
	"ModulatorGroup", "Rectangle", "ScriptedViewport",
	"ScriptModulationMatrix", "String", "TableProcessor",
	"TransportHandler", "Waveform",
]);

interface TokenRule {
	pattern: RegExp;
	token: TokenType;
}

const RULES: TokenRule[] = [
	// Comments
	{ pattern: /^\/\/.*/, token: "comment" },
	{ pattern: /^\/\*[\s\S]*?\*\//, token: "comment" },

	// Strings
	{ pattern: /^"(?:[^"\\]|\\.)*"/, token: "string" },
	{ pattern: /^'(?:[^'\\]|\\.)*'/, token: "string" },

	// Float (must be before integer)
	{ pattern: /^\d+\.\d+(?:[eE][+-]?\d+)?/, token: "float" },

	// Integer (hex and decimal)
	{ pattern: /^0x[0-9a-fA-F]+/, token: "integer" },
	{ pattern: /^\d+/, token: "integer" },

	// Operators
	{ pattern: /^(?:===|!==|==|!=|<=|>=|&&|\|\||<<|>>|>>>|\+\+|--|[+\-*/%&|^~!<>=?:])/, token: "operator" },

	// Brackets
	{ pattern: /^[()[\]{}]/, token: "bracket" },

	// Punctuation
	{ pattern: /^[.,;]/, token: "punctuation" },

	// Identifiers and keywords
	{ pattern: /^[a-zA-Z_$][a-zA-Z0-9_$]*/, token: "identifier" },

	// Whitespace (kept as plain to preserve formatting)
	{ pattern: /^\s+/, token: "plain" },
];

export function tokenize(source: string): TokenSpan[] {
	const spans: TokenSpan[] = [];
	let pos = 0;

	while (pos < source.length) {
		let matched = false;

		for (const rule of RULES) {
			rule.pattern.lastIndex = 0;
			const match = source.slice(pos).match(rule.pattern);
			if (match) {
				let token = rule.token;
				const text = match[0];

				// Classify identifiers
				if (token === "identifier") {
					if (HISESCRIPT_KEYWORDS.has(text)) {
						token = "keyword";
					} else if (SCOPED_STATEMENTS.has(text)) {
						token = "scopedStatement";
					}
				}

				spans.push({ text, token });
				pos += text.length;
				matched = true;
				break;
			}
		}

		if (!matched) {
			// Consume one character as plain text
			spans.push({ text: source[pos], token: "plain" });
			pos++;
		}
	}

	return mergeAdjacentSpans(spans);
}

// Merge consecutive spans of the same token type
function mergeAdjacentSpans(spans: TokenSpan[]): TokenSpan[] {
	if (spans.length === 0) return [];

	const merged: TokenSpan[] = [spans[0]];
	for (let i = 1; i < spans.length; i++) {
		const prev = merged[merged.length - 1];
		if (prev.token === spans[i].token) {
			prev.text += spans[i].text;
		} else {
			merged.push(spans[i]);
		}
	}
	return merged;
}
