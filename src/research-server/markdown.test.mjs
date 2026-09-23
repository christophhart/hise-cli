import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown.mjs";

describe("research Markdown rendering", () => {
	it("renders headings, tables, links, and highlighted code", () => {
		const html = renderMarkdown("## Answer\n\n[E1](/v2/doc)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```hisescript\nconst var x = 1;\n```");
		expect(html).toContain("<h2>Answer</h2>");
		expect(html).toContain('<a href="http://localhost:4401/v2/doc" target="_blank" rel="noopener noreferrer">E1</a>');
		expect(html).toContain("<table>");
		expect(html).toContain('class="language-hisescript"');
		expect(html).toContain('<span class="token-keyword">const</span>');
	});

	it("discards raw HTML and unsafe links", () => {
		const html = renderMarkdown('<script>alert("x")</script>\n\n[run](javascript:alert(1))\n\n![tracker](https://example.com/t.gif)');
		expect(html).not.toContain("<script");
		expect(html).not.toContain("javascript:");
		expect(html).not.toContain("<img");
		expect(html).toContain("run");
		expect(html).toContain("tracker");
	});

	it("resolves documentation paths against a configurable website origin", () => {
		const html = renderMarkdown("[E1](/v2/scripting-api/content)", { siteUrl: "http://0.0.0.0:4401" });
		expect(html).toContain('href="http://0.0.0.0:4401/v2/scripting-api/content"');
	});

	it("protects external links", () => {
		const html = renderMarkdown("[docs](https://example.com/path)");
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});
});
