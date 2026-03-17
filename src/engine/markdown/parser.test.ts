// ── Markdown Parser Tests ──────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { parseMarkdown } from "./parser.js";
import type { MarkdownAST, HeadingNode, ParagraphNode, BlockquoteNode, TableNode, ListNode, CodeBlockNode } from "./ast.js";

// ── Headings ────────────────────────────────────────────────────────

describe("parseMarkdown - headings", () => {
	it("parses H1 heading", () => {
		const ast = parseMarkdown("# Title");
		expect(ast.nodes).toHaveLength(1);
		const heading = ast.nodes[0] as HeadingNode;
		expect(heading.type).toBe("heading");
		expect(heading.level).toBe(1);
		expect(heading.content).toEqual([{ type: "text", content: "Title" }]);
	});

	it("parses H2 and H3 headings", () => {
		const ast = parseMarkdown("## Section\n\n### Subsection");
		expect(ast.nodes).toHaveLength(2);
		const h2 = ast.nodes[0] as HeadingNode;
		const h3 = ast.nodes[1] as HeadingNode;
		expect(h2.level).toBe(2);
		expect(h3.level).toBe(3);
	});

	it("parses heading with inline formatting", () => {
		const ast = parseMarkdown("# **Bold** Title");
		const heading = ast.nodes[0] as HeadingNode;
		expect(heading.content).toHaveLength(2);
		expect(heading.content[0]).toEqual({
			type: "bold",
			content: [{ type: "text", content: "Bold" }],
		});
		expect(heading.content[1]).toEqual({
			type: "text",
			content: " Title",
		});
	});
});

// ── Paragraphs ──────────────────────────────────────────────────────

describe("parseMarkdown - paragraphs", () => {
	it("parses simple paragraph", () => {
		const ast = parseMarkdown("This is a paragraph.");
		expect(ast.nodes).toHaveLength(1);
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.type).toBe("paragraph");
		expect(para.content).toEqual([{ type: "text", content: "This is a paragraph." }]);
	});

	it("parses multiple paragraphs", () => {
		const ast = parseMarkdown("First paragraph.\n\nSecond paragraph.");
		expect(ast.nodes).toHaveLength(2);
		expect(ast.nodes[0].type).toBe("paragraph");
		expect(ast.nodes[1].type).toBe("paragraph");
	});
});

// ── Blockquotes ─────────────────────────────────────────────────────

describe("parseMarkdown - blockquotes", () => {
	it("parses single-line blockquote", () => {
		const ast = parseMarkdown("> This is a quote");
		expect(ast.nodes).toHaveLength(1);
		const quote = ast.nodes[0] as BlockquoteNode;
		expect(quote.type).toBe("blockquote");
		expect(quote.content).toHaveLength(1);
		expect(quote.content[0].type).toBe("paragraph");
	});

	it("parses multi-line blockquote", () => {
		const ast = parseMarkdown("> Line 1\n> Line 2");
		const quote = ast.nodes[0] as BlockquoteNode;
		expect(quote.content).toHaveLength(1);
		const para = quote.content[0] as ParagraphNode;
		// marked treats multi-line blockquotes as a single paragraph with line breaks
		expect(para.type).toBe("paragraph");
	});

	it("parses blockquote with nested content", () => {
		const ast = parseMarkdown("> # Heading\n> \n> Paragraph");
		const quote = ast.nodes[0] as BlockquoteNode;
		expect(quote.content.length).toBeGreaterThan(0);
		expect(quote.content[0].type).toBe("heading");
	});
});

// ── Code blocks ─────────────────────────────────────────────────────

describe("parseMarkdown - code blocks", () => {
	it("parses fenced code block without language", () => {
		const ast = parseMarkdown("```\nconst x = 1;\n```");
		expect(ast.nodes).toHaveLength(1);
		const code = ast.nodes[0] as CodeBlockNode;
		expect(code.type).toBe("code");
		expect(code.language).toBeUndefined();
		expect(code.content).toBe("const x = 1;");
	});

	it("parses fenced code block with language", () => {
		const ast = parseMarkdown("```javascript\nconst x = 1;\n```");
		const code = ast.nodes[0] as CodeBlockNode;
		expect(code.language).toBe("javascript");
		expect(code.content).toBe("const x = 1;");
	});

	it("parses code block with hisescript language", () => {
		const ast = parseMarkdown("```hisescript\nEngine.getSampleRate()\n```");
		const code = ast.nodes[0] as CodeBlockNode;
		expect(code.language).toBe("hisescript");
		expect(code.content).toBe("Engine.getSampleRate()");
	});

	it("handles empty code block", () => {
		const ast = parseMarkdown("```\n```");
		const code = ast.nodes[0] as CodeBlockNode;
		expect(code.content).toBe("");
	});
});

// ── Tables ──────────────────────────────────────────────────────────

describe("parseMarkdown - tables", () => {
	it("parses simple table", () => {
		const ast = parseMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
		expect(ast.nodes).toHaveLength(1);
		const table = ast.nodes[0] as TableNode;
		expect(table.type).toBe("table");
		expect(table.headers).toEqual(["A", "B"]);
		expect(table.rows).toEqual([["1", "2"]]);
	});

	it("parses table with multiple rows", () => {
		const ast = parseMarkdown("| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |");
		const table = ast.nodes[0] as TableNode;
		expect(table.rows).toHaveLength(2);
		expect(table.rows[0]).toEqual(["Alice", "30"]);
		expect(table.rows[1]).toEqual(["Bob", "25"]);
	});

	it("parses table with formatted cells", () => {
		const ast = parseMarkdown("| Command | Description |\n|---------|-------------|\n| **bold** | `code` |");
		const table = ast.nodes[0] as TableNode;
		// Table cells are converted to plain text
		expect(table.rows[0][0]).toBe("bold");
		expect(table.rows[0][1]).toBe("code");
	});
});

// ── Lists ───────────────────────────────────────────────────────────

describe("parseMarkdown - lists", () => {
	it("parses unordered list", () => {
		const ast = parseMarkdown("- Item 1\n- Item 2");
		expect(ast.nodes).toHaveLength(1);
		const list = ast.nodes[0] as ListNode;
		expect(list.type).toBe("list");
		expect(list.ordered).toBe(false);
		expect(list.items).toHaveLength(2);
	});

	it("parses ordered list", () => {
		const ast = parseMarkdown("1. First\n2. Second");
		const list = ast.nodes[0] as ListNode;
		expect(list.ordered).toBe(true);
		expect(list.items).toHaveLength(2);
	});

	it("parses nested list", () => {
		const ast = parseMarkdown("- Outer\n  - Inner");
		const list = ast.nodes[0] as ListNode;
		// marked treats this as a single item with nested list inside
		expect(list.items).toHaveLength(1);
		// The first item should contain a nested list
		expect(list.items[0].some(node => node.type === "list")).toBe(true);
	});
});

// ── Inline formatting ───────────────────────────────────────────────

describe("parseMarkdown - inline formatting", () => {
	it("parses bold text", () => {
		const ast = parseMarkdown("This is **bold** text");
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.content).toHaveLength(3);
		expect(para.content[1]).toEqual({
			type: "bold",
			content: [{ type: "text", content: "bold" }],
		});
	});

	it("parses italic text", () => {
		const ast = parseMarkdown("This is *italic* text");
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.content[1]).toEqual({
			type: "italic",
			content: [{ type: "text", content: "italic" }],
		});
	});

	it("parses inline code", () => {
		const ast = parseMarkdown("Use `code` here");
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.content[1]).toEqual({
			type: "code",
			content: "code",
		});
	});

	it("parses links", () => {
		const ast = parseMarkdown("[HISE](https://hise.dev)");
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.content[0]).toEqual({
			type: "link",
			text: "HISE",
			url: "https://hise.dev",
		});
	});

	it("parses nested bold and italic", () => {
		const ast = parseMarkdown("***bold italic***");
		const para = ast.nodes[0] as ParagraphNode;
		// marked parses this as nested strong/em
		expect(para.content[0].type).toMatch(/bold|italic/);
	});
});

// ── Horizontal rules ────────────────────────────────────────────────

describe("parseMarkdown - horizontal rules", () => {
	it("parses horizontal rule", () => {
		const ast = parseMarkdown("---");
		expect(ast.nodes).toHaveLength(1);
		expect(ast.nodes[0]).toEqual({ type: "rule" });
	});

	it("parses rule with surrounding content", () => {
		const ast = parseMarkdown("Before\n\n---\n\nAfter");
		expect(ast.nodes).toHaveLength(3);
		expect(ast.nodes[1].type).toBe("rule");
	});
});

// ── Mixed content (real-world scenarios) ────────────────────────────

describe("parseMarkdown - mixed content", () => {
	it("parses help text structure", () => {
		const markdown = `# SCRIPT MODE

HiseScript REPL — evaluate expressions live.

## Commands

| Command | Description |
|---------|-------------|
| **/help** | Show help |

## Examples

\`\`\`hisescript
Engine.getSampleRate()
\`\`\`

## Navigation

- **Tab**: Complete command`;

		const ast = parseMarkdown(markdown);
		expect(ast.nodes.length).toBeGreaterThan(5);
		expect(ast.nodes[0].type).toBe("heading");
		expect(ast.nodes.some(n => n.type === "table")).toBe(true);
		expect(ast.nodes.some(n => n.type === "code")).toBe(true);
		expect(ast.nodes.some(n => n.type === "list")).toBe(true);
	});

	it("parses REPL blockquote output", () => {
		const markdown = "> Console output\n> Line 2\n\nReturn value";
		const ast = parseMarkdown(markdown);
		expect(ast.nodes).toHaveLength(2);
		expect(ast.nodes[0].type).toBe("blockquote");
		expect(ast.nodes[1].type).toBe("paragraph");
	});

	it("parses inspect mode output", () => {
		const markdown = `## CPU & Audio Buffer

| Metric | Value |
|--------|-------|
| CPU Usage | 12.4% |
| Sample Rate | 48000 Hz |`;

		const ast = parseMarkdown(markdown);
		expect(ast.nodes[0].type).toBe("heading");
		expect((ast.nodes[0] as HeadingNode).level).toBe(2);
		expect(ast.nodes[1].type).toBe("table");
	});
});

// ── Edge cases ──────────────────────────────────────────────────────

describe("parseMarkdown - edge cases", () => {
	it("handles empty string", () => {
		const ast = parseMarkdown("");
		expect(ast.nodes).toHaveLength(0);
	});

	it("handles whitespace-only string", () => {
		const ast = parseMarkdown("   \n\n   ");
		expect(ast.nodes).toHaveLength(0);
	});

	it("handles malformed table gracefully", () => {
		// Missing separator row
		const ast = parseMarkdown("| A | B |\n| 1 | 2 |");
		// marked should still parse this
		expect(ast.nodes.length).toBeGreaterThan(0);
	});

	it("handles deeply nested formatting", () => {
		const ast = parseMarkdown("**bold *italic `code`***");
		const para = ast.nodes[0] as ParagraphNode;
		expect(para.content.length).toBeGreaterThan(0);
	});
});
