import { appendValidationNotice, enforceCitations, extractHiseScriptBlocks } from "./citations.mjs";
import { evidencePrompt } from "./evidence.mjs";
import { CORRECTION_SYSTEM } from "./prompt.mjs";
import { HISESCRIPT_CHEAT_SHEET } from "../engine/docs-assistant/hiseScriptGuidance.mjs";
import * as researchCore from "../engine/docs-assistant/researchCore.mjs";

export async function runResearch(request, { docs, modelHost, signal, emit = () => {} }) {
	const question = String(request.question ?? "").trim();
	if (!question) throw new Error("A research question is required");
	if (question.length > 4_000) throw new Error("The research question is too long");

	emit(progress("models", "Resolving hise-cli Pi model settings"));
	const models = await modelHost.beginRequest();
	emit(progress("readiness", "Checking documentation service"));
	await docs.checkReady(signal);
	const sharedOptions = sharedResearchOptions(docs, request, signal, emit);

	emit(progress("expansion", "Expanding documentation queries"));
	const expansion = await models.complete("worker", { system: researchCore.RESEARCH_EXPANSION_PROMPT, prompt: question, signal });
	const queries = researchCore.parseResearchQueries(expansion.text, question);
	emit({ type: "queries", queries });

	emit(progress("search", `Searching ${queries.length} bounded quer${queries.length === 1 ? "y" : "ies"}`));
	const candidates = await researchCore.collectResearchCandidates(queries, sharedOptions);
	emit(progress("reranking", `Selecting from ${candidates.documentKeys.length} documents and ${candidates.exampleIds.length} examples`));
	const rerank = await models.complete("worker", {
		system: researchCore.RESEARCH_RERANK_PROMPT,
		prompt: researchCore.buildRerankPrompt(question, candidates),
		signal,
	});
	const selection = researchCore.parseResearchSelection(rerank.text, candidates.documentKeys, candidates.exampleIds);
	const retrieved = await researchCore.fetchResearchEvidence(selection, candidates, sharedOptions);
	const evidence = toCitationEvidence(retrieved);
	const evidenceSummary = evidence.map(({ citationId, id, kind, title, description, url }) => ({ citationId, id, kind, title, description, url }));
	if (request.output === "sources") {
		const usage = combineUsage([
			{ role: "worker", stage: "expansion", ...expansion },
			{ role: "worker", stage: "reranking", ...rerank },
		]);
		return {
			question,
			markdown: evidence.length > 0 ? "Selected documentation sources are listed below." : "No relevant documentation sources were found.",
			citations: [],
			evidence: evidenceSummary,
			documentationStatus: evidence.length > 0 ? "supported" : "insufficient",
			validationStatus: "not-applicable",
			validationRequest: undefined,
			usage,
		};
	}

	emit(progress("synthesis", `Synthesising from ${evidence.length} retrieved source${evidence.length === 1 ? "" : "s"}`));
	const synthesisSystem = `${researchCore.createResearchSynthesisPrompt(HISESCRIPT_CHEAT_SHEET)}\n\nCitation contract:\n- Cite only supplied evidence identifiers such as [E1].\n- Never write a URL; the host resolves citation identifiers.`;
	const synthesis = await models.complete("thinker", {
		system: synthesisSystem,
		prompt: researchCore.buildResearchSynthesisRequest(question, evidencePrompt(evidence), { requireDiagnosableHiseScript: true }),
		signal,
	});
	const checked = enforceCitations(synthesis.text || "The documentation evidence did not establish an answer.", evidence);
	const blocks = extractHiseScriptBlocks(checked.markdown);
	const usage = combineUsage([
		{ role: "worker", stage: "expansion", ...expansion },
		{ role: "worker", stage: "reranking", ...rerank },
		{ role: "thinker", stage: "synthesis", ...synthesis },
	]);
	const documentationStatus = checked.citations.length > 0 ? "supported" : evidence.length > 0 ? "partial" : "insufficient";
	const validationRequested = request.validation === "enabled" && blocks.length > 0;
	const validationStatus = validationRequested ? "pending" : blocks.length === 0 ? "not-applicable" : "disabled";
	const markdown = validationStatus === "disabled" ? appendValidationNotice(checked.markdown, "disabled") : checked.markdown;
	return {
		question,
		markdown,
		citations: checked.citations,
		evidence: evidenceSummary,
		documentationStatus,
		validationStatus,
		validationRequest: validationRequested ? { kind: "hisescript-diagnose", blocks } : undefined,
		usage,
		_repair: { models, evidence, answer: checked.markdown, attempts: 0 },
	};
}

export async function repairResearch(run, diagnostics, { signal, emit = () => {} } = {}) {
	const issues = normalizeIssues(diagnostics);
	if (issues.length === 0) {
		return {
			...publicResult(run),
			markdown: appendValidationNotice(run._repair.answer, "passed"),
			validationStatus: "passed",
			validationRequest: undefined,
		};
	}
	if (run._repair.attempts >= 2) {
		return {
			...publicResult(run),
			markdown: appendValidationNotice(run._repair.answer, "failed"),
			validationStatus: "failed",
			validationRequest: undefined,
		};
	}
	emit(progress("correction", `Repairing HiseScript, pass ${run._repair.attempts + 1}/2`));
	const correction = await run._repair.models.complete("thinker", {
		system: CORRECTION_SYSTEM,
		prompt: `ORIGINAL EVIDENCE\n${evidencePrompt(run._repair.evidence)}\n\nPREVIOUS ANSWER\n${run._repair.answer}\n\nHISE DIAGNOSTICS\n${issues.join("\n")}`,
		signal,
	});
	const checked = enforceCitations(correction.text, run._repair.evidence);
	const blocks = extractHiseScriptBlocks(checked.markdown);
	run._repair.answer = checked.markdown || run._repair.answer;
	run._repair.attempts++;
	run.markdown = run._repair.answer;
	run.citations = checked.citations;
	run.usage = combineUsage([run.usage, { role: "thinker", stage: `correction-${run._repair.attempts}`, ...correction }]);
	if (blocks.length === 0) {
		return {
			...publicResult(run),
			markdown: appendValidationNotice(run._repair.answer, "failed"),
			validationStatus: "failed",
			validationRequest: undefined,
		};
	}
	return {
		...publicResult(run),
		validationStatus: "pending",
		validationRequest: { kind: "hisescript-diagnose", blocks },
	};
}

export function unavailableValidation(run, detail) {
	return {
		...publicResult(run),
		markdown: appendValidationNotice(run._repair.answer, "unavailable", detail),
		validationStatus: "unavailable",
		validationRequest: undefined,
	};
}

export function publicResult(result) {
	const { _repair: _private, ...value } = result;
	return value;
}

function progress(stage, detail) {
	return { type: "progress", stage, detail, ok: true };
}

function sharedResearchOptions(host, request, signal, emit) {
	return {
		resolveScope(query) { return domainsFor(request.topic ?? request.domain, query); },
		async call(name, args, metadata) {
			emit(progress(metadata.label, metadata.detail));
			if (metadata.required) return host.callTool(name, args, signal);
			try { return await host.callTool(name, args, signal); }
			catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
		},
	};
}

export function domainsFor(hint, query) {
	const explicit = Boolean(hint && hint !== "auto");
	const topic = explicit
		? hint
		: /\bscript\s*node\b|\bdsp\s*network\b|\bdsp\s+node\b/i.test(query) ? "scriptnode" : undefined;
	const supplementGlobal = explicit || undefined;
	if (topic === "ui") return { exploreDomain: "ui", searchDomain: "ui", supplementGlobal };
	if (topic === "modules") return { exploreDomain: "audio", searchDomain: "modules", supplementGlobal };
	if (topic === "scriptnode") return { exploreDomain: "scriptnode", searchDomain: "scriptnode", exampleSource: "scriptnode", scriptnode: true, supplementGlobal };
	if (topic === "scripting") return { exploreDomain: "scripting", searchDomain: "api", supplementGlobal };
	return {};
}

function toCitationEvidence(retrieved) {
	const items = [
		...retrieved.documents.map((item) => ({ id: item.key, key: item.key, kind: "document", title: item.title, description: item.description, url: item.url, text: item.text })),
		...retrieved.examples.map((item) => ({ id: item.id, key: item.id, kind: "example", title: item.title, description: item.description, url: item.url, text: item.text })),
	];
	return items.map((item, index) => {
		const body = researchCore.cleanResearchEvidence(item.text);
		const url = item.key?.startsWith("/v2/") ? item.key : item.url ?? body.match(/\/v2\/[^"\\\s)>,;]+/)?.[0];
		const heading = body.match(/^#\s+(.+)$/m)?.[1];
		return {
			citationId: `E${index + 1}`,
			id: item.id,
			kind: item.kind,
			title: item.title ?? heading ?? String(item.key ?? item.id).replace(/^id:/, ""),
			description: item.description || firstDescription(body),
			url,
			body,
		};
	}).filter((item) => item.body);
}

function firstDescription(body) {
	return body.split(/\n\s*\n/).map((part) => part.replace(/^#+\s+.*$/gm, "").replace(/\s+/g, " ").trim()).find(Boolean)?.slice(0, 320) ?? "";
}

function normalizeIssues(results) {
	if (!Array.isArray(results)) return ["The browser returned malformed validation results."];
	const issues = [];
	for (const result of results) {
		if (result?.unavailable) issues.push(`Validation unavailable: ${String(result.unavailable)}`);
		for (const item of Array.isArray(result?.diagnostics) ? result.diagnostics : []) {
			if (["warning", "hint"].includes(String(item?.severity).toLowerCase())) continue;
			issues.push(`Block ${Number(result.index) + 1}, line ${item?.line ?? 0}, column ${item?.column ?? 0}: ${item?.message ?? "Unknown diagnosis error"}`);
		}
	}
	return issues;
}

function combineUsage(entries) {
	const stages = [];
	for (const entry of entries) {
		if (Array.isArray(entry?.stages)) stages.push(...entry.stages);
		else if (entry?.usage) stages.push({ role: entry.role, stage: entry.stage, model: entry.model, thinkingLevel: entry.thinkingLevel, ...entry.usage });
	}
	return {
		stages,
		input: stages.reduce((sum, item) => sum + (item.input ?? 0), 0),
		output: stages.reduce((sum, item) => sum + (item.output ?? 0), 0),
		cacheRead: stages.reduce((sum, item) => sum + (item.cacheRead ?? 0), 0),
		total: stages.reduce((sum, item) => sum + (item.total ?? 0), 0),
		cost: stages.reduce((sum, item) => sum + (item.cost ?? 0), 0),
	};
}
