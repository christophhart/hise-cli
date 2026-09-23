export const RESEARCH_EXPANSION_PROMPT = `You rewrite HISE documentation questions for semantic retrieval. Do not answer the question. Return exactly one JSON object with a queries array containing two or three short alternative searches. Preserve explicit identifiers. Add precise HISE vocabulary, expand ambiguous user terms, and describe both acquisition and follow-up operations when the task is a workflow. Preserve every relationship constraint from the original question in each rewrite, such as one processor owning an object that another script must access. Include plausible alternative interpretations rather than committing to an uncertain one. In HISE, "module" usually means a processor; "node" may mean a ScriptNode Node in a DspNetwork, a child processor in the module tree, or a UI child component; and the Interface script accessing another module is a cross-processor operation. Cover these distinct meanings when the wording is ambiguous. If the original question explicitly names ScriptNode, scriptnode, DspNetwork, or DSP nodes, repeat that vocabulary in every rewrite and do not turn the question into a HiseScript API question. Do not include the original query; the caller preserves it automatically.

Example output:
{"queries":["cross-processor ScriptNode DspNetwork access from an Interface script","retrieve an existing DSP network owned by another script processor then get a Node by ID","reference a child HISE processor from the Interface script"]}`;

export const RESEARCH_RERANK_PROMPT = `You select evidence for a HISE documentation answer. Given a user question and shallow MCP search results, choose only the documents and examples that contain facts needed to answer the question. Select complete workflows, including acquisition and follow-up methods when separate candidates cover separate steps. Exclude merely similar classes, methods, and examples. Do not answer the question or invent identifiers.

Return exactly one JSON object:
{"documentKeys":["exact candidate URL or id:key"],"exampleIds":["exact candidate ID"]}

Select at most 4 documents and 2 examples. Every value must be copied exactly from the candidates. Examples are optional; omit them when they do not directly demonstrate the requested workflow.`;

export function createResearchSynthesisPrompt(cheatSheet = "") {
	return `You are a research-only HISE documentation specialist. The parent has retrieved a bounded evidence pack from HISE documentation and the code-example database. For code-oriented questions, use the retrieved full API documentation and examples before synthesizing. Return a concise Markdown answer with documented facts, a focused example when useful, caveats, and source URLs or example IDs. Never claim to inspect or modify the user's project. Flag contradictions in the sources.

Output style:
- Write for HISEScript developers, not C++ developers. Lead with the recommended pattern, when to use it, and any practical default.
- Use concise British English and ASCII punctuation. Avoid filler, marketing language, and restating headings.
- Include code only when it demonstrates a useful pattern, non-obvious behaviour, or realistic mistake. Keep it focused and executable in its stated context, with essential setup and every referenced variable declared.
- Treat retrieved evidence as authoritative for HISE-specific APIs, identifiers, callbacks, integration contracts, runtime behaviour, and all HiseScript. JavaScript-looking code in a HISE context is HiseScript unless the user explicitly asks for standard JavaScript; do not fill HiseScript gaps from generic JavaScript knowledge.
- You may use stable general knowledge for self-contained secondary-language code and concepts, including GLSL, Faust, CSS, regular expressions, mathematics, and standard DSP or graphics algorithms. Keep portable code separate from undocumented HISE integration details, identify only the symbols or adapter points that genuinely depend on HISE, and do not withhold a useful portable example merely because the HISE documentation does not teach the underlying language.
- Do not invent HISE setup code or API calls. Prefer retrieved, validated HISE patterns and state clearly when HISE-specific evidence is incomplete. Do not imply that a portable secondary-language example was validated by HISE unless validation actually occurred.
- Cite evidence for HISE-specific claims. Common secondary-language syntax or algorithms need no citation, and must not be presented as if a HISE source established them.
- Comments should explain why or show expected output, not narrate obvious statements.
- Include only non-obvious caveats and common mistakes. Explain the consequence and the correct alternative.
- Do not expose C++ class names, source locations, preprocessor symbols, or internal implementation mechanisms.
- Use lists or compact tables for three or more options, modes, fields, or steps.

${cheatSheet}`;
}

export function buildResearchSynthesisRequest(question, evidence, { requireDiagnosableHiseScript = false } = {}) {
	const diagnosticRule = requireDiagnosableHiseScript
		? "\n\nEvery fenced HiseScript, JavaScript, or JS example must be standalone code that HISE can diagnose."
		: "";
	return `QUESTION\n${String(question).trim()}\n\nMCP evidence retrieved for this request:\n${String(evidence).trim() || "No usable evidence was retrieved."}\n\nProduce the answer according to the synthesis and evidence policy in the system prompt.${diagnosticRule}`;
}

export async function collectResearchCandidates(queries, options) {
	const primaryResults = [];
	const broadResults = [];
	const exampleResults = [];
	const semanticDocumentLists = [];
	const broadDocumentLists = [];
	const exampleLists = [];
	let scriptnode = false;
	for (let index = 0; index < queries.length; index++) {
		const query = queries[index];
		const scope = options.resolveScope?.(query) ?? {};
		scriptnode ||= Boolean(scope.scriptnode);
		const exploreArguments = { query, ...(scope.exploreDomain ? { domain: scope.exploreDomain } : {}), source: "docs" };
		const searchArguments = { query, limit: 20, ...(scope.searchDomain ? { domain: scope.searchDomain } : {}) };
		const exampleArguments = { query, limit: 20, ...(scope.exampleSource ? { source: scope.exampleSource } : {}) };
		const primary = await options.call("explore_hise", exploreArguments, {
			label: index === 0 ? "Documentation search" : "Expanded documentation search",
			detail: `explore_hise · ${index + 1}/${queries.length}`,
			required: index === 0,
		});
		const broad = await options.call("search_hise", searchArguments, {
			label: "Broad candidate search", detail: `search_hise · ${index + 1}/${queries.length}`, required: false,
		});
		const examples = await options.call("search_examples", exampleArguments, {
			label: "Example search", detail: `search_examples · ${index + 1}/${queries.length}`, required: false,
		});
		primaryResults.push(primary);
		const broadItems = extractSearchResults(broad);
		const exampleItems = extractSearchResults(examples);
		broadResults.push(...broadItems);
		exampleResults.push(...exampleItems);
		semanticDocumentLists.push(extractDocumentUrls(primary));
		broadDocumentLists.push(broadItems.map((item) => `id:${item.id}`));
		exampleLists.push(exampleItems.map((item) => item.id));

		if (scope.supplementGlobal && (scope.exploreDomain || scope.searchDomain)) {
			const globalExplore = await options.call("explore_hise", { query, source: "docs" }, {
				label: "Cross-domain documentation search", detail: `explore_hise · ${index + 1}/${queries.length}`, required: false,
			});
			const globalBroad = await options.call("search_hise", { query, limit: 20 }, {
				label: "Cross-domain candidate search", detail: `search_hise · ${index + 1}/${queries.length}`, required: false,
			});
			primaryResults.push(globalExplore);
			const globalItems = extractSearchResults(globalBroad);
			broadResults.push(...globalItems);
			semanticDocumentLists.push(extractDocumentUrls(globalExplore));
			broadDocumentLists.push(globalItems.map((item) => `id:${item.id}`));
		}
	}
	const semanticDocuments = fuseRankedCandidates(semanticDocumentLists, 40);
	const broadDocuments = fuseRankedCandidates(broadDocumentLists, 40).filter((key) => !semanticDocuments.includes(key));
	const primaryText = primaryResults.map(mcpResultText).join("\n\n--- EXPANDED QUERY ---\n\n");
	const dedupedBroad = dedupeSearchResults(broadResults);
	const dedupedExamples = dedupeSearchResults(exampleResults);
	const documentKeys = [...semanticDocuments, ...broadDocuments];
	const exampleIds = fuseRankedCandidates(exampleLists, 40);
	const broadByKey = new Map(dedupedBroad.map((item) => [`id:${item.id}`, item]));
	const examplesById = new Map(dedupedExamples.map((item) => [item.id, item]));
	return {
		primary: textResult(primaryText),
		broad: textResult(JSON.stringify({ results: dedupedBroad })),
		examples: textResult(JSON.stringify({ results: dedupedExamples })),
		documentKeys,
		exampleIds,
		documentMetadata: documentKeys.map((key) => key.startsWith("id:")
			? candidateMetadata(key, broadByKey.get(key))
			: primaryCandidateMetadata(primaryText, key)),
		exampleMetadata: exampleIds.map((id) => candidateMetadata(id, examplesById.get(id))),
		domain: scriptnode ? "scriptnode" : undefined,
	};
}

export function buildRerankPrompt(query, candidates) {
	const primaryText = mcpResultText(candidates.primary);
	const broad = new Map(extractSearchResults(candidates.broad).map((result) => [`id:${result.id}`, result]));
	const examples = new Map(extractSearchResults(candidates.examples).map((result) => [result.id, result]));
	const documentLines = candidates.documentKeys.map((key) => {
		if (!key.startsWith("id:")) return primaryCandidateSummary(primaryText, key);
		const result = broad.get(key);
		return result ? `${key} | ${result.name} | ${compactDescription(result.description)}` : key;
	});
	const exampleLines = candidates.exampleIds.map((id) => {
		const result = examples.get(id);
		return result ? `${id} | ${result.name} | ${compactDescription(result.description)}` : id;
	});
	return `QUESTION\n${query}\n\nDOCUMENT CANDIDATES\n${documentLines.join("\n")}\n\nEXAMPLE CANDIDATES\n${exampleLines.join("\n")}\n\nReturn only the selection JSON.`;
}

export function parseResearchQueries(text, originalQuery) {
	const parsed = parseJsonObject(text);
	const expanded = Array.isArray(parsed?.queries)
		? parsed.queries.filter((value) => typeof value === "string").map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length > 0 && value.length <= 300)
		: [];
	return [...new Set([originalQuery, ...expanded])].slice(0, 4);
}

export function parseResearchSelection(text, availableDocumentKeys, availableExampleIds) {
	const parsed = parseJsonObject(text);
	const documents = new Set(availableDocumentKeys);
	const examples = new Set(availableExampleIds);
	const documentKeys = Array.isArray(parsed?.documentKeys) ? parsed.documentKeys.filter((value) => typeof value === "string" && documents.has(value)).slice(0, 4) : [];
	const exampleIds = Array.isArray(parsed?.exampleIds) ? parsed.exampleIds.filter((value) => typeof value === "string" && examples.has(value)).slice(0, 2) : [];
	if (documentKeys.length > 0) return { documentKeys, exampleIds };
	return { documentKeys: availableDocumentKeys.slice(0, 3), exampleIds: availableExampleIds.slice(0, 2) };
}

export async function fetchResearchEvidence(selection, candidates, options) {
	const documents = [];
	const documentMetadata = new Map((candidates.documentMetadata ?? []).map((item) => [item.key, item]));
	const exampleMetadata = new Map((candidates.exampleMetadata ?? []).map((item) => [item.key, item]));
	for (const key of selection.documentKeys) {
		const lookupTool = candidates.domain === "scriptnode" && key.startsWith("id:") ? "query_scriptnode" : "get_doc_content";
		const args = lookupTool === "query_scriptnode" ? { query: key.slice(3) } : key.startsWith("id:") ? { id: key.slice(3) } : { url: key };
		const result = await options.call(lookupTool, args, { label: "Document lookup", detail: key, required: false });
		if (!isFailure(result)) documents.push({ key, ...documentMetadata.get(key), result, text: clipEvidence(mcpResultText(result), 5000) });
	}
	const examples = [];
	for (const id of selection.exampleIds) {
		const result = await options.call("get_example", { id }, { label: "Example lookup", detail: id, required: false });
		if (!isFailure(result)) examples.push({ id, ...exampleMetadata.get(id), result, text: clipEvidence(mcpResultText(result), 5000) });
	}
	const sections = [
		`SELECTED SOURCES\n${selection.documentKeys.join("\n")}${selection.exampleIds.length ? `\n${selection.exampleIds.join("\n")}` : ""}`,
		...documents.map((item) => `DOCUMENT ${item.key}\n${item.text}`),
		...examples.map((item) => `EXAMPLE ${item.id}\n${item.text}`),
	];
	const text = sections.length === 1 ? `SEARCH RESULTS\n${clipEvidence(mcpResultText(candidates.primary), 5000)}` : sections.join("\n\n");
	return { text, documents, examples };
}

export function cleanResearchEvidence(evidence) {
	const output = [];
	let skipInternalSection = false;
	for (const line of evidence.split("\n")) {
		if (/^(?:Source|Dispatch\/mechanics):\s*$/.test(line.trim())) { skipInternalSection = true; continue; }
		if (skipInternalSection) { if (line.trim() === "") skipInternalSection = false; continue; }
		const trimmed = line.trim();
		if (/^Thread safety:/i.test(trimmed)) continue;
		if (/^[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*\(.*\)\s*->/.test(trimmed)) continue;
		if (/^\*\*Common pitfalls:\*\*\s*(?:\[object Object\],?)*\s*$/.test(trimmed)) continue;
		if (/\b(?:WARN_IF_AUDIO_THREAD|USE_BACKEND|HISE_[A-Z0-9_]+|JUCE_[A-Z0-9_]+)\b/.test(line)) continue;
		if (/\.(?:cpp|cc|cxx|h|hpp):\d+\b/.test(line)) continue;
		if (trimmed === "" && output.at(-1)?.trim() === "") continue;
		output.push(line);
	}
	return output.join("\n").trim();
}

export function mcpResultText(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return JSON.stringify(value);
	const content = Array.isArray(value.content) ? value.content : [];
	const text = content.map((item) => item && typeof item === "object" && !Array.isArray(item) && typeof item.text === "string" ? item.text : "").filter(Boolean).join("\n");
	return text || JSON.stringify(value);
}

export function extractSearchResults(value) {
	try {
		const parsed = JSON.parse(mcpResultText(value));
		return (parsed.results ?? []).flatMap((result) => typeof result.id === "string" ? [{ id: result.id, name: typeof result.name === "string" ? result.name : typeof result.title === "string" ? result.title : result.id, description: typeof result.description === "string" ? result.description : "", url: typeof result.url === "string" ? result.url : undefined }] : []);
	} catch { return []; }
}

function extractDocumentUrls(value) {
	return [...new Set((mcpResultText(value).match(/\/v2\/[^"\\\s]+/g) ?? []).map((url) => url.replace(/[),.;]+$/, "")))];
}

function primaryCandidateSummary(text, key) {
	const metadata = primaryCandidateMetadata(text, key);
	return `${key} | ${metadata.title} | ${metadata.description}`;
}

function primaryCandidateMetadata(text, key) {
	const lines = text.split("\n");
	const index = lines.findIndex((line) => line.trim() === key);
	if (index < 0) return { key, title: key, description: "", url: key };
	const title = index > 0 ? lines[index - 1].trim() : key;
	const description = index + 1 < lines.length ? lines[index + 1].trim() : "";
	return { key, title, description, url: key };
}

function candidateMetadata(key, item) {
	return {
		key,
		title: item?.name ?? key.replace(/^id:/, ""),
		description: item?.description ?? "",
		url: item?.url,
	};
}

function compactDescription(text) {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= 240 ? oneLine : `${oneLine.slice(0, 240)}...`;
}

function dedupeSearchResults(results) {
	const seen = new Set();
	return results.filter((result) => !seen.has(result.id) && Boolean(seen.add(result.id)));
}

function fuseRankedCandidates(lists, limit) {
	const scores = new Map();
	const order = new Map();
	let nextOrder = 0;
	for (const list of lists) list.forEach((key, index) => {
		scores.set(key, (scores.get(key) ?? 0) + 1 / (60 + index));
		if (!order.has(key)) order.set(key, nextOrder++);
	});
	return [...scores.keys()].sort((a, b) => (scores.get(b) - scores.get(a)) || (order.get(a) - order.get(b))).slice(0, limit);
}

function parseJsonObject(text) {
	const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? String(text).slice(String(text).indexOf("{"), String(text).lastIndexOf("}") + 1);
	try { return JSON.parse(candidate); } catch { return null; }
}

function textResult(text) { return { content: [{ type: "text", text }] }; }
function clipEvidence(text, maxChars) { return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n[remaining evidence omitted]`; }
function isFailure(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value) && "error" in value); }
