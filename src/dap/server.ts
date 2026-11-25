import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { createNodeHiseLauncher } from "../tui/nodeHiseLauncher.js";
import { probeHise, projectStatus, resolveProjectTarget, sameProject, verifyProject, waitForHise } from "./projectLaunch.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Readable, Writable } from "node:stream";
import { DapRestClient, DapRestError, type DapRestOptions } from "./rest.js";

export interface DapOptions extends DapRestOptions {
	projectRoot?: string;
	pollMs: number;
	logLevel?: "quiet" | "normal";
	/** Test seam; production uses the existing HISE executable locator. */
	launchHise?: () => Promise<void>;
}

interface Request { seq: number; type: "request"; command: string; arguments?: Record<string, unknown> }
interface Location { uri: string; line: number; column?: number }
interface Breakpoint { breakpointId?: number; sourceUri?: string; uri?: string; line?: number; column?: number; verified?: boolean; message?: string; attachState?: string }
interface Snapshot { moduleId?: string; threadId?: number; state?: string; stoppedGeneration?: number; latestSequence: number; location?: Location }
interface JournalEvent { sequence: number; type: string; reason?: string; breakpoint?: Breakpoint; stoppedGeneration?: number; threadId?: number; output?: string; location?: Location; hitBreakpointIds?: number[] }
interface Journal { events: JournalEvent[]; nextSequence: number; moduleId?: string }
interface BreakpointList { breakpoints: Breakpoint[]; moduleId?: string }

/** A single DAP session owns the stream, HISE lease, poller and identifier tables. */
export class HiseDapServer {
	private readonly rest: DapRestClient;
	private buffer = Buffer.alloc(0);
	private outboundSeq = 1;
	private lane: Promise<void> = Promise.resolve();
	private initialized = false;
	private attached = false;
	private configured = false;
	private closed = false;
	private readonly sessionId = randomUUID();
	private threadId = 1;
	private moduleId?: string;
	private cursor = 0;
	private pollTimer?: ReturnType<typeof setTimeout>;
	private failures = 0;
	private stoppedGeneration?: number;
	private lastReportedGeneration?: number;
	private bufferedStop?: JournalEvent;
	private pathFormat: "path" | "uri" = "path";
	private linesStartAt1 = true;
	private columnsStartAt1 = true;
	private nextBreakpointId = 1;
	private nextFrameId = 1;
	private readonly breakpointIds = new Map<number, number>();
	private readonly breakpointDetails = new Map<number, string>();
	private readonly frameIds = new Map<number, number>();
	private readonly supplied = new Map<string, number[]>();
	private projectFolder?: string;
	private recompiled = false;

	constructor(private readonly options: DapOptions, private readonly input: Readable = process.stdin, private readonly output: Writable = process.stdout) {
		this.rest = new DapRestClient(options);
		input.on("data", (chunk: Buffer) => this.receive(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
		input.on("end", () => { void this.enqueue(() => this.close()); });
		input.on("error", (error) => this.log(String(error)));
	}

	private log(message: string): void {
		if (this.options.logLevel !== "quiet") process.stderr.write(`[hise-dap] ${message}\n`);
	}
	private enqueue(operation: () => Promise<void>): void {
		this.lane = this.lane.then(operation).catch((error: unknown) => this.log(String(error)));
	}
	private send(message: object): void {
		const payload = Buffer.from(JSON.stringify({ seq: this.outboundSeq++, ...message }), "utf8");
		this.output.write(`Content-Length: ${payload.length}\r\n\r\n`);
		this.output.write(payload);
	}
	private event(event: string, body?: object): void { this.send({ type: "event", event, ...(body ? { body } : {}) }); }
	private receive(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) {
				if (this.buffer.length > 8192) this.input.destroy(new Error("DAP header too large"));
				return;
			}
			const header = this.buffer.subarray(0, headerEnd).toString("ascii");
			const length = /^Content-Length:\s*(\d+)\s*$/im.exec(header)?.[1];
			if (!length || Number(length) > 8 * 1024 * 1024) { this.input.destroy(new Error("Invalid DAP Content-Length")); return; }
			const end = headerEnd + 4 + Number(length);
			if (this.buffer.length < end) return;
			const body = this.buffer.subarray(headerEnd + 4, end);
			this.buffer = this.buffer.subarray(end);
			let message: Request;
			try { message = JSON.parse(body.toString("utf8")) as Request; }
			catch { this.input.destroy(new Error("Invalid DAP JSON")); return; }
			if (message.type === "request" && Number.isInteger(message.seq) && typeof message.command === "string") {
				this.enqueue(() => this.handle(message));
			}
		}
	}
	private async handle(request: Request): Promise<void> {
		try {
			const body = await this.dispatch(request.command, request.arguments ?? {});
			this.send({ type: "response", request_seq: request.seq, command: request.command, success: true, body });
			if (request.command === "attach" || request.command === "launch") {
				this.event("initialized");
				try { await this.snapshot(); this.schedulePoll(); }
				catch (error) {
					this.log(String(error));
					this.event("output", { category: "stderr", output: `HISE debugger unavailable: ${String(error)}\n` });
					await this.close();
					this.event("terminated");
				}
			} else if (request.command === "configurationDone") {
				this.configured = true;
				try {
					if (this.bufferedStop) { const stop = this.bufferedStop; this.bufferedStop = undefined; await this.reportStop(stop); }
					if (!this.recompiled && this.moduleId && this.stoppedGeneration === undefined) {
						this.recompiled = true;
						await this.recompile();
					}
				} catch (error) { this.event("output", { category: "stderr", output: `HISE recompile failed: ${String(error)}\n` }); }
			} else if (request.command === "disconnect") {
				this.event("terminated");
				this.input.destroy();
			}
		} catch (error) {
			if (error instanceof DapRestError && error.status === 409 && ["continue", "next", "stepIn", "stepOut", "stackTrace", "evaluate"].includes(request.command)) this.invalidateStop();
			this.send({ type: "response", request_seq: request.seq, command: request.command, success: false, message: String(error), body: { error: { id: 1, format: String(error) } } });
		}
	}
	private source(uri: string): { name: string; path: string } {
		const path = this.pathFormat === "uri" ? uri : fileURLToPath(uri);
		return { name: decodeURIComponent(new URL(uri).pathname.split("/").pop() ?? ""), path };
	}
	private uri(path: string): string {
		const url = this.pathFormat === "uri" ? new URL(path) : pathToFileURL(resolve(path));
		if (url.protocol !== "file:") throw Error(`Unsupported source: ${path}`);
		return url.href;
	}
	private line(value: number): number { return value - (this.linesStartAt1 ? 0 : 1); }
	private column(value: number): number { return value - (this.columnsStartAt1 ? 0 : 1); }
	private restLine(value: number): number { return value + (this.linesStartAt1 ? 0 : 1); }
	private restColumn(value: number): number { return value + (this.columnsStartAt1 ? 0 : 1); }
	private mapped(bp: Breakpoint, fallback?: string): Record<string, unknown> {
		const uri = bp.sourceUri ?? bp.uri ?? fallback;
		const verified = bp.verified === true && (!bp.attachState || bp.attachState === "OK" || bp.attachState === "Duplicate");
		return {
			...(bp.breakpointId === undefined ? {} : { id: this.idFor(bp.breakpointId) }), verified,
			...(uri ? { source: this.source(uri) } : {}),
			...(bp.line === undefined ? {} : { line: this.line(bp.line) }),
			...(bp.column === undefined ? {} : { column: this.column(bp.column) }),
			...(bp.message ? { message: bp.message } : {}),
		};
	}
	private idFor(id: number): number {
		let dap = this.breakpointIds.get(id);
		if (!dap) { dap = this.nextBreakpointId++; this.breakpointIds.set(id, dap); }
		return dap;
	}
	private remember(bp: Breakpoint, fallback?: string): void {
		if (bp.breakpointId !== undefined) this.breakpointDetails.set(bp.breakpointId, JSON.stringify(this.mapped(bp, fallback)));
	}
	private invalidateStop(): void { this.stoppedGeneration = undefined; this.bufferedStop = undefined; this.frameIds.clear(); }
	private requireStop(): number {
		if (this.stoppedGeneration === undefined) throw Error("HISE is not stopped");
		return this.stoppedGeneration;
	}
	private checkThread(args: Record<string, unknown>): void {
		if (args.threadId !== this.threadId) throw Error(`Unknown HISE thread: ${String(args.threadId)}`);
	}
	private async snapshot(): Promise<void> {
		const state = await this.rest.request<Snapshot>("dap/state", undefined, { sessionId: this.sessionId });
		this.cursor = state.latestSequence;
		this.moduleId = state.moduleId;
		this.threadId = state.threadId ?? this.threadId;
		const listed = await this.rest.request<BreakpointList>("dap/breakpoints/list", undefined, { sessionId: this.sessionId });
		const present = new Set<number>();
		for (const bp of listed.breakpoints) {
			if (bp.breakpointId === undefined) continue;
			present.add(bp.breakpointId);
			if (!this.breakpointDetails.has(bp.breakpointId)) this.event("breakpoint", { reason: "new", breakpoint: this.mapped(bp) });
			else if (this.breakpointDetails.get(bp.breakpointId) !== JSON.stringify(this.mapped(bp))) this.event("breakpoint", { reason: "changed", breakpoint: this.mapped(bp) });
			this.remember(bp);
		}
		for (const id of this.breakpointIds.keys()) if (!present.has(id)) {
			this.event("breakpoint", { reason: "removed", breakpoint: { id: this.idFor(id), verified: false } });
			this.breakpointIds.delete(id);
			this.breakpointDetails.delete(id);
		}
		if (state.state === "stopped" && state.stoppedGeneration !== undefined) {
			await this.acceptStop({ sequence: state.latestSequence, type: "stopped", stoppedGeneration: state.stoppedGeneration, reason: "breakpoint", threadId: this.threadId, location: state.location });
		} else {
			const wasStopped = this.stoppedGeneration !== undefined;
			this.invalidateStop();
			if (wasStopped && this.configured) this.event("continued", { threadId: this.threadId, allThreadsContinued: true });
		}
	}
	private async acceptStop(stop: JournalEvent): Promise<void> {
		if (stop.stoppedGeneration === undefined || (this.stoppedGeneration !== undefined && stop.stoppedGeneration < this.stoppedGeneration)) return;
		if (stop.stoppedGeneration !== this.stoppedGeneration) this.frameIds.clear();
		this.stoppedGeneration = stop.stoppedGeneration;
		if (!this.configured) this.bufferedStop = stop;
		else await this.reportStop(stop);
	}
	private async reportStop(stop: JournalEvent): Promise<void> {
		if (stop.stoppedGeneration === this.lastReportedGeneration) return;
		// A stop from an old poll must not be reported after an external resume.
		const state = await this.rest.request<Snapshot>("dap/state", undefined, { sessionId: this.sessionId });
		if (state.state !== "stopped" || state.stoppedGeneration !== stop.stoppedGeneration) {
			if (this.stoppedGeneration === stop.stoppedGeneration) this.invalidateStop();
			return;
		}
		this.lastReportedGeneration = stop.stoppedGeneration;
		this.event("stopped", {
			reason: stop.reason === "step" ? "step" : "breakpoint", threadId: this.threadId, allThreadsStopped: true,
			...(stop.hitBreakpointIds ? { hitBreakpointIds: stop.hitBreakpointIds.map((id) => this.idFor(id)) } : {}),
		});
	}
	private async processEvent(entry: JournalEvent): Promise<void> {
		if (entry.type === "breakpoint" && entry.breakpoint) {
			const bp = entry.breakpoint, id = bp.breakpointId;
			if (id === undefined) return;
			if (entry.reason === "removed") {
				if (this.breakpointIds.has(id)) this.event("breakpoint", { reason: "removed", breakpoint: { id: this.idFor(id), verified: false } });
				this.breakpointIds.delete(id); this.breakpointDetails.delete(id);
			} else {
				const mapped = this.mapped(bp);
				const value = JSON.stringify(mapped);
				if (this.breakpointDetails.get(id) !== value) this.event("breakpoint", { reason: this.breakpointDetails.has(id) ? "changed" : "new", breakpoint: mapped });
				this.breakpointDetails.set(id, value);
			}
		} else if (entry.type === "output") {
			this.event("output", { category: "console", output: entry.output ?? "", ...(entry.location ? { source: this.source(entry.location.uri), line: this.line(entry.location.line), ...(entry.location.column === undefined ? {} : { column: this.column(entry.location.column) }) } : {}) });
		} else if (entry.type === "stopped") await this.acceptStop(entry);
		else if (["continued", "resumed", "resume", "running"].includes(entry.type)) {
			const wasStopped = this.stoppedGeneration !== undefined;
			this.invalidateStop();
			if (wasStopped) this.event("continued", { threadId: this.threadId, allThreadsContinued: true });
		}
	}
	private schedulePoll(delay = this.options.pollMs): void {
		if (this.closed || !this.attached) return;
		this.pollTimer = setTimeout(() => this.enqueue(() => this.poll()), delay);
	}
	private async poll(): Promise<void> {
		if (this.closed || !this.attached) return;
		try {
			const result = await this.rest.request<Journal>("dap/events", undefined, { sessionId: this.sessionId, afterSequence: this.cursor });
			if (result.moduleId) this.moduleId = result.moduleId;
			for (const entry of result.events) {
				if (!Number.isInteger(entry.sequence) || entry.sequence <= this.cursor) throw Error("Out-of-order HISE event journal");
				await this.processEvent(entry);
				this.cursor = entry.sequence;
			}
			if (result.nextSequence !== this.cursor) throw Error("Incomplete HISE event journal");
			this.failures = 0;
		} catch (error) {
			if (error instanceof DapRestError && error.status === 409) {
				try { await this.snapshot(); this.failures = 0; }
				catch (snapshotError) { this.log(String(snapshotError)); this.failures++; }
			} else { this.log(String(error)); this.failures++; }
			if (this.failures === 1) this.event("output", { category: "stderr", output: `HISE debugger unavailable: ${String(error)}\n` });
			if (this.failures >= 5) { await this.close(); this.event("terminated"); return; }
		}
		this.schedulePoll(this.failures ? Math.min(2000, this.options.pollMs * 2 ** this.failures) : undefined);
	}
	private async recompile(): Promise<void> {
		try {
			const result = await this.rest.request<{ errors?: Array<{ errorMessage: string }> }>("recompile", { moduleId: this.moduleId }, undefined, Math.max(35_000, this.options.timeoutMs));
			for (const error of result.errors ?? []) this.event("output", { category: "stderr", output: `${error.errorMessage}\n` });
		} catch (error) {
			if (error instanceof DapRestError && error.status === 400 && error.payload?.result === "breakpoint interrupted compilation") return;
			throw error;
		}
	}
	private async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.pollTimer) clearTimeout(this.pollTimer);
		if (this.attached) {
			try { await this.rest.request("dap/session/close", { sessionId: this.sessionId }); }
			catch (error) { this.log(`Failed to close DAP session: ${String(error)}`); }
		}
		this.attached = false;
		this.invalidateStop();
	}
	private async dispatch(command: string, args: Record<string, unknown>): Promise<object> {
		if (command === "initialize") {
			if (this.initialized) throw Error("Already initialized");
			this.pathFormat = args.pathFormat === "uri" ? "uri" : "path";
			this.linesStartAt1 = args.linesStartAt1 !== false;
			this.columnsStartAt1 = args.columnsStartAt1 !== false;
			this.initialized = true;
			return { supportsConfigurationDoneRequest: true, supportsConditionalBreakpoints: true, supportsEvaluateForHovers: true, supportsTerminateRequest: false, supportsFunctionBreakpoints: false, supportsHitConditionalBreakpoints: false, supportsStepBack: false, supportsSetVariable: false, supportsDataBreakpoints: false, supportsExceptionInfoRequest: false, supportsLogPoints: false, supportsCancelRequest: false };
		}
		if (!this.initialized || this.closed) throw Error("DAP session is not initialized");
		if (command === "attach" || command === "launch") {
			if (this.attached) throw Error("Already attached");
			if (args.moduleId !== undefined && (typeof args.moduleId !== "string" || !args.moduleId)) throw Error("moduleId must be a nonempty string");
			let status;
			if (command === "launch") {
				if (typeof args.projectFile !== "string" || !args.projectFile) throw Error("launch requires an absolute XML/HIP projectFile");
				const target = await resolveProjectTarget(args.projectFile);
				if (this.options.projectRoot && !sameProject(this.options.projectRoot, target.folder)) throw Error(`Workspace ${this.options.projectRoot} does not match ${target.folder}`);
				status = await probeHise(this.rest);
				if (!status) {
					const address = new URL(this.options.baseUrl);
					if (!this.options.launchHise && (!["localhost", "127.0.0.1", "[::1]"].includes(address.hostname) || (address.port && address.port !== "1900"))) throw Error("Automatic HISE launch requires the local REST port 1900; start HISE manually for other addresses");
					await (this.options.launchHise ?? (() => createNodeHiseLauncher().spawnDetached("HISE", ["start_server"])))();
					status = await waitForHise(this.rest, 30_000);
					if (!sameProject(status.project!.projectFolder!, target.folder)) {
						await this.rest.request("project/switch", { project: target.folder }, undefined, 30_000);
						status = await projectStatus(this.rest);
					}
					await this.rest.request("project/load", { file: target.relativeFile }, undefined, 30_000);
					status = await projectStatus(this.rest);
				}
				await verifyProject(this.rest, status, target, typeof args.moduleId === "string" ? args.moduleId : undefined);
			} else {
				status = await projectStatus(this.rest);
				if (typeof args.projectFolder === "string" && !sameProject(args.projectFolder, status.project!.projectFolder!)) throw Error(`HISE project mismatch: expected ${args.projectFolder}, running ${status.project!.projectFolder}`);
			}
			if (this.options.projectRoot && !sameProject(this.options.projectRoot, status.project!.projectFolder!)) throw Error(`Workspace ${this.options.projectRoot} does not match HISE project ${status.project!.projectFolder}`);
			this.projectFolder = status.project!.projectFolder;
			const result = await this.rest.request<{ moduleId?: string; threadId?: number }>("dap/session/open", { sessionId: this.sessionId, ...(typeof args.moduleId === "string" ? { moduleId: args.moduleId } : {}), ...(typeof args.sourceUri === "string" ? { sourceUri: args.sourceUri } : {}) });
			this.attached = true;
			this.moduleId = result.moduleId;
			this.threadId = result.threadId ?? 1;
			return {};
		}
		if (command === "disconnect") { await this.close(); return {}; }
		if (command === "terminate") throw Error("Terminating HISE is not supported; disconnect instead");
		if (!this.attached) throw Error("Attach to HISE first");
		if (command === "configurationDone") {
			if (this.configured) throw Error("Configuration is already complete");
			return {};
		}
		if (command === "threads") return { threads: [{ id: this.threadId, name: "HISE Script Execution" }] };
		if (command === "setBreakpoints") {
			const path = (args.source as { path?: string } | undefined)?.path;
			if (!path) throw Error("setBreakpoints requires a file source path");
			const uri = this.uri(path);
			const submitted = args.breakpoints;
			if (!Array.isArray(submitted)) throw Error("setBreakpoints requires a breakpoints array");
			const requested = submitted.map((bp: { line: number; column?: number; condition?: string; hitCondition?: string; logMessage?: string }) => {
				if (bp.hitCondition !== undefined || bp.logMessage !== undefined) throw Error("Hit conditions and logpoints are not supported");
				if (!Number.isInteger(bp.line) || bp.line < (this.linesStartAt1 ? 1 : 0)) throw Error("Invalid breakpoint line");
				if (bp.column !== undefined && (!Number.isInteger(bp.column) || bp.column < (this.columnsStartAt1 ? 1 : 0))) throw Error("Invalid breakpoint column");
				if (bp.condition !== undefined && typeof bp.condition !== "string") throw Error("Invalid breakpoint condition");
				return { line: this.restLine(bp.line), ...(bp.column === undefined ? {} : { column: this.restColumn(bp.column) }), ...(bp.condition === undefined ? {} : { condition: bp.condition }) };
			});
			const result = await this.rest.request<BreakpointList>("dap/breakpoints/set", { sessionId: this.sessionId, sourceUri: uri, breakpoints: requested });
			if (result.breakpoints.length !== requested.length) throw Error("Malformed HISE breakpoint response");
			const newlyBound = !this.moduleId && !!result.moduleId;
			if (result.moduleId) this.moduleId = result.moduleId;
			const old = new Set(this.supplied.get(uri) ?? []);
			const current: number[] = [];
			for (const bp of result.breakpoints) {
				if (bp.breakpointId !== undefined) { current.push(bp.breakpointId); this.remember(bp, uri); old.delete(bp.breakpointId); }
			}
			this.supplied.set(uri, current);
			for (const id of old) { this.breakpointIds.delete(id); this.breakpointDetails.delete(id); }
			if (newlyBound) await this.snapshot();
			return { breakpoints: result.breakpoints.map((bp) => this.mapped(bp, uri)) };
		}
		if (command === "continue" || command === "next" || command === "stepIn" || command === "stepOut") {
			this.checkThread(args);
			const generation = this.requireStop();
			await this.rest.request(command === "continue" ? "dap/continue" : "dap/step", { sessionId: this.sessionId, threadId: this.threadId, stoppedGeneration: generation, ...(command === "continue" ? {} : { kind: command }) });
			this.invalidateStop();
			return command === "continue" ? { allThreadsContinued: true } : {};
		}
		if (command === "stackTrace") {
			this.checkThread(args);
			const generation = this.requireStop();
			const result = await this.rest.request<{ frames: Array<{ frameId: number; name: string; uri?: string; line?: number; column?: number }> }>("dap/stackTrace", { sessionId: this.sessionId, threadId: this.threadId, stoppedGeneration: generation });
			if (this.stoppedGeneration !== generation) throw Error("Stale stack trace");
			const frames = result.frames.map((frame) => {
				let id = [...this.frameIds].find(([, restId]) => restId === frame.frameId)?.[0];
				if (!id) { id = this.nextFrameId++; this.frameIds.set(id, frame.frameId); }
				return { id, name: frame.name, ...(frame.uri ? { source: this.source(frame.uri) } : {}), line: this.line(frame.line ?? 1), column: this.column(frame.column ?? 1) };
			});
			const start = typeof args.startFrame === "number" ? args.startFrame : 0;
			const count = typeof args.levels === "number" && args.levels > 0 ? args.levels : frames.length;
			return { stackFrames: frames.slice(start, start + count), totalFrames: frames.length };
		}
		if (command === "evaluate") {
			const generation = this.requireStop();
			if (args.frameId !== undefined && !this.frameIds.has(Number(args.frameId))) throw Error("Unknown or stale frame ID");
			const context = args.context ?? "repl";
			if (context !== "repl" && context !== "hover") throw Error("Only REPL and hover evaluation are supported");
			if (typeof args.expression !== "string") throw Error("Missing expression");
			const result = await this.rest.request<{ result: string; error?: string }>("dap/evaluate", { sessionId: this.sessionId, expression: args.expression, context, ...(args.frameId === undefined ? {} : { frameId: this.frameIds.get(Number(args.frameId)) }), stoppedGeneration: generation });
			if (this.stoppedGeneration !== generation) throw Error("Stale evaluation");
			return { result: result.error ? `${result.result}${result.result ? "\n" : ""}${result.error}` : result.result, variablesReference: 0 };
		}
		if (command === "scopes" || command === "variables") throw Error("HISE variable inspection is not implemented");
		throw Error(`Unsupported DAP request: ${command}`);
	}
}

export function startDap(options: DapOptions, input?: Readable, output?: Writable): HiseDapServer {
	return new HiseDapServer(options, input, output);
}

export function parseDapOptions(args: string[]): DapOptions {
	const options: DapOptions = { baseUrl: "http://localhost:1900", timeoutMs: 5000, pollMs: 75 };
	for (let i = 0; i < args.length; i++) {
		const [flag, inline] = args[i].split("=", 2);
		if (!["--hise-url", "--timeout-ms", "--poll-ms", "--log-level", "--project-root"].includes(flag)) throw Error(`Unknown DAP option: ${args[i]}`);
		const value = inline ?? args[++i];
		if (!value) throw Error(`Missing value for ${flag}`);
		if (flag === "--hise-url") {
			const url = new URL(value);
			if (!["http:", "https:"].includes(url.protocol)) throw Error("HISE URL must use HTTP(S)");
			options.baseUrl = value;
		} else if (flag === "--log-level") {
			if (value !== "quiet" && value !== "normal") throw Error("Invalid log level");
			options.logLevel = value;
		} else if (flag === "--project-root") options.projectRoot = value;
		else {
			const number = Number(value);
			if (!Number.isInteger(number) || number < 1 || number > 60000) throw Error(`${flag} must be between 1 and 60000`);
			if (flag === "--poll-ms") options.pollMs = number;
			else options.timeoutMs = number;
		}
	}
	return options;
}
