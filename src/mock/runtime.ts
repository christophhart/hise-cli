import { MockHiseConnection, type HiseConnection, type HiseResponse } from "../engine/hise.js";
import type { TreeNode } from "../engine/result.js";
import { MOCK_BUILDER_TREE } from "./builderTree.js";
import { MOCK_COMPONENT_TREE, type RawComponentNode } from "./componentTree.js";
import {
	normalizeStatusPayload,
	type StatusPayload,
} from "./contracts/status.js";
import { normalizeReplResponse } from "./contracts/repl.js";
import type { BuilderDiffEntry, BuilderApplyResult } from "./contracts/builder.js";
import type { DiffEntry } from "./contracts/builder.js";
import { installDspMock } from "./dspMock.js";
import { createMockProjectState, type MockProjectState } from "./projectFixtures.js";
import { installProjectMock } from "./projectMock.js";

export interface MockRuntimeProfile {
	kind: "mock";
	connection: HiseConnection;
	builderTree: TreeNode;
	status: StatusPayload;
	project: MockProjectState;
}

export function createDefaultMockRuntime(): MockRuntimeProfile {
	const builderTree = structuredClone(MOCK_BUILDER_TREE);
	const status = createMockStatusPayload();
	const connection = new MockHiseConnection();

	// Mutable state for undo group tracking
	let inGroup = false;
	let groupName = "";
	const pendingDiff: BuilderDiffEntry[] = [];
	const scriptCallbacks = new Map<string, Record<string, string>>([
		["Interface", {
			onInit: "",
			onNoteOn: "",
			onNoteOff: "",
		}],
	]);

	connection.setProbeResult(true);
	connection.onGet("/api/status", () => ({
		success: true,
		server: status.server,
		project: status.project,
		scriptProcessors: status.scriptProcessors,
		logs: [],
		errors: [],
	}));
	connection.onPost("/api/repl", (body) => createMockReplResponse(body));
	connection.onPost("/api/set_script", (body) => {
		const moduleId = String((body as { moduleId?: string } | undefined)?.moduleId ?? "Interface");
		const callbacks = ((body as { callbacks?: Record<string, string> } | undefined)?.callbacks ?? {});
		const current = scriptCallbacks.get(moduleId) ?? {};
		for (const [callbackId, source] of Object.entries(callbacks)) {
			current[callbackId] = source;
		}
		scriptCallbacks.set(moduleId, current);
		return {
			success: true,
			moduleId,
			updatedCallbacks: Object.keys(callbacks),
			result: "Compiled OK",
			forceSynchronousExecution: false,
			externalFiles: [],
			logs: [],
			errors: [],
		};
	});
	connection.onPost("/api/recompile", () => ({
		success: true,
		result: "Recompiled OK",
		forceSynchronousExecution: false,
		externalFiles: [],
		logs: [],
		errors: [],
	}));

	// Builder tree - return a raw-like tree object in the envelope.
	// The actual raw->TreeNode normalization happens in the consumer.
	connection.onGet("/api/builder/tree", () => ({
		success: true,
		result: createMockRawTree(),
		logs: [],
		errors: [],
	}));

	// Builder apply - accepts ops, returns diff scoped to current undo context
	connection.onPost("/api/builder/apply", (body) => {
		const ops = (body as { operations?: unknown[] })?.operations ?? [];
		const diff = createMockDiffFromOps(ops);
		pendingDiff.push(...diff);

		const applyResult: BuilderApplyResult = {
			scope: inGroup ? "group" : "root",
			groupName: inGroup ? groupName : "",
			diff,
		};

		return {
			success: true,
			scope: applyResult.scope,
			groupName: applyResult.groupName,
			diff: applyResult.diff,
			logs: [],
			errors: [],
		};
	});

	// Undo group management
	let historyCursor = -1;
	const historyEntries: Array<{ name: string; count: number }> = [];

	connection.onPost("/api/undo/push_group", (body) => {
		inGroup = true;
		groupName = String((body as { name?: string })?.name ?? "Unnamed");
		pendingDiff.length = 0;
		return envelopeDiff(groupName, []);
	});

	connection.onPost("/api/undo/pop_group", (body) => {
		const cancel = (body as { cancel?: boolean })?.cancel ?? false;
		const prevGroup = groupName;
		inGroup = false;
		groupName = "";
		if (cancel) {
			pendingDiff.length = 0;
			return envelopeDiff("root", []);
		}
		// Apply: collapse into a single history entry
		if (pendingDiff.length > 0) {
			historyEntries.push({ name: prevGroup, count: pendingDiff.length });
			historyCursor = historyEntries.length - 1;
		}
		return envelopeDiff("root", [...pendingDiff]);
	});

	connection.onPost("/api/undo/back", () => {
		if (historyCursor < 0) {
			return { success: false, result: null, logs: [], errors: [{ errorMessage: "nothing to undo", callstack: [] }] };
		}
		historyCursor--;
		return envelopeDiff(inGroup ? groupName : "root", [...pendingDiff]);
	});

	connection.onPost("/api/undo/forward", () => {
		if (historyCursor >= historyEntries.length - 1) {
			return { success: false, result: null, logs: [], errors: [{ errorMessage: "nothing to redo", callstack: [] }] };
		}
		historyCursor++;
		return envelopeDiff(inGroup ? groupName : "root", [...pendingDiff]);
	});

	connection.onGet("/api/undo/diff", () => ({
		success: true,
		scope: "group",
		groupName: inGroup ? groupName : "root",
		diff: [...pendingDiff],
		logs: [],
		errors: [],
	}));

	connection.onGet("/api/undo/history", () => ({
		success: true,
		scope: "group",
		groupName: inGroup ? groupName : "root",
		cursor: historyCursor,
		history: historyEntries.map((e, i) => ({
			index: i,
			type: "group",
			name: e.name,
			count: e.count,
		})),
		logs: [],
		errors: [],
	}));

	connection.onPost("/api/undo/clear", () => {
		pendingDiff.length = 0;
		historyEntries.length = 0;
		historyCursor = -1;
		inGroup = false;
		groupName = "";
		return envelopeDiff("root", []);
	});

	// ── UI component endpoints ──────────────────────────────────────

	const componentTree: RawComponentNode = structuredClone(MOCK_COMPONENT_TREE);
	const uiDiff: DiffEntry[] = [];

	connection.onGet("/api/ui/tree", () => ({
		success: true,
		result: componentTree,
		logs: [],
		errors: [],
	}));

	connection.onPost("/api/ui/apply", (body) => {
		const ops = (body as { operations?: unknown[] })?.operations ?? [];
		const diff = createMockUiDiffFromOps(ops);
		uiDiff.push(...diff);
		pendingDiff.push(...diff);

		return {
			success: true,
			scope: inGroup ? "group" : "root",
			groupName: inGroup ? groupName : "root",
			diff: [...uiDiff],
			logs: diff.map(d => {
				const verb = d.action === "+" ? "Add" : d.action === "-" ? "Remove" : "Set properties on";
				return `${verb} ${d.target}`;
			}),
			errors: [],
		};
	});

	// ── DSP endpoints ───────────────────────────────────────────────
	installDspMock(connection, {
		inGroup: () => inGroup,
		groupName: () => groupName,
		pushDiff: (entries) => {
			pendingDiff.push(...entries);
		},
	});

	// ── Project endpoints ───────────────────────────────────────────
	const project = createMockProjectState();
	installProjectMock(connection, project, status);

	return {
		kind: "mock",
		connection,
		builderTree,
		status,
		project,
	};
}

function envelopeOk(result: string): HiseResponse {
	return { success: true, result, logs: [], errors: [] };
}

function envelopeDiff(groupName: string, diff: BuilderDiffEntry[]): HiseResponse {
	return {
		success: true,
		scope: "group",
		groupName,
		diff,
		logs: [],
		errors: [],
	};
}

/** Create a minimal raw tree matching HISE's GET /api/builder/tree shape. */
function createMockRawTree(): object {
	return {
		id: "SynthChain",
		processorId: "Master Chain",
		prettyName: "Container",
		type: "SoundGenerator",
		subtype: "SoundGenerator",
		category: ["container"],
		hasChildren: true,
		hasFX: true,
		constrainer: "*",
		fx_constrainer: "MasterEffect|MonophonicEffect|PolyphonicFilter",
		bypassed: false,
		colour: "#414141",
		modulation: [
			{
				chainIndex: 1, id: "Gain Modulation", disabled: false,
				constrainer: "TimeVariantModulator", modulationMode: "gain",
				colour: "#BE952C", children: [],
			},
		],
		parameters: [],
		midi: [],
		fx: [
			{
				id: "SimpleGain", processorId: "Output", prettyName: "Simple Gain",
				type: "Effect", subtype: "MasterEffect", category: [],
				hasChildren: false, hasFX: false, bypassed: false,
				colour: "#3A6666", modulation: [], parameters: [],
			},
		],
		children: [
			{
				id: "SineSynth", processorId: "Osc 1", prettyName: "Sine Synthesiser",
				type: "SoundGenerator", subtype: "SoundGenerator", category: ["oscillator"],
				hasChildren: false, hasFX: false, bypassed: false,
				colour: "#414141", modulation: [], parameters: [],
			},
		],
	};
}

/** Derive mock diff entries from builder ops. */
function createMockDiffFromOps(ops: unknown[]): BuilderDiffEntry[] {
	const diff: BuilderDiffEntry[] = [];
	for (const op of ops) {
		if (!op || typeof op !== "object") continue;
		const { type, target, parent } = op as Record<string, unknown>;
		if (type === "add" && typeof target === "string") {
			diff.push({ domain: "builder", action: "+", target });
		} else if (type === "remove" && typeof target === "string") {
			diff.push({ domain: "builder", action: "-", target });
		} else if (typeof target === "string" || typeof parent === "string") {
			diff.push({ domain: "builder", action: "*", target: String(target ?? parent) });
		}
	}
	return diff;
}

export function createMockStatusPayload(): StatusPayload {
	return normalizeStatusPayload({
		server: {
			version: "4.1.0-mock",
			compileTimeout: "20.0",
			buildCommit: "0000000000000000000000000000000000000000",
		},
		project: {
			name: "Mock Project",
			projectFolder: "/mock/project",
			scriptsFolder: "/mock/project/Scripts",
		},
		scriptProcessors: [
			{
				moduleId: "Interface",
				isMainInterface: true,
				externalFiles: [],
				callbacks: [
					{ id: "onInit", empty: false },
					{ id: "onNoteOn", empty: true },
					{ id: "onNoteOff", empty: true },
				],
			},
		],
	});
}

export function createMockReplResponse(body?: object): HiseResponse {
	const expression = String((body as { expression?: string } | undefined)?.expression ?? "").trim();
	const moduleId = String((body as { moduleId?: string } | undefined)?.moduleId ?? "Interface");

	const response = expression === "Engine.getSampleRate()"
		? successResponse(48000, moduleId)
		: matchConsolePrint(expression, moduleId)
			?? (expression === "someErrorStuff()"
				? replFailureResponse("Error at REPL Evaluation", "This expression is not a function!", moduleId, [
					"eval() at Interface.js:1:1",
				])
				: null)
			?? (expression === 'Content.getComponent("x")'
				? scriptErrorResponse("Component with name x wasn't found.", moduleId)
				: successResponse("undefined", moduleId));

	normalizeReplResponse(response);
	return response;
}

function matchConsolePrint(expression: string, moduleId: string): HiseResponse | null {
	const match = expression.match(/^Console\.print\((.*)\)$/s);
	if (!match) return null;

	const inner = match[1]!.trim();
	const scalar = parseScalarLiteral(inner);
	return {
		success: true,
		result: "ok",
		value: "undefined",
		moduleId,
		logs: [formatLogLiteral(scalar)],
		errors: [],
	};
}

function successResponse(value: unknown, moduleId: string): HiseResponse {
	return {
		success: true,
		result: "ok",
		value,
		moduleId,
		logs: [],
		errors: [],
	};
}

function scriptErrorResponse(message: string, moduleId: string): HiseResponse {
	return {
		success: true,
		result: "ok",
		moduleId,
		logs: [],
		errors: [{ errorMessage: message, callstack: [] }],
	};
}

function replFailureResponse(
	result: string,
	message: string,
	moduleId: string,
	callstack: string[] = [],
): HiseResponse {
	return {
		success: false,
		result,
		value: "undefined",
		moduleId,
		logs: [],
		errors: [{ errorMessage: message, callstack }],
	};
}

function parseScalarLiteral(value: string): unknown {
	if (/^[-+]?\d+(\.\d+)?$/.test(value)) {
		return Number(value);
	}
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	return "undefined";
}

function formatLogLiteral(value: unknown): string {
	if (typeof value === "number") {
		return Number.isInteger(value) ? String(value) : value.toFixed(1);
	}
	if (typeof value === "string") return value;
	if (typeof value === "boolean") return String(value);
	if (value === null) return "null";
	return "undefined";
}

/** Derive mock diff entries from UI apply ops. */
function createMockUiDiffFromOps(ops: unknown[]): DiffEntry[] {
	const diff: DiffEntry[] = [];
	for (const op of ops) {
		if (!op || typeof op !== "object") continue;
		const o = op as Record<string, unknown>;
		const opType = o.op as string | undefined;
		if (opType === "add" && typeof o.id === "string") {
			diff.push({ domain: "ui", action: "+", target: o.id });
		} else if (opType === "remove" && typeof o.target === "string") {
			diff.push({ domain: "ui", action: "-", target: o.target });
		} else if (typeof o.target === "string") {
			diff.push({ domain: "ui", action: "*", target: o.target });
		}
	}
	return diff;
}
