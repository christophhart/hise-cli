import { isEnvelopeResponse, isErrorResponse, type HiseResponse } from "../engine/hise.js";
import type { CommandResult } from "../engine/result.js";

export type CliOutputPayload =
	| { ok: true; logs?: string[]; value?: unknown }
	| { ok: false; error: string }
	| { ok: boolean; result: CommandResult };

export function serializeCliOutput(
	mode: string,
	result: CommandResult,
	replResponse?: HiseResponse | null,
): CliOutputPayload {
	if (mode === "script") {
		const serializedScript = serializeScriptOutput(replResponse, result);
		if (serializedScript) {
			return serializedScript;
		}
	}

	return {
		ok: result.type !== "error",
		result: stripAccent(result),
	};
}

function serializeScriptOutput(
	replResponse: HiseResponse | null | undefined,
	result: CommandResult,
): { ok: true; logs?: string[]; value?: unknown } | { ok: false; error: string } | null {
	if (replResponse) {
		if (isErrorResponse(replResponse)) {
			return { ok: false, error: replResponse.message };
		}

		if (!isEnvelopeResponse(replResponse)) {
			return { ok: false, error: "Unexpected response from HISE" };
		}

		if (replResponse.errors.length > 0) {
			return { ok: false, error: formatScriptErrors(replResponse.errors) };
		}

		if (!replResponse.success) {
			return { ok: false, error: replResponse.result || "REPL evaluation failed" };
		}

		const payload: { ok: true; logs?: string[]; value?: unknown } = { ok: true };
		if (replResponse.logs.length > 0) {
			payload.logs = replResponse.logs;
		}
		if (hasMeaningfulValue(replResponse.value)) {
			payload.value = replResponse.value;
		}
		return payload;
	}

	if (result.type === "error") {
		return { ok: false, error: formatCommandError(result) };
	}

	return null;
}

function stripAccent(result: CommandResult): CommandResult {
	const { accent: _accent, ...stripped } = result;
	return stripped as CommandResult;
}

function hasMeaningfulValue(value: unknown): boolean {
	return value !== undefined && value !== null && value !== "undefined";
}

function formatScriptErrors(errors: Array<{ errorMessage: string; callstack: string[] }>): string {
	return errors
		.map((error) => {
			if (error.callstack.length === 0) {
				return error.errorMessage;
			}
			return `${error.errorMessage}\n${error.callstack.join("\n")}`;
		})
		.join("\n");
}

function formatCommandError(result: Extract<CommandResult, { type: "error" }>): string {
	return result.detail
		? `${result.message}\n${result.detail}`
		: result.message;
}
