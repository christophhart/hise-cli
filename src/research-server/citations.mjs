export function enforceCitations(markdown, evidence) {
	const byId = new Map(evidence.map((item) => [item.citationId, item]));
	const allowedUrls = new Set(evidence.map((item) => item.url).filter(Boolean));
	const used = new Set();
	let output = String(markdown)
		.replace(/\[(E\d+)]\([^)]+\)/g, "[$1]")
		.replace(/\[(E\d+)]/g, (_match, id) => {
			const item = byId.get(id);
			if (!item) return "";
			used.add(id);
			return item.url ? `[${id}](${item.url})` : `[${id}]`;
		})
		.replace(/\[([^\]]+)]\(([^)]+)\)/g, (match, label, url) => {
			if (byId.has(label) && byId.get(label)?.url === url) return match;
			if (allowedUrls.has(url)) return match;
			return label;
		});
	const citations = [...used].map((id) => {
		const item = byId.get(id);
		return { id, title: item.title, url: item.url, sourceId: item.id, kind: item.kind };
	});
	return { markdown: output.trim(), citations };
}

export function appendValidationNotice(markdown, status, detail) {
	if (status === "disabled") return `${markdown.trim()}\n\n> **Not validated:** HISE validation is disabled. The code example was generated from documentation evidence but may contain syntax or API errors.`;
	if (status === "unavailable") return `${markdown.trim()}\n\n> **Validation unavailable:** ${detail || "The generated code could not be checked by the local HISE instance."}`;
	if (status === "failed") return `${markdown.trim()}\n\n> **Validation failed:** HISE still reports errors in the generated code.`;
	if (status === "passed") return `${markdown.trim()}\n\n> **Validated:** The generated HiseScript passed local HISE diagnosis.`;
	return markdown.trim();
}

export function extractHiseScriptBlocks(markdown) {
	const blocks = [];
	for (const match of String(markdown).matchAll(/```(?:hisescript|javascript|js)\s*\n([\s\S]*?)```/gi)) {
		const source = match[1]?.trim();
		if (source) blocks.push(source);
	}
	return blocks;
}
