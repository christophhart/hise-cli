import { MockHiseConnection, type HiseConnection, type HiseResponse } from "../engine/hise.js";
import type { TreeNode } from "../engine/result.js";
import { DUMMY_MODULE_TREE } from "../engine/modes/dummyTree.js";
import {
	normalizeStatusPayload,
	type StatusPayload,
} from "./contracts/status.js";
import { normalizeReplResponse } from "./contracts/repl.js";

export interface MockRuntimeProfile {
	kind: "mock";
	connection: HiseConnection;
	builderTree: TreeNode;
	status: StatusPayload;
}

export function createDefaultMockRuntime(): MockRuntimeProfile {
	const builderTree = structuredClone(DUMMY_MODULE_TREE);
	const status = createMockStatusPayload(builderTree);
	const connection = new MockHiseConnection();
	connection.setProbeResult(true);
	connection.onGet("/api/status", () => ({
		success: true,
		result: JSON.stringify(status),
		value: status,
		logs: [],
		errors: [],
	}));
	connection.onPost("/api/repl", (body) => createMockReplResponse(body));

	return {
		kind: "mock",
		connection,
		builderTree,
		status,
	};
}

export function createMockStatusPayload(builderTree: TreeNode): StatusPayload {
	void builderTree;
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
