// ── Monaco theme: hise-dark ─────────────────────────────────────────

import type * as MonacoNS from "monaco-editor";
import { TOKEN_COLORS, type TokenType } from "../../../engine/highlight/index.js";

const TOKEN_TYPES: TokenType[] = [
	"keyword",
	"identifier",
	"scopedStatement",
	"integer",
	"float",
	"string",
	"comment",
	"operator",
	"bracket",
	"punctuation",
	"plain",
	"command",
	"builder",
	"script",
	"dsp",
	"sampler",
	"inspect",
	"project",
	"export",
	"compile",
	"undo",
	"ui",
	"sequence",
	"hise",
	"analyse",
];

export function defineHiseDarkTheme(monaco: typeof MonacoNS): void {
	const rules: MonacoNS.editor.ITokenThemeRule[] = TOKEN_TYPES.map((t) => ({
		token: t,
		foreground: stripHash(TOKEN_COLORS[t]),
	}));
	monaco.editor.defineTheme("hise-dark", {
		base: "vs-dark",
		inherit: true,
		rules,
		colors: {
			// Editor body matches --bg-elevated (#32342d) so it blends
			// seamlessly with the parent .input-row / .editor-pane.
			"editor.background": "#32342d",
			"editor.foreground": "#a0a09a",
			"editorLineNumber.foreground": "#5a5b54",
			"editorLineNumber.activeForeground": "#a0a09a",
			"editor.selectionBackground": "#49483e",
			"editorCursor.foreground": "#90FFB1",
			// Translucent so it composes with the gutter (#272822) and
			// editor body (#32342d) — gutter portion ends up subtler.
			"editor.lineHighlightBackground": "#FFFFFF0D",
			"editor.lineHighlightBorder": "#00000000",
			"editorGutter.background": "#272822",
		},
	});
	// Custom themes are only activated globally via setTheme — the
	// `theme:` option on editor.create() ignores non-built-in names.
	monaco.editor.setTheme("hise-dark");
}

function stripHash(hex: string): string {
	return hex.startsWith("#") ? hex.slice(1) : hex;
}
