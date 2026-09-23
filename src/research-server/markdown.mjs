import { marked, Renderer } from "marked";
import hljs from "highlight.js";
import { tokenize as tokenizeHiseScript } from "../engine/highlight/hisescript.js";

const renderer = new Renderer();

// Research output is Markdown-only. Discard raw HTML rather than trusting model output.
renderer.html = () => "";
renderer.image = ({ text }) => escapeHtml(text || "image");
renderer.link = function ({ href, title, tokens }) {
	const label = this.parser.parseInline(tokens);
	const safeHref = safeLink(href, renderer.siteUrl);
	if (!safeHref) return label;
	const external = /^https?:\/\//i.test(safeHref);
	const titleAttribute = title ? ` title="${escapeAttribute(title)}"` : "";
	const externalAttributes = external ? ' target="_blank" rel="noopener noreferrer"' : "";
	return `<a href="${escapeAttribute(safeHref)}"${titleAttribute}${externalAttributes}>${label}</a>`;
};
renderer.code = ({ text, lang }) => {
	const requested = String(lang ?? "").trim().split(/\s+/)[0].toLowerCase();
	const isHiseScript = ["hisescript", "hise", "javascript", "js"].includes(requested);
	let code;
	if (isHiseScript) {
		code = tokenizeHiseScript(text).map((span) => `<span class="token-${escapeAttribute(span.token)}">${escapeHtml(span.text)}</span>`).join("");
	} else if (requested && hljs.getLanguage(requested)) {
		code = hljs.highlight(text, { language: requested, ignoreIllegals: true }).value;
	} else {
		code = escapeHtml(text);
	}
	const className = requested ? ` class="language-${escapeAttribute(requested)}"` : "";
	return `<pre><code${className}>${code}</code></pre>\n`;
};

export function renderMarkdown(markdown, { siteUrl = "http://localhost:4401" } = {}) {
	renderer.siteUrl = siteUrl;
	return marked.parse(String(markdown), {
		renderer,
		async: false,
		gfm: true,
		breaks: false,
	});
}

function safeLink(value, siteUrl) {
	const href = String(value ?? "").trim();
	if (href.startsWith("/") && !href.startsWith("//")) {
		try { return new URL(href, siteUrl).href; } catch { return null; }
	}
	if (href.startsWith("#")) return href;
	try {
		const url = new URL(href);
		return ["http:", "https:"].includes(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

function escapeHtml(value) {
	return String(value).replace(/[&<>"']/g, (character) => ({
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	})[character]);
}

function escapeAttribute(value) {
	return escapeHtml(value).replace(/`/g, "&#96;");
}
