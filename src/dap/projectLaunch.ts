import { access } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DapRestClient, DapRestError } from "./rest.js";

export interface ProjectTarget { file: string; folder: string; relativeFile: string; masterId: string }

/** Reject arbitrary paths: HISE's project/load accepts project-relative XML/HIP files. */
export async function resolveProjectTarget(input: string): Promise<ProjectTarget> {
	const raw = input.startsWith("file:") ? fileURLToPath(input) : input;
	if (!isAbsolute(raw)) throw Error("projectFile must be an absolute XML/HIP path");
	const file = resolve(raw);
	const extension = extname(file).toLowerCase();
	if (extension !== ".xml" && extension !== ".hip") throw Error("projectFile must be an XML or HIP file");
	await access(file);
	let folder = dirname(file);
	while (true) {
		try { await access(resolve(folder, "project_info.xml")); break; }
		catch { /* keep walking toward the project root */ }
		const parent = dirname(folder);
		if (parent === folder) throw Error(`No HISE project_info.xml above ${file}`);
		folder = parent;
	}
	const rel = relative(folder, file);
	if (rel === ".." || rel.startsWith(`..${sep}`)) throw Error("projectFile is outside the HISE project");
	const parts = rel.split(sep);
	if (extension === ".xml" && (parts.length !== 2 || parts[0].toLowerCase() !== "xmlpresetbackups")
		|| extension === ".hip" && (parts.length !== 1 && (parts.length !== 2 || parts[0].toLowerCase() !== "presets"))) {
		throw Error("projectFile must be in XmlPresetBackups (XML), the project root or Presets (HIP)");
	}
	return { file, folder, relativeFile: parts.join("/"), masterId: basename(file, extname(file)) };
}

function pathKey(path: string): string {
	const resolved = resolve(path);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
export function sameProject(a: string, b: string): boolean { return pathKey(a) === pathKey(b); }

export interface ProjectStatus {
	apiVersion?: string;
	project?: { projectFolder?: string };
	scriptProcessors?: Array<{ moduleId: string }>;
}

export async function projectStatus(rest: DapRestClient): Promise<ProjectStatus> {
	const status = await rest.request<ProjectStatus>("status");
	if (!status.apiVersion || !status.project?.projectFolder) throw Error("HISE has no initialized project");
	return status;
}

export async function waitForHise(rest: DapRestClient, timeoutMs: number): Promise<ProjectStatus> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try { return await projectStatus(rest); }
		catch (error) { lastError = error; }
		await new Promise((done) => setTimeout(done, Math.min(250, Math.max(1, deadline - Date.now()))));
	}
	throw Error(`HISE did not become ready within ${timeoutMs}ms: ${String(lastError)}`);
}

/** HISE exports merged callbacks using a sanitized master-chain ID. */
function masterKey(value: string): string { return value.replace(/[ .()]/g, "").toLowerCase(); }

export async function verifyProject(rest: DapRestClient, status: ProjectStatus, target: ProjectTarget, moduleId?: string): Promise<void> {
	const actual = status.project?.projectFolder;
	if (!actual || !sameProject(actual, target.folder)) throw Error(`HISE project mismatch: expected ${target.folder}, running ${actual ?? "none"}`);
	const tree = await rest.request<{ result?: { processorId?: string; id?: string } }>("builder/tree");
	const master = tree.result?.processorId ?? tree.result?.id;
	if (!master || masterKey(master) !== masterKey(target.masterId)) throw Error(`HISE master-chain mismatch: expected ${target.masterId} (from ${target.file}), running ${master ?? "none"}`);
	if (moduleId && !status.scriptProcessors?.some((processor) => processor.moduleId === moduleId)) throw Error(`HISE processor ${moduleId} is not present in ${target.folder}`);
}

export async function probeHise(rest: DapRestClient): Promise<ProjectStatus | undefined> {
	try { return await projectStatus(rest); }
	catch (error) { if (error instanceof DapRestError && error.status === 0) return undefined; throw error; }
}
