import { randomUUID } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createConnection, ProposedFeatures, StreamMessageReader, StreamMessageWriter,
	TextDocumentSyncKind, ResponseError, LSPErrorCodes,
	type InitializeParams, type Diagnostic, type Location, type CompletionItem,
	type Hover, type PublishDiagnosticsParams,
} from "vscode-languageserver/node.js";

interface DocumentState {
	uri: string;
	version: number;
	epoch?: number;
	text: string;
	analyzedVersion?: number;
	processors: string[];
	kind?: string;
	generation: number;
	pendingChange?: ReturnType<typeof setTimeout>;
	pendingAnalysis?: Promise<void>;
	finishPendingAnalysis?: () => void;
}

interface DiagnosticGroup {
	uri: string;
	processors: Array<{ moduleId: string; diagnostics: Diagnostic[] }>;
}

interface RestResult {
	success: true;
	apiVersion?: string;
	uri?: string;
	version?: number;
	epoch?: number;
	documentKind?: string;
	processors?: string[];
	diagnosticsByUri?: DiagnosticGroup[];
	items?: CompletionItem[];
	isIncomplete?: boolean;
	hover?: Hover | null;
	locations?: Location | Location[] | null;
	references?: Location[];
}

export interface LspOptions {
	baseUrl: string;
	timeoutMs: number;
	logLevel?: "quiet" | "normal";
}

function rpcError(message: string): ResponseError<void> {
	return new ResponseError(LSPErrorCodes.RequestFailed, message);
}

export class HiseLspRestClient {
	constructor(private readonly options: LspOptions) {}

	async request(route: string, body?: object): Promise<RestResult> {
		let response: Response;
		try {
			response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/api/${route}`, {
				method: body ? "POST" : "GET",
				headers: body ? { "Content-Type": "application/json" } : undefined,
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(this.options.timeoutMs),
			});
		} catch (error) {
			throw rpcError(`HISE is unavailable (${route}): ${String(error)}`);
		}
		let data: unknown;
		try {
			data = await response.json();
		} catch {
			throw rpcError(`Malformed HISE response from ${route} (HTTP ${response.status})`);
		}
		if (typeof data !== "object" || data === null || !("success" in data)) {
			throw rpcError(`Malformed HISE response from ${route}`);
		}
		if (!response.ok || data.success !== true) {
			const errors = "errors" in data && Array.isArray(data.errors)
				? data.errors.map((entry: unknown) => typeof entry === "object" && entry !== null && "errorMessage" in entry ? String(entry.errorMessage) : String(entry)).join("; ") : "";
			throw rpcError(`HISE ${route} failed (HTTP ${response.status}): ${errors || "unknown error"}`);
		}
		return data as RestResult;
	}
}

function localPath(uri: string): string {
	try {
		const url = new URL(uri);
		if (url.protocol !== "file:" || url.search || url.hash || (url.host && url.host !== "localhost")) throw Error();
		return resolve(fileURLToPath(url));
	} catch {
		throw rpcError(`Unsupported file URI: ${uri}`);
	}
}

function pathKey(path: string): string {
	return process.platform === "win32" ? path.toLowerCase() : path;
}

function within(path: string, root: string): boolean {
	const rel = relative(pathKey(root), pathKey(path));
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

function diagnosticKey(d: Diagnostic): string {
	return JSON.stringify([d.range, d.severity, d.message, d.source, d.code, d.tags]);
}

/** Stdio transport is deliberately separate from the TUI/CLI bootstrap: stdout is protocol-only. */
export function startLsp(options: LspOptions, input: Readable = process.stdin, output: Writable = process.stdout): void {
	const connection = createConnection(ProposedFeatures.all,
		new StreamMessageReader(input), new StreamMessageWriter(output));
	const rest = new HiseLspRestClient(options);
	const sessionId = randomUUID();
	const documents = new Map<string, DocumentState>();
	let projectRoot: string | undefined;
	let apiVersion: string | undefined;
	let shutdown = false;
	let completionMarkdown = false;
	let hoverMarkdown = false;
	let supportedKinds: Set<number> | undefined;
	// A single mutation lane also protects processors shared by different included files.
	let mutations: Promise<void> = Promise.resolve();
	const log = (message: string): void => {
		if (options.logLevel !== "quiet") process.stderr.write(`[hise-lsp] ${message}\n`);
	};
	const enqueue = (operation: () => Promise<void>): Promise<void> => {
		const next = mutations.then(operation);
		mutations = next.catch((error: unknown) => { log(String(error)); });
		return next;
	};
	const status = async (): Promise<string> => {
		const info = await rest.request("status");
		const project = (info as RestResult & { project?: { projectFolder?: string } }).project;
		if (!project?.projectFolder || !info.apiVersion) throw rpcError("HISE has no initialized project (or is in the snippet browser)");
		return project.projectFolder;
	};
	const ensureProject = async (): Promise<void> => {
		if (!projectRoot) throw rpcError("LSP server has not initialized");
		const current = await status();
		if (pathKey(resolve(current)) !== pathKey(projectRoot)) throw rpcError("HISE has switched projects; restart the language server for the active project");
	};
	const checked = (uri: string): DocumentState => {
		const path = localPath(uri);
		if (!projectRoot || !within(path, projectRoot)) throw rpcError(`File is outside the active HISE project: ${uri}`);
		const doc = documents.get(uri);
		if (!doc || doc.epoch === undefined) throw rpcError(`Document is not open in HISE: ${uri}`);
		return doc;
	};
	const publish = (groups: DiagnosticGroup[] | undefined, source: DocumentState, generation: number): void => {
		if (!Array.isArray(groups) || documents.get(source.uri) !== source || source.generation !== generation) return;
		for (const group of groups) {
			const target = documents.get(group.uri);
			if (!target || !Array.isArray(group.processors) || (target !== source && target.analyzedVersion !== target.version)) continue;
			const seen = new Set<string>();
			const diagnostics: Diagnostic[] = [];
			for (const processor of group.processors) {
				for (const diagnostic of processor.diagnostics ?? []) {
					if (!diagnostic?.range || typeof diagnostic.message !== "string") continue;
					const key = diagnosticKey(diagnostic);
					if (!seen.has(key)) { seen.add(key); diagnostics.push(diagnostic); }
				}
			}
			connection.sendDiagnostics({ uri: target.uri, version: target.version, diagnostics } satisfies PublishDiagnosticsParams);
		}
	};
	const notifyFailure = (error: unknown): void => {
		log(String(error));
		connection.window.showErrorMessage(String(error));
	};
	// Editors still send didChange on every keystroke. Coalesce only the expensive
	// REST analysis; requests, saves and closes flush the latest complete buffer.
	const flushChange = (doc: DocumentState): void => {
		if (!doc.pendingChange) return;
		clearTimeout(doc.pendingChange);
		doc.pendingChange = undefined;
		doc.finishPendingAnalysis?.();
		doc.pendingAnalysis = undefined;
		doc.finishPendingAnalysis = undefined;
		const { uri, version, text, generation } = doc;
		void enqueue(async () => {
			if (documents.get(uri) !== doc || doc.version !== version) return;
			await ensureProject();
			if (doc.epoch === undefined) return;
			const result = await rest.request("lsp/document/change", { uri, version, text, sessionId, epoch: doc.epoch });
			if (result.version !== version || !Array.isArray(result.diagnosticsByUri)) throw rpcError("Malformed HISE document/change response");
			if (doc.generation !== generation) return;
			doc.analyzedVersion = version;
			publish(result.diagnosticsByUri, doc, generation);
		}).catch(notifyFailure);
	};
	const flushAllChanges = (): void => {
		for (const doc of documents.values()) flushChange(doc);
	};

	connection.onInitialize(async (params: InitializeParams) => {
		const rootUri = params.rootUri ?? params.workspaceFolders?.[0]?.uri;
		if (!rootUri) throw rpcError("Open a HISE project workspace before starting hise-cli --lsp");
		const root = localPath(rootUri);
		const info = await rest.request("status");
		const folder = (info as RestResult & { project?: { projectFolder?: string } }).project?.projectFolder;
		if (!folder || !info.apiVersion) throw rpcError("HISE has no initialized project (or is in the snippet browser)");
		if (pathKey(root) !== pathKey(resolve(folder))) throw rpcError(`Workspace ${root} does not match HISE project ${folder}`);
		projectRoot = root;
		apiVersion = info.apiVersion;
		completionMarkdown = params.capabilities.textDocument?.completion?.completionItem?.documentationFormat?.includes("markdown") ?? false;
		hoverMarkdown = params.capabilities.textDocument?.hover?.contentFormat?.includes("markdown") ?? false;
		const kinds = params.capabilities.textDocument?.completion?.completionItemKind?.valueSet;
		supportedKinds = kinds ? new Set(kinds) : undefined;
		log(`Connected to HISE API ${apiVersion} for ${root}`);
		return { capabilities: {
			textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Full, save: { includeText: true } },
			completionProvider: { triggerCharacters: ["."] }, hoverProvider: true, definitionProvider: true, referencesProvider: true,
		} };
	});

	connection.onDidOpenTextDocument((params) => {
		const { uri, version, text } = params.textDocument;
		if (documents.has(uri)) { notifyFailure(`Document already open: ${uri}`); return; }
		const doc: DocumentState = { uri, version, text, processors: [], generation: 0 };
		documents.set(uri, doc);
		void enqueue(async () => {
			try {
				await ensureProject();
				if (!within(localPath(uri), projectRoot!)) throw rpcError(`File is outside the active HISE project: ${uri}`);
				const result = await rest.request("lsp/document/open", { uri, version, text, sessionId });
				if (result.epoch === undefined || !Array.isArray(result.processors) || !Array.isArray(result.diagnosticsByUri)) throw rpcError("Malformed HISE document/open response");
				doc.epoch = result.epoch;
				doc.kind = result.documentKind;
				doc.processors = result.processors;
				doc.analyzedVersion = version;
				if (doc.version === version) publish(result.diagnosticsByUri, doc, doc.generation);
				if (doc.processors.length === 0) log(`No processor watches ${uri}`);
			} catch (error) { if (documents.get(uri) === doc) documents.delete(uri); throw error; }
		}).catch(notifyFailure);
	});

	connection.onDidChangeTextDocument((params) => {
		const { uri, version } = params.textDocument;
		const doc = documents.get(uri);
		const change = params.contentChanges;
		if (!doc || version <= doc.version || change.length !== 1 || typeof change[0].text !== "string" || "range" in change[0]) {
			notifyFailure(`Invalid full-text change for ${uri} at version ${version}`); return;
		}
		doc.version = version;
		doc.text = change[0].text;
		++doc.generation;
		if (doc.pendingChange) clearTimeout(doc.pendingChange);
		else doc.pendingAnalysis = new Promise<void>((done) => { doc.finishPendingAnalysis = done; });
		doc.pendingChange = setTimeout(() => flushChange(doc), 200);
	});

	connection.onDidSaveTextDocument((params) => {
		const { uri } = params.textDocument;
		const doc = documents.get(uri);
		if (!doc) return;
		flushChange(doc);
		const version = doc.version;
		const generation = doc.generation;
		void enqueue(async () => {
			await ensureProject();
			if (documents.get(uri) !== doc || doc.epoch === undefined || doc.version !== version) return;
			const result = await rest.request("lsp/document/save", {
				uri, version, sessionId, epoch: doc.epoch,
				...(params.text === undefined ? {} : { text: params.text }),
			});
			if (result.diagnosticsByUri) publish(result.diagnosticsByUri, doc, generation);
		}).catch(notifyFailure);
	});

	connection.onDidCloseTextDocument((params) => {
		const { uri } = params.textDocument;
		const doc = documents.get(uri);
		if (!doc) return;
		// Keep the lease until queued changes finish; close runs on the same lane.
		flushChange(doc);
		void enqueue(async () => {
			try {
				if (doc.epoch !== undefined) await rest.request("lsp/document/close", { uri, epoch: doc.epoch, sessionId });
			} finally {
				if (documents.get(uri) === doc) {
					documents.delete(uri);
					connection.sendDiagnostics({ uri, diagnostics: [] });
				}
			}
		}).catch(notifyFailure);
	});

	async function query<T>(uri: string, route: string, body: object, extract: (result: RestResult) => T): Promise<T> {
		const requested = documents.get(uri);
		const generation = requested?.generation;
		// Completion requests can also arrive on every keystroke. Let the idle
		// timer coalesce them instead of forcing an analysis for each request.
		// Included files can share processor trees. Wait for other open files too.
		while ([...documents.values()].some((doc) => doc.pendingAnalysis)) {
			await Promise.all([...documents.values()].map((doc) => doc.pendingAnalysis).filter((pending): pending is Promise<void> => pending !== undefined));
		}
		await mutations;
		await ensureProject();
		const doc = checked(uri);
		if (doc !== requested || doc.generation !== generation) throw new ResponseError(LSPErrorCodes.RequestCancelled, `Superseded request for ${uri}`);
		if (doc.analyzedVersion !== doc.version) throw rpcError(`HISE has not analyzed version ${doc.version} of ${uri}`);
		if (!doc.processors.length) throw rpcError(`No HISE processor watches ${uri}`);
		const result = await rest.request(`lsp/${route}`, { uri, version: doc.version, epoch: doc.epoch, sessionId, ...body });
		if (documents.get(uri) !== doc || doc.generation !== generation) throw rpcError(`Request superseded by a change to ${uri}`);
		return extract(result);
	}
	connection.onCompletion(async (params, token) => {
		const result = await query(params.textDocument.uri, "completion", { position: params.position, context: params.context }, (r) => r);
		if (token.isCancellationRequested) return null;
		if (!Array.isArray(result.items)) throw rpcError("Malformed HISE completion response");
		const seen = new Set<string>();
		const items = result.items.filter((item) => {
			const key = JSON.stringify([item.label, item.insertText, item.textEdit]);
			if (seen.has(key)) return false;
			seen.add(key); return true;
		}).map((item) => ({
			...item,
			kind: item.kind && supportedKinds && !supportedKinds.has(item.kind) ? 1 : item.kind,
			documentation: !completionMarkdown && item.documentation && typeof item.documentation === "object"
				? item.documentation.value : item.documentation,
		}));
		return { isIncomplete: result.isIncomplete === true, items };
	});
	connection.onHover(async (params, token) => {
		const value = await query(params.textDocument.uri, "hover", { position: params.position }, (r) => r.hover);
		if (token.isCancellationRequested || !value) return null;
		if (!hoverMarkdown && typeof value.contents === "object" && !Array.isArray(value.contents) && "kind" in value.contents) {
			return { ...value, contents: { kind: "plaintext" as const, value: value.contents.value } };
		}
		return value;
	});
	connection.onDefinition(async (params, token) => {
		const value = await query(params.textDocument.uri, "definition", { position: params.position }, (r) => r.locations);
		return token.isCancellationRequested ? null : value ?? null;
	});
	connection.onReferences(async (params, token) => {
		const value = await query(params.textDocument.uri, "references", { position: params.position, context: params.context }, (r) => r.references);
		if (token.isCancellationRequested) return [];
		if (!Array.isArray(value)) throw rpcError("Malformed HISE references response");
		const seen = new Set<string>();
		return value.filter((location) => {
			const key = JSON.stringify([location.uri, location.range]);
			if (seen.has(key)) return false;
			seen.add(key); return true;
		});
	});
	connection.onShutdown(async () => {
		shutdown = true;
		flushAllChanges();
		await enqueue(async () => {
			for (const doc of documents.values()) {
				try {
					if (doc.epoch !== undefined) await rest.request("lsp/document/close", { uri: doc.uri, epoch: doc.epoch, sessionId });
				} catch (error) { log(`Failed to release ${doc.uri}: ${String(error)}`); }
			}
			documents.clear();
		});
	});
	connection.onExit(() => { process.exitCode = shutdown ? 0 : 1; });
	connection.listen();
}

export function parseLspOptions(args: string[]): LspOptions {
	const options: LspOptions = { baseUrl: "http://localhost:1900", timeoutMs: 25000 };
	for (let i = 0; i < args.length; i++) {
		const [flag, inline] = args[i].split("=", 2);
		if (flag === "--hise-url" || flag === "--timeout-ms" || flag === "--log-level") {
			const value = inline ?? args[++i];
			if (!value) throw Error(`Missing value for ${flag}`);
			if (flag === "--hise-url") {
				const url = new URL(value);
				if (!["http:", "https:"].includes(url.protocol)) throw Error("HISE URL must use HTTP(S)");
				options.baseUrl = value;
			} else if (flag === "--timeout-ms") {
				const timeout = Number(value);
				if (!Number.isInteger(timeout) || timeout < 1) throw Error("--timeout-ms must be a positive integer");
				options.timeoutMs = timeout;
			} else {
				if (value !== "quiet" && value !== "normal") throw Error("--log-level must be quiet or normal");
				options.logLevel = value;
			}
		} else throw Error(`Unknown LSP option: ${args[i]}`);
	}
	return options;
}
