import { type HiseConnection, isErrorResponse } from "../engine/hise.js";
import { diagnoseHiseScriptCode } from "../engine/hise-script-diagnostics.js";

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
	| { ok: boolean; diagnostics: HiseDiagnostic[] }
	| { ok: false; error: string };

export interface DiagnoseFlags {
	format: "json" | "pretty";
	errorsOnly: boolean;
	code: string | null;
}

export function parseDiagnoseFlags(args: string[]): { filePath: string | null; flags: DiagnoseFlags } {
	let filePath: string | null = null;
	let code: string | null = null;
	const flags: DiagnoseFlags = { format: "json", errorsOnly: false, code: null };

	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		if (arg === "--format=pretty") flags.format = "pretty";
		else if (arg === "--format=json") flags.format = "json";
		else if (arg === "--errors-only") flags.errorsOnly = true;
		else if (arg === "--code") code = args[++i] ?? "";
		else if (arg.startsWith("--code=")) code = arg.slice("--code=".length);
		else if (!arg.startsWith("-")) filePath ??= arg;
	}
	flags.code = code;
	return { filePath, flags };
}

export async function executeDiagnoseCode(code: string, connection: HiseConnection): Promise<DiagnoseResult> {
	try {
		const diagnostics = await diagnoseHiseScriptCode(connection, code);
		return { ok: !diagnostics.some((d) => d.severity === "error"), diagnostics };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

// ── Pretty formatter ───────────────────────────────────────────────

export function formatDiagnoseOutput(result: DiagnoseResult, flags: DiagnoseFlags): string {
	if ("error" in result && result.error) {
		return result.error;
	}

	if (!("diagnostics" in result)) return "";

	let diagnostics = result.diagnostics;
	if (flags.errorsOnly) {
		diagnostics = diagnostics.filter((d) => d.severity === "error");
	}

	if (diagnostics.length === 0) return "";

	const fullPath = "file" in result ? result.file : "unknown";
	const file = fullPath.replace(/\\/g, "/").split("/").pop() ?? fullPath;
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

interface ResolvedDiagnosticPath {
	relativePath: string;
}

function resolveIncludedScriptPath(
	input: string,
	projectFolderInput: string,
	scriptsFolderInput: string,
	includedFiles: Array<{ path: string; processor: string }>,
): ResolvedDiagnosticPath | { error: string } {
	const projectFolder = normalizePath(projectFolderInput);
	const scriptsFolder = normalizePath(scriptsFolderInput);
	const windowsPaths = /^[A-Za-z]:\//.test(scriptsFolder);
	const compare = (value: string) => windowsPaths ? value.toLowerCase() : value;
	const scriptsRelative = relativePathFrom(projectFolder, scriptsFolder, compare);
	const normalizedInput = normalizePath(input);
	const inputCandidates = isAbsolutePath(normalizedInput)
		? [normalizedInput]
		: [joinPath(scriptsFolder, normalizedInput), joinPath(projectFolder, normalizedInput)];

	const included = new Map<string, string>();
	for (const entry of includedFiles) {
		const listedPath = normalizePath(entry.path);
		let absolutePath: string;
		if (isAbsolutePath(listedPath)) {
			absolutePath = listedPath;
		} else if (scriptsRelative && isPathWithin(listedPath, scriptsRelative, compare)) {
			absolutePath = joinPath(projectFolder, listedPath);
		} else {
			absolutePath = joinPath(scriptsFolder, listedPath);
		}
		const key = compare(absolutePath);
		const relativePath = relativePathFrom(scriptsFolder, absolutePath, compare);
		if (relativePath !== null) included.set(key, relativePath);
	}

	const matches = new Map<string, string>();
	for (const candidate of inputCandidates) {
		const key = compare(candidate);
		const relativePath = included.get(key);
		if (relativePath !== undefined) matches.set(key, relativePath);
	}
	if (matches.size === 0) {
		return {
			error: `No included HiseScript file matches "${input}". Use an absolute path, a path relative to the Scripts folder, or a path relative to the project folder; the file must be included in a ScriptProcessor.`,
		};
	}
	if (matches.size > 1) {
		const paths = [...matches.keys()].join(", ");
		return { error: `Path "${input}" matches multiple included files (${paths}). Use an absolute path to disambiguate.` };
	}
	return { relativePath: matches.values().next().value! };
}

function normalizePath(value: string): string {
	const slashed = value.replace(/\\/g, "/");
	const drive = slashed.match(/^([A-Za-z]:)(?:\/|$)/)?.[1];
	const rooted = Boolean(drive) || slashed.startsWith("/");
	const root = drive ? `${drive}/` : slashed.startsWith("/") ? "/" : "";
	const rest = drive ? slashed.slice(drive.length + (slashed[drive.length] === "/" ? 1 : 0)) : slashed.replace(/^\/+/, "");
	const parts: string[] = [];
	for (const part of rest.split("/")) {
		if (!part || part === ".") continue;
		if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
		else if (part !== ".." || !rooted) parts.push(part);
	}
	return root + parts.join("/") || (rooted ? root : ".");
}

function isAbsolutePath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:\//.test(value);
}

function joinPath(base: string, path: string): string {
	return isAbsolutePath(path) ? normalizePath(path) : normalizePath(`${base}/${path}`);
}

function isPathWithin(path: string, root: string, compare: (value: string) => string): boolean {
	const child = compare(normalizePath(path));
	const parent = compare(normalizePath(root)).replace(/\/+$/, "");
	return child === parent || child.startsWith(`${parent}/`);
}

function relativePathFrom(from: string, to: string, compare: (value: string) => string): string | null {
	const fromPath = normalizePath(from);
	const toPath = normalizePath(to);
	const rootOf = (value: string) => value.match(/^([A-Za-z]:)\//)?.[1]?.toLowerCase() ?? (value.startsWith("/") ? "/" : "");
	if (rootOf(fromPath) !== rootOf(toPath)) return null;
	const fromParts = fromPath.replace(/^[A-Za-z]:\//, "").replace(/^\//, "").split("/").filter(Boolean);
	const toParts = toPath.replace(/^[A-Za-z]:\//, "").replace(/^\//, "").split("/").filter(Boolean);
	let common = 0;
	while (common < fromParts.length && common < toParts.length && compare(fromParts[common]!) === compare(toParts[common]!)) common++;
	return [...fromParts.slice(common).map(() => ".."), ...toParts.slice(common)].join("/");
}

export async function executeDiagnose(
	filePathInput: string,
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
		project?: { projectFolder?: string; scriptsFolder?: string };
	};
	const files = filesRes as unknown as {
		success: boolean;
		files: Array<{ path: string; processor: string }>;
	};

	if (!status.success || !files.success) {
		return { ok: false, error: "Failed to query HISE project info" };
	}

	const projectFolder = status.project?.projectFolder;
	const scriptsFolder = status.project?.scriptsFolder;
	if (!projectFolder || !scriptsFolder || !Array.isArray(files.files)) {
		return { ok: false, error: "HISE did not report the project folder, scripts folder, or included files" };
	}

	const resolved = resolveIncludedScriptPath(filePathInput, projectFolder, scriptsFolder, files.files);
	if ("error" in resolved) return { ok: false, error: resolved.error };
	const relativePath = resolved.relativePath;

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
		file: filePathInput,
		diagnostics,
	};
}
