import { MockHiseConnection, type HiseConnection, type HiseResponse } from "../engine/hise.js";
import type { TreeNode } from "../engine/result.js";
import { MOCK_BUILDER_TREE } from "./builderTree.js";
import {
	normalizeStatusPayload,
	type StatusPayload,
} from "./contracts/status.js";
import { normalizeReplResponse } from "./contracts/repl.js";
import type { BuilderDiffEntry, BuilderApplyResult } from "./contracts/builder.js";

export interface MockRuntimeProfile {
	kind: "mock";
	connection: HiseConnection;
	builderTree: TreeNode;
	status: StatusPayload;
}

export function createDefaultMockRuntime(): MockRuntimeProfile {
	const builderTree = structuredClone(MOCK_BUILDER_TREE);
	const status = createMockStatusPayload();
	const connection = new MockHiseConnection();

	// Mutable state for undo group tracking
	let inGroup = false;
	let groupName = "";
	const pendingDiff: BuilderDiffEntry[] = [];

	connection.setProbeResult(true);
	connection.onGet("/api/status", () => ({
		success: true,
		result: JSON.stringify(status),
		value: status,
		logs: [],
		errors: [],
	}));
	connection.onPost("/api/repl", (body) => createMockReplResponse(body));

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
		const ops = (body as { ops?: unknown[] })?.ops ?? [];
		const diff = createMockDiffFromOps(ops);
		pendingDiff.push(...diff);

		const applyResult: BuilderApplyResult = {
			scope: inGroup ? "group" : "root",
			groupName: inGroup ? groupName : "",
			diff,
		};

		return {
			success: true,
			result: applyResult,
			logs: [],
			errors: [],
		};
	});

	// Undo group management
	connection.onPost("/api/undo/push_group", (body) => {
		inGroup = true;
		groupName = String((body as { name?: string })?.name ?? "Unnamed");
		pendingDiff.length = 0;
		return envelopeOk("ok");
	});

	connection.onPost("/api/undo/pop_group", () => {
		inGroup = false;
		groupName = "";
		return envelopeOk("ok");
	});

	connection.onGet("/api/undo/diff", () => ({
		success: true,
		result: { diff: [...pendingDiff] },
		logs: [],
		errors: [],
	}));

	connection.onPost("/api/undo/clear", () => {
		pendingDiff.length = 0;
		return envelopeOk("ok");
	});

	return {
		kind: "mock",
		connection,
		builderTree,
		status,
	};
}

function envelopeOk(result: string): HiseResponse {
	return { success: true, result, logs: [], errors: [] };
}

/** Create a minimal raw tree matching HISE's GET /api/builder/tree shape. */
function createMockRawTree(): object {
	return {
		id: "SynthChain",
		processorId: "Master",
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
