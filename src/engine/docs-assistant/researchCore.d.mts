export interface ResearchCallMetadata {
	label: string;
	detail: string;
	required: boolean;
}

export interface ResearchScope {
	exploreDomain?: string;
	searchDomain?: string;
	exampleSource?: string;
	scriptnode?: boolean;
	supplementGlobal?: boolean;
}

export interface SearchResultSummary {
	id: string;
	name: string;
	description: string;
	url?: string;
}

export interface CandidateMetadata {
	key: string;
	title: string;
	description: string;
	url?: string;
}

export interface ResearchCandidates {
	primary: unknown;
	broad: unknown;
	examples: unknown;
	documentKeys: string[];
	exampleIds: string[];
	documentMetadata: CandidateMetadata[];
	exampleMetadata: CandidateMetadata[];
	domain?: "scriptnode";
}

export interface ResearchSelection {
	documentKeys: string[];
	exampleIds: string[];
}

export interface RetrievedEvidenceItem {
	key?: string;
	id?: string;
	title?: string;
	description?: string;
	url?: string;
	result: unknown;
	text: string;
}

export const RESEARCH_EXPANSION_PROMPT: string;
export const RESEARCH_RERANK_PROMPT: string;
export function createResearchSynthesisPrompt(cheatSheet?: string): string;
export function buildResearchSynthesisRequest(question: string, evidence: string, options?: { requireDiagnosableHiseScript?: boolean }): string;
export function collectResearchCandidates(queries: string[], options: {
	resolveScope?: (query: string) => ResearchScope;
	call: (tool: string, argumentsValue: Record<string, unknown>, metadata: ResearchCallMetadata) => Promise<unknown>;
}): Promise<ResearchCandidates>;
export function buildRerankPrompt(query: string, candidates: ResearchCandidates): string;
export function parseResearchQueries(text: string, originalQuery: string): string[];
export function parseResearchSelection(text: string, availableDocumentKeys: string[], availableExampleIds: string[]): ResearchSelection;
export function fetchResearchEvidence(selection: ResearchSelection, candidates: ResearchCandidates, options: {
	call: (tool: string, argumentsValue: Record<string, unknown>, metadata: ResearchCallMetadata) => Promise<unknown>;
}): Promise<{ text: string; documents: RetrievedEvidenceItem[]; examples: RetrievedEvidenceItem[] }>;
export function cleanResearchEvidence(evidence: string): string;
export function mcpResultText(value: unknown): string;
export function extractSearchResults(value: unknown): SearchResultSummary[];
