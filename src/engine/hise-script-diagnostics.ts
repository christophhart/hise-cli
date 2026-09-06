import type { HiseConnection, HiseResponse } from "./hise.js";
import { isEnvelopeResponse, isErrorResponse } from "./hise.js";

export interface HiseScriptDiagnostic {
	line: number;
	column: number;
	severity: string;
	source: string;
	message: string;
	suggestions: string[];
}

export interface DiagnoseHiseScriptCodeOptions {
	moduleId?: string;
}

/** Diagnose in-memory HiseScript without compiling, executing, or writing it. */
export async function diagnoseHiseScriptCode(
	connection: HiseConnection,
	code: string,
	options: DiagnoseHiseScriptCodeOptions = {},
): Promise<HiseScriptDiagnostic[]> {
	if (!code.trim()) throw new Error("Cannot diagnose empty HiseScript code");
	const body: Record<string, unknown> = { code };
	if (options.moduleId) body.moduleId = options.moduleId;
	const response = await connection.post("/api/diagnose_script", body);
	assertSuccessfulDiagnosis(response);
	const diagnostics = (response as Record<string, unknown>).diagnostics;
	if (!Array.isArray(diagnostics)) throw new Error("HISE diagnose_script returned no diagnostics array");
	return diagnostics.map(normalizeDiagnostic);
}

function assertSuccessfulDiagnosis(response: HiseResponse): void {
	if (isErrorResponse(response)) throw new Error(`HISE diagnose_script failed: ${response.message}`);
	if (!isEnvelopeResponse(response)) throw new Error("HISE diagnose_script returned a malformed response");
	if (response.success) return;
	const errors = response.errors.map((error) => error.errorMessage).filter(Boolean);
	const fallback = typeof response.result === "string" ? response.result : "unknown error";
	throw new Error(`HISE diagnose_script failed: ${errors.join("; ") || fallback}`);
}

function normalizeDiagnostic(value: unknown, index: number): HiseScriptDiagnostic {
	if (!value || typeof value !== "object") throw new Error(`HISE diagnose_script returned malformed diagnostic ${index}`);
	const diagnostic = value as Record<string, unknown>;
	if (typeof diagnostic.message !== "string") throw new Error(`HISE diagnose_script returned malformed diagnostic ${index}`);
	return {
		line: typeof diagnostic.line === "number" ? diagnostic.line : 0,
		column: typeof diagnostic.column === "number" ? diagnostic.column : 0,
		severity: typeof diagnostic.severity === "string" ? diagnostic.severity : "error",
		source: typeof diagnostic.source === "string" ? diagnostic.source : "hise",
		message: diagnostic.message,
		suggestions: Array.isArray(diagnostic.suggestions)
			? diagnostic.suggestions.filter((item): item is string => typeof item === "string")
			: [],
	};
}
