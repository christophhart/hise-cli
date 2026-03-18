// ── HiseScript language definition for highlight.js ─────────────────

// Registers HiseScript as a language in highlight.js so that cli-highlight
// (used by marked-terminal) can syntax-highlight code blocks tagged as
// ```hisescript. Based on the same keyword/API lists as our custom
// tokenizer (hisescript.ts) to ensure consistent colors.

// highlight.js language definition function — pure data, no node: imports.

// HiseScript keywords (var, reg, const, local, function, inline, etc.)
const KEYWORDS = [
	"var", "reg", "const", "local", "function", "inline",
	"if", "else", "for", "while", "do", "switch", "case", "default",
	"return", "break", "continue", "namespace",
	"new", "delete", "typeof", "instanceof", "this",
];

const LITERALS = ["true", "false", "undefined"];

// HiseScript API classes (Engine, Synth, Console, etc.)
// These map to highlight.js's "built_in" token → TOKEN_COLORS.scopedStatement
const BUILT_INS = [
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
];

/**
 * HiseScript language definition for highlight.js.
 * Call hljs.registerLanguage('hisescript', hisescriptLanguage) to register.
 */
export function hisescriptLanguage(hljs: any) {
	const IDENT_RE = /[a-zA-Z_$][a-zA-Z0-9_$]*/;

	return {
		name: "HiseScript",
		aliases: ["hise"],
		keywords: {
			keyword: KEYWORDS.join(" "),
			literal: LITERALS.join(" "),
			built_in: BUILT_INS.join(" "),
		},
		contains: [
			// Line comments
			hljs.C_LINE_COMMENT_MODE,
			// Block comments
			hljs.C_BLOCK_COMMENT_MODE,
			// Double-quoted strings
			hljs.QUOTE_STRING_MODE,
			// Single-quoted strings
			hljs.APOS_STRING_MODE,
			// Numbers (hex, float, integer)
			hljs.C_NUMBER_MODE,
			// Function declarations
			{
				className: "function",
				beginKeywords: "function inline",
				end: /[{;]/,
				excludeEnd: true,
				illegal: /\S/,
				contains: [
					hljs.TITLE_MODE,
					{
						className: "params",
						begin: /\(/,
						end: /\)/,
						contains: [
							hljs.C_LINE_COMMENT_MODE,
							hljs.C_BLOCK_COMMENT_MODE,
						],
					},
				],
			},
			// Namespace declarations
			{
				className: "class",
				beginKeywords: "namespace",
				end: /\{/,
				excludeEnd: true,
				contains: [hljs.TITLE_MODE],
			},
			// Method calls on API objects: Engine.getSampleRate()
			{
				className: "function",
				begin: /\.\s*/,
				end: /\s*(?=\()/,
				excludeBegin: true,
				excludeEnd: true,
				contains: [
					{ begin: IDENT_RE, className: "title.function" },
				],
			},
		],
	};
}
