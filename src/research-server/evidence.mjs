const MAX_QUERIES = 4;
const MAX_DOCUMENTS = 4;
const MAX_EXAMPLES = 2;
const MAX_EXCERPT_CHARS = 5_000;

export function parseQueries(text, original) {
	const value = parseJsonObject(text);
	const queries = Array.isArray(value?.queries) ? value.queries : [];
	return [...new Set([original, ...queries
		.filter((item) => typeof item === "string")
		.map((item) => item.replace(/\s+/g, " ").trim())
		.filter((item) => item && item.length <= 300)])].slice(0, MAX_QUERIES);
}

export function extractCandidates(value, kind = "document") {
	const decoded = decodeEmbeddedJson(value);
	const arrays = collectArrays(decoded);
	const rows = arrays.flatMap((array) => array).filter((item) => item && typeof item === "object" && !Array.isArray(item));
	const seen = new Set();
	return rows.map((item) => {
		const id = stringValue(item.id, item.documentId, item.key, item.url, item.path);
		if (!id || seen.has(id)) return null;
		seen.add(id);
		return {
			key: kind === "document" && !id.startsWith("/") && !id.startsWith("id:") ? `id:${id}` : id,
			id,
			kind,
			title: stringValue(item.name, item.title, item.symbol, id),
			description: stringValue(item.description, item.summary, item.brief, ""),
			url: stringValue(item.url, item.path, "") || undefined,
		};
	}).filter(Boolean);
}

export function extractExploreUrls(value) {
	const text = resultText(value);
	const urls = text.match(/\/v2\/[^"\\\s)>,;]+/g) ?? [];
	return [...new Set(urls)].map((url) => ({ key: url, id: url, kind: "document", title: url, description: "", url }));
}

export function fuseCandidates(lists, limit = 40) {
	const scores = new Map();
	const values = new Map();
	let order = 0;
	for (const list of lists) list.forEach((item, index) => {
		if (!values.has(item.key)) values.set(item.key, { ...item, order: order++ });
		scores.set(item.key, (scores.get(item.key) ?? 0) + 1 / (60 + index));
	});
	return [...values.values()]
		.sort((a, b) => (scores.get(b.key) - scores.get(a.key)) || a.order - b.order)
		.slice(0, limit)
		.map(({ order: _order, ...item }) => item);
}

export function buildRerankInput(question, documents, examples) {
	const line = (item) => `${item.key} | ${item.title} | ${compact(item.description, 240)}`;
	return `QUESTION\n${question}\n\nDOCUMENT CANDIDATES\n${documents.map(line).join("\n")}\n\nEXAMPLE CANDIDATES\n${examples.map(line).join("\n")}\n\nReturn only the selection JSON.`;
}

export function parseSelection(text, documents, examples) {
	const value = parseJsonObject(text);
	const documentMap = new Map(documents.map((item) => [item.key, item]));
	const exampleMap = new Map(examples.map((item) => [item.key, item]));
	const selectedDocuments = (Array.isArray(value?.documentKeys) ? value.documentKeys : [])
		.filter((key) => typeof key === "string" && documentMap.has(key)).slice(0, MAX_DOCUMENTS).map((key) => documentMap.get(key));
	const selectedExamples = (Array.isArray(value?.exampleIds) ? value.exampleIds : [])
		.filter((key) => typeof key === "string" && exampleMap.has(key)).slice(0, MAX_EXAMPLES).map((key) => exampleMap.get(key));
	return {
		documents: selectedDocuments.length ? selectedDocuments : documents.slice(0, Math.min(3, MAX_DOCUMENTS)),
		examples: selectedExamples.length ? selectedExamples : examples.slice(0, MAX_EXAMPLES),
	};
}

export async function retrieveEvidence(host, selection, signal, emit = () => {}) {
	const retrieved = [];
	for (const candidate of [...selection.documents, ...selection.examples]) {
		emit({ type: "progress", stage: "retrieval", detail: candidate.key });
		const isExample = candidate.kind === "example";
		const tool = isExample ? "get_example" : candidate.lookupTool ?? "get_doc_content";
		const args = isExample
			? { id: candidate.id }
			: tool === "query_scriptnode"
				? { query: candidate.key.replace(/^id:/, "").replace(/^scriptnode:/, "") }
				: candidate.key.startsWith("id:") ? { id: candidate.key.slice(3) } : { url: candidate.key };
		try {
			const value = await host.callTool(tool, args, signal);
			const body = compact(resultText(value), MAX_EXCERPT_CHARS);
			if (!body) continue;
			retrieved.push({ ...candidate, body, url: candidate.url ?? findUrl(value) });
		} catch (error) {
			emit({ type: "progress", stage: "retrieval", detail: `${candidate.key}: ${errorMessage(error)}`, ok: false });
		}
	}
	return retrieved.map((item, index) => ({ ...item, citationId: `E${index + 1}` }));
}

export function evidencePrompt(evidence) {
	return evidence.map((item) => `[${item.citationId}] ${item.title}\nCanonical URL: ${item.url ?? "unavailable"}\n${item.body}`).join("\n\n---\n\n");
}

export function resultText(value) {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return value == null ? "" : String(value);
	if (Array.isArray(value)) return value.map(resultText).filter(Boolean).join("\n");
	const content = Array.isArray(value.content) ? value.content : [];
	const text = content.map((item) => typeof item?.text === "string" ? item.text : "").filter(Boolean).join("\n");
	if (text) return text;
	if (typeof value.body === "string") return value.body;
	if (typeof value.text === "string") return value.text;
	return JSON.stringify(value);
}

function decodeEmbeddedJson(value) {
	const text = resultText(value).trim();
	if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
	try { return JSON.parse(text); } catch { return value; }
}

function collectArrays(value, found = []) {
	if (Array.isArray(value)) found.push(value);
	else if (value && typeof value === "object") for (const child of Object.values(value)) collectArrays(child, found);
	return found;
}

function parseJsonObject(text) {
	const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const source = fenced ?? String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1);
	try { return JSON.parse(source); } catch { return null; }
}

function stringValue(...values) {
	return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? "";
}

function compact(value, max) {
	const text = String(value ?? "").replace(/\s+/g, " ").trim();
	return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function findUrl(value) {
	if (typeof value?.url === "string") return value.url;
	return resultText(value).match(/\/v2\/[^"\\\s)>,;]+/)?.[0];
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
