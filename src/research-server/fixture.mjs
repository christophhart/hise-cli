import { readFile } from "node:fs/promises";

const TOOL_NAMES = ["explore_hise", "search_hise", "query_scriptnode", "get_doc_content", "search_examples", "get_example"];

export class FixtureDocumentationHost {
	constructor(documents) {
		this.documents = documents;
	}

	static async fromFile(path) {
		return new FixtureDocumentationHost(JSON.parse(await readFile(path, "utf8")));
	}

	async checkReady() {
		return { status: "ready", tools: TOOL_NAMES.map((name) => ({ name })) };
	}

	async callTool(name, args = {}) {
		if (!TOOL_NAMES.includes(name)) throw new Error(`Unsupported documentation operation: ${name}`);
		const query = String(args.query ?? "").toLowerCase();
		if (["explore_hise", "search_hise", "search_examples", "query_scriptnode"].includes(name)) {
			const kind = name === "search_examples" ? "example" : undefined;
			const terms = query.split(/[^a-z0-9_.]+/).filter((term) => term.length > 1);
			const ranked = this.documents
				.filter((doc) => !kind || doc.kind === kind)
				.map((doc) => ({ doc, score: terms.reduce((score, term) => score + `${doc.title} ${doc.body} ${(doc.tags ?? []).join(" ")}`.toLowerCase().split(term).length - 1, 0) }))
				.filter((item) => item.score > 0 || terms.length === 0)
				.sort((a, b) => b.score - a.score)
				.slice(0, Math.min(Number(args.limit ?? 20), 20));
			if (name === "explore_hise") return { content: [{ type: "text", text: ranked.map(({ doc }) => `${doc.title}\n${doc.url}\n${summary(doc.body)}`).join("\n\n") }] };
			return { results: ranked.map(({ doc, score }) => ({ id: doc.id, name: doc.title, description: summary(doc.body), url: doc.url, score })) };
		}
		const id = String(args.id ?? args.query ?? "").replace(/^id:/, "");
		const url = typeof args.url === "string" ? args.url : undefined;
		const doc = this.documents.find((item) => item.id === id || item.url === url);
		if (!doc) return { ok: false, isError: true, error: `Fixture document not found: ${id || url}` };
		return { id: doc.id, title: doc.title, url: doc.url, content: [{ type: "text", text: doc.body }] };
	}
}

function summary(text) {
	const compact = String(text).replace(/\s+/g, " ").trim();
	return compact.length <= 240 ? compact : `${compact.slice(0, 237)}...`;
}
