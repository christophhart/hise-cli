// ── Markdown — themed ink-markdown wrapper ─────────────────────────

// Wraps marked + marked-terminal with hise-cli color scheme customization.
// Builds marked-terminal options from ColorScheme to match TUI theme.

import React from "react";
import type { TerminalRendererOptions } from "marked-terminal";
import chalk from "chalk";
import { highlight as highlightCli } from "cli-highlight";
import type { ColorScheme } from "../theme.js";
import { darkenHex, lerpHex } from "../theme.js";
import { TOKEN_COLORS } from "../../engine/highlight/tokens.js";
import { hisescriptLanguage } from "../../engine/highlight/hisescript-hljs.js";

import { Marked } from "marked";
import { Text } from "ink";
import { markedTerminal } from "marked-terminal";

// Register HiseScript with highlight.js (via cli-highlight's shared instance).
// cli-highlight uses require("highlight.js") internally - we import the same
// module (singleton) and register our custom language on it.
import hljs from "highlight.js";
hljs.registerLanguage("hisescript", hisescriptLanguage);

interface MarkdownProps {
	children: string;
	scheme: ColorScheme;
	accent?: string;
	/** Content width for reflowing (defaults to 80) */
	width?: number;
	/** Context affects background color for code blocks */
	context?: "overlay" | "output";
}

// ── cli-highlight theme mapped from our TOKEN_COLORS ────────────────

const highlightTheme = {
	keyword: chalk.hex(TOKEN_COLORS.keyword),
	built_in: chalk.hex(TOKEN_COLORS.scopedStatement),
	type: chalk.hex(TOKEN_COLORS.scopedStatement),
	literal: chalk.hex(TOKEN_COLORS.keyword),
	number: chalk.hex(TOKEN_COLORS.integer),
	regexp: chalk.hex(TOKEN_COLORS.string),
	string: chalk.hex(TOKEN_COLORS.string),
	symbol: chalk.hex(TOKEN_COLORS.identifier),
	class: chalk.hex(TOKEN_COLORS.scopedStatement),
	function: chalk.hex(TOKEN_COLORS.identifier),
	title: chalk.hex(TOKEN_COLORS.identifier),
	params: chalk.hex(TOKEN_COLORS.plain),
	comment: chalk.hex(TOKEN_COLORS.comment),
	doctag: chalk.hex(TOKEN_COLORS.comment),
	meta: chalk.hex(TOKEN_COLORS.comment),
	tag: chalk.hex(TOKEN_COLORS.keyword),
	name: chalk.hex(TOKEN_COLORS.keyword),
	attr: chalk.hex(TOKEN_COLORS.scopedStatement),
	attribute: chalk.hex(TOKEN_COLORS.scopedStatement),
	variable: chalk.hex(TOKEN_COLORS.identifier),
	default: chalk.hex(TOKEN_COLORS.plain),
};

// ── Build marked-terminal options from ColorScheme ──────────────────

function buildOptions(
	scheme: ColorScheme,
	accent?: string,
	width?: number,
): TerminalRendererOptions {
	// Inline code color (40% blend with accent)
	const inlineCodeColor = accent
		? lerpHex(scheme.foreground.default, accent, 0.4)
		: scheme.foreground.bright;
	
	// Accent for headings
	const headingColor = accent || scheme.foreground.bright;
	
	return {
		// Colors
		code: chalk.hex(scheme.foreground.bright),
		blockquote: chalk.hex(scheme.foreground.muted).italic,
		html: chalk.hex(scheme.foreground.muted),
		heading: chalk.hex(headingColor).bold,
		firstHeading: chalk.hex(headingColor).bold,
		hr: chalk.hex(scheme.foreground.muted),
		listitem: chalk.hex(scheme.foreground.default),
		table: chalk.hex(scheme.foreground.default),
		paragraph: chalk.hex(scheme.foreground.default),
		strong: chalk.hex(scheme.foreground.default).bold,
		em: chalk.hex(scheme.foreground.default).italic,
		codespan: chalk.hex(inlineCodeColor),
		del: chalk.hex(scheme.foreground.muted).strikethrough,
		link: chalk.hex(scheme.foreground.default),
		href: chalk.hex(accent || scheme.foreground.bright).underline,
		
		// Behavior
		showSectionPrefix: false,
		reflowText: true,
		width: width || 80,
		unescape: true,
		emoji: true,
		tab: 2,
		
		// Table options — bright header, dim borders
		tableOptions: {
			style: { head: ['white', 'bold'], border: ['dim'] },
		},
	};
}

export function Markdown({ children, scheme, accent, width, context }: MarkdownProps) {
	const rendered = React.useMemo(() => {
		const options = buildOptions(scheme, accent, width);
		
		// Code block background color (15% darker than base)
		const baseBg = context === "overlay" 
			? scheme.backgrounds.overlay 
			: scheme.backgrounds.standard;
		const codeBg = darkenHex(baseBg, 0.85);
		const codeBgChalk = chalk.bgHex(codeBg);
		const codeIndent = "  "; // indent for code text within the bg rectangle
		
		const processed = children;
		
		// Create a fresh marked instance to avoid polluting global state
		const localMarked = new Marked();
		
		// Configure with terminal renderer extension
		localMarked.use(markedTerminal(options, { theme: highlightTheme } as any) as any);
		
		// Override the code renderer to add background color
		// Background rectangle spans the full content width (edge to edge)
		const codeBlockWidth = width || 80;
		
		localMarked.use({
			renderer: {
				code({ text, lang }: { text: string; lang?: string }) {
					// Syntax highlight the code
					let highlighted: string;
					try {
						highlighted = highlightCli(text, {
							language: lang || '',
							theme: highlightTheme,
						});
					} catch {
						// Fallback: just use bright foreground
						highlighted = chalk.hex(scheme.foreground.bright)(text);
					}
					
					// Pad each line to full width so background fills a rectangle
					// Code text is indented within the bg rectangle
					const lines = highlighted.split('\n');
					const withBg = lines.map(line => {
						// Strip ANSI codes to measure visible length
						const visible = line.replace(/\x1b\[[0-9;]*m/g, '');
						const padding = Math.max(0, codeBlockWidth - codeIndent.length - visible.length);
						return codeBgChalk(codeIndent + line + ' '.repeat(padding));
					}).join('\n');
					
					// Blank padding lines with background (full-width rectangle)
					const padLine = codeBgChalk(' '.repeat(codeBlockWidth));
					return '\n' + padLine + '\n' + withBg + '\n' + padLine + '\n\n';
				}
			}
		});
		
		// Parse markdown to ANSI-styled string
		let result = localMarked.parse(processed, { async: false }) as string;
		
		// Workaround for marked-terminal bug #371: bold/italic not applied in list items.
		// Post-process any remaining **text** and *text* markers into ANSI bold/italic.
		result = result.replace(/\*\*(.+?)\*\*/g, (_, text) => chalk.bold(text));
		result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, (_, text) => chalk.italic(text));
		
		return result;
	}, [children, scheme, accent, width, context]);
	
	return <Text>{rendered.trim()}</Text>;
}
