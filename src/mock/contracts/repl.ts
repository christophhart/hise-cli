import type { HiseResponse, HiseSuccessResponse } from "../../engine/hise.js";

export interface NormalizedReplSuccess {
	kind: "success";
	result: string;
	value?: unknown;
	moduleId?: string;
	logs: string[];
	errors: Array<{ errorMessage: string; callstack: string[] }>;
}

export interface NormalizedReplError {
	kind: "error";
	message: string;
}

export type NormalizedReplResponse = NormalizedReplSuccess | NormalizedReplError;

export function normalizeReplResponse(response: HiseResponse): NormalizedReplResponse {
	if ("error" in response && response.error === true) {
		if (typeof response.message !== "string") {
			throw new Error("REPL error response message must be a string");
		}
		return {
			kind: "error",
			message: response.message,
		};
	}

	return normalizeReplSuccess(response as HiseSuccessResponse);
}

export function normalizeReplSuccess(response: HiseSuccessResponse): NormalizedReplSuccess {
	if (response.success !== true) {
		throw new Error("REPL success response success flag must be true");
	}
	if (typeof response.result !== "string") {
		throw new Error("REPL success response result must be a string");
	}
	if (response.moduleId !== undefined && typeof response.moduleId !== "string") {
		throw new Error("REPL success response moduleId must be a string when present");
	}
	if (!Array.isArray(response.logs) || response.logs.some((item) => typeof item !== "string")) {
		throw new Error("REPL success response logs must be a string array");
	}
	if (!Array.isArray(response.errors)) {
		throw new Error("REPL success response errors must be an array");
	}

	return {
		kind: "success",
		result: response.result,
		value: response.value,
		moduleId: response.moduleId,
		logs: response.logs,
		errors: response.errors.map((error) => ({
			errorMessage: String(error.errorMessage),
			callstack: Array.isArray(error.callstack) ? error.callstack.map(String) : [],
		})),
	};
}
