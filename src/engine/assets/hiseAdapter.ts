// HISE adapter helpers for asset operations. Wraps HiseConnection calls used
// during install / uninstall (settings + preprocessor reads/writes) and
// project resolution. Returns plain values; throws on transport / API error.

import { isErrorResponse, isSuccessResponse, type HiseConnection, type HiseResponse } from "../hise.js";
import { normalizeStatusPayload, type StatusPayload } from "../../mock/contracts/status.js";

export class HiseError extends Error {
	constructor(message: string, public readonly endpoint: string) {
		super(message);
		this.name = "HiseError";
	}
}

export async function probe(hise: HiseConnection): Promise<boolean> {
	return hise.probe();
}

export async function getStatus(hise: HiseConnection): Promise<StatusPayload> {
	const res = await hise.get("/api/status");
	const ok = unwrap(res, "/api/status");
	return normalizeStatusPayload(ok);
}

export async function getProjectFolder(hise: HiseConnection): Promise<string> {
	const status = await getStatus(hise);
	return status.project.projectFolder;
}

// ── Settings ──────────────────────────────────────────────────────

interface SettingEntry {
	value: unknown;
}

export async function readTargetSettings(hise: HiseConnection): Promise<Record<string, string>> {
	const res = await hise.get("/api/project/settings/list");
	const ok = unwrap(res, "/api/project/settings/list");
	const settings = (ok as { settings?: Record<string, SettingEntry> }).settings;
	if (!settings || typeof settings !== "object") {
		throw new HiseError("settings/list response missing `settings`", "/api/project/settings/list");
	}
	const out: Record<string, string> = {};
	for (const [k, entry] of Object.entries(settings)) {
		const v = entry?.value;
		out[k] = v === undefined || v === null ? "" : String(v);
	}
	return out;
}

export async function writeTargetSetting(
	hise: HiseConnection,
	key: string,
	value: string,
): Promise<void> {
	const res = await hise.post("/api/project/settings/set", { key, value });
	unwrap(res, "/api/project/settings/set");
}

// ── Preprocessors ─────────────────────────────────────────────────

// Spec §7.3: walk scopes broadest -> narrowest; last value wins.
const SCOPE_ORDER = [
	"*.*",
	"Project.*", "Dll.*",
	"Project.Windows", "Project.macOS", "Project.Linux",
	"Dll.Windows", "Dll.macOS", "Dll.Linux",
] as const;

export async function readTargetPreprocessor(
	hise: HiseConnection,
	name: string,
): Promise<string | null> {
	const res = await hise.get("/api/project/preprocessor/list?OS=all&target=all");
	const ok = unwrap(res, "/api/project/preprocessor/list");
	const scopes = (ok as { preprocessors?: Record<string, Record<string, unknown>> }).preprocessors;
	if (!scopes) return null;
	let value: string | null = null;
	for (const scope of SCOPE_ORDER) {
		const slot = scopes[scope];
		if (slot && slot[name] !== undefined) {
			value = String(slot[name]);
		}
	}
	return value;
}

export async function writeTargetPreprocessor(
	hise: HiseConnection,
	name: string,
	value: string,
): Promise<void> {
	const res = await hise.post("/api/project/preprocessor/set", {
		OS: "all",
		target: "all",
		preprocessor: name,
		value,
	});
	unwrap(res, "/api/project/preprocessor/set");
}

export async function clearTargetPreprocessor(
	hise: HiseConnection,
	name: string,
): Promise<void> {
	await writeTargetPreprocessor(hise, name, "default");
}

// ── Helpers ───────────────────────────────────────────────────────

function unwrap(res: HiseResponse, endpoint: string): Record<string, unknown> {
	if (isErrorResponse(res)) {
		throw new HiseError(res.message, endpoint);
	}
	if (!isSuccessResponse(res)) {
		const errorMsg = (res.errors && res.errors.length > 0)
			? res.errors.map((e) => e.errorMessage).join("; ")
			: `request failed: ${endpoint}`;
		throw new HiseError(errorMsg, endpoint);
	}
	return res as unknown as Record<string, unknown>;
}
