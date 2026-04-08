import { type HiseConnection, isErrorResponse } from "../engine/hise.js";

// ── Types ──────────────────────────────────────────────────────────

export interface HiseDiagnostic {
	line: number;
	column: number;
	severity: string;
	source: string;
	message: string;
	suggestions?: string[];
}

export type DiagnoseResult =
	| { ok: boolean; file: string; diagnostics: HiseDiagnostic[] }
	| { ok: true; diagnostics: []; warning: string }
	| { ok: false; error: string };

export interface DiagnoseFlags {
	format: "json" | "pretty";
	errorsOnly: boolean;
}

export function parseDiagnoseFlags(args: string[]): { filePath: string | null; flags: DiagnoseFlags } {
	let filePath: string | null = null;
	const flags: DiagnoseFlags = { format: "json", errorsOnly: false };

	for (const arg of args) {
		if (arg === "--format=pretty") flags.format = "pretty";
		else if (arg === "--format=json") flags.format = "json";
		else if (arg === "--errors-only") flags.errorsOnly = true;
		else if (!arg.startsWith("-")) filePath ??= arg;
	}

	return { filePath, flags };
}

// ── Pretty formatter ───────────────────────────────────────────────

export function formatDiagnoseOutput(result: DiagnoseResult, flags: DiagnoseFlags): string {
	if ("error" in result && result.error) {
		return result.error;
	}

	if ("warning" in result && result.warning) {
		return result.warning;
	}

	if (!("diagnostics" in result)) return "";

	let diagnostics = result.diagnostics;
	if (flags.errorsOnly) {
		diagnostics = diagnostics.filter((d) => d.severity === "error");
	}

	if (diagnostics.length === 0) return "";

	const fullPath = "file" in result ? result.file : "unknown";
	const file = fullPath.split("/").pop() ?? fullPath;
	const lines = diagnostics.map((d) => {
		let line = `${file}:${d.line}:${d.column}: ${d.severity}: ${d.message}`;
		if (d.suggestions?.length) {
			line += ` (did you mean: ${d.suggestions.join(", ")}?)`;
		}
		return line;
	});

	return lines.join("\n");
}

// ── Executor ───────────────────────────────────────────────────────

export async function executeDiagnose(
	absolutePath: string,
	connection: HiseConnection,
): Promise<DiagnoseResult> {
	// Fetch project info and included files in parallel
	const [statusRes, filesRes] = await Promise.all([
		connection.get("/api/status"),
		connection.get("/api/get_included_files"),
	]);

	if (isErrorResponse(statusRes)) {
		return { ok: false, error: statusRes.message };
	}
	if (isErrorResponse(filesRes)) {
		return { ok: false, error: filesRes.message };
	}

	const status = statusRes as unknown as {
		success: boolean;
		project: { scriptsFolder: string };
	};
	const files = filesRes as unknown as {
		success: boolean;
		files: Array<{ path: string; processor: string }>;
	};

	if (!status.success || !files.success) {
		return { ok: false, error: "Failed to query HISE project info" };
	}

	const scriptsFolder = status.project.scriptsFolder;
	const normalizedInput = absolutePath.replace(/\\/g, "/");
	const normalizedScripts = scriptsFolder.replace(/\\/g, "/");

	// File outside the scripts folder — not a HISE script, skip silently
	if (!normalizedInput.startsWith(normalizedScripts)) {
		return { ok: true, file: absolutePath, diagnostics: [] };
	}

	// Check if file is included (compiled at least once)
	const isIncluded = files.files.some(
		(f) => f.path.replace(/\\/g, "/") === normalizedInput,
	);

	if (!isIncluded) {
		return {
			ok: true,
			diagnostics: [],
			warning:
				"Diagnostics not available \u2014 include this file in a ScriptProcessor and compile at least once to enable shadow parser diagnostics",
		};
	}

	// Compute relative path from scripts folder
	const relativePath = normalizedInput
		.slice(normalizedScripts.length)
		.replace(/^\//, "");

	const diagnoseRes = await connection.post("/api/diagnose_script", {
		filePath: relativePath,
	});

	if (isErrorResponse(diagnoseRes)) {
		return { ok: false, error: diagnoseRes.message };
	}

	const body = diagnoseRes as unknown as {
		success: boolean;
		diagnostics?: HiseDiagnostic[];
		errors?: Array<{ errorMessage: string }>;
	};

	if (!body.success) {
		const msg = body.errors?.[0]?.errorMessage ?? "diagnose_script failed";
		return { ok: false, error: msg };
	}

	const diagnostics = body.diagnostics ?? [];
	const hasErrors = diagnostics.some((d) => d.severity === "error");

	return {
		ok: !hasErrors,
		file: absolutePath,
		diagnostics,
	};
}
