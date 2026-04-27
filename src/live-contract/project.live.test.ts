import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HttpHiseConnection } from "../engine/hise.js";
import { isErrorResponse, isSuccessResponse } from "../engine/hise.js";
import {
	normalizePreprocessorList,
	normalizeProjectFiles,
	normalizeProjectList,
	normalizeProjectSettings,
	normalizeProjectSnippet,
	normalizeProjectTree,
} from "../mock/contracts/project.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import {
	formatFiles,
	formatPreprocessors,
	formatProjects,
	formatSettings,
} from "../engine/modes/project-format.js";
import { requireLiveHiseConnection, sanitizeFormattingSnapshot } from "./helpers.js";

let connection: HttpHiseConnection;

beforeAll(async () => {
	connection = await requireLiveHiseConnection();
});

afterAll(() => {
	connection.destroy();
});

async function getOk(endpoint: string): Promise<Record<string, unknown>> {
	const response = await connection.get(endpoint);
	if (isErrorResponse(response)) {
		throw new Error(`${endpoint}: ${response.message}`);
	}
	if (!isSuccessResponse(response)) {
		throw new Error(`${endpoint}: unexpected response`);
	}
	return response as unknown as Record<string, unknown>;
}

describe("live contract parity — /api/project endpoints", () => {
	it("/list shape matches contract", async () => {
		const live = normalizeProjectList(await getOk("/api/project/list"));
		expect(Array.isArray(live.projects)).toBe(true);
		for (const p of live.projects) {
			expect(typeof p.name).toBe("string");
			expect(typeof p.path).toBe("string");
		}
		expect(typeof live.active).toBe("string");
	});

	it("/tree shape matches contract", async () => {
		const live = normalizeProjectTree(await getOk("/api/project/tree"));
		expect(typeof live.projectName).toBe("string");
		expect(live.root.type).toBe("folder");
	});

	it("/files shape matches contract", async () => {
		const live = normalizeProjectFiles(await getOk("/api/project/files"));
		expect(Array.isArray(live.files)).toBe(true);
		for (const f of live.files) {
			expect(["xml", "hip"]).toContain(f.type);
			expect(typeof f.path).toBe("string");
			expect(typeof f.modified).toBe("string");
		}
	});

	it("/settings/list shape matches contract", async () => {
		const live = normalizeProjectSettings(await getOk("/api/project/settings/list"));
		expect(Object.keys(live.settings).length).toBeGreaterThan(0);
		for (const [, entry] of Object.entries(live.settings)) {
			expect(typeof entry.description).toBe("string");
			if (entry.options) expect(Array.isArray(entry.options)).toBe(true);
		}
	});

	it("/preprocessor/list shape matches contract", async () => {
		const live = normalizePreprocessorList(await getOk("/api/project/preprocessor/list"));
		for (const [scope, macros] of Object.entries(live.preprocessors)) {
			expect(typeof scope).toBe("string");
			expect(typeof macros).toBe("object");
		}
	});

	it("/export_snippet shape matches contract", async () => {
		const live = normalizeProjectSnippet(await getOk("/api/project/export_snippet"));
		expect(live.snippet.startsWith("HiseSnippet ")).toBe(true);
	});
});

describe("live contract parity — /project formatter parity", () => {
	it("show projects: formatter renders without throwing on live data", async () => {
		const live = normalizeProjectList(await getOk("/api/project/list"));
		const result = formatProjects(live);
		expect(result.type).toBe("markdown");
		// Mock formatter sanity
		const mock = createDefaultMockRuntime().project.list;
		const mockResult = formatProjects(mock);
		expect(mockResult.type).toBe("markdown");
	});

	it("show settings: formatter renders + key set is non-empty", async () => {
		const live = normalizeProjectSettings(await getOk("/api/project/settings/list"));
		const result = formatSettings(live);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(sanitizeFormattingSnapshot(result.content)).toContain("Project Settings");
		}
	});

	it("show files: formatter renders + columns match mock structure", async () => {
		const live = normalizeProjectFiles(await getOk("/api/project/files"));
		const liveResult = formatFiles(live);
		const mockResult = formatFiles(createDefaultMockRuntime().project.files);
		expect(liveResult.type === mockResult.type).toBe(true);
		if (liveResult.type === "markdown" && mockResult.type === "markdown") {
			// Both have the column header, even if rows differ
			expect(liveResult.content.includes("| Name | Type | Path | Modified |")).toBe(
				mockResult.content.includes("| Name | Type | Path | Modified |"),
			);
		}
	});

	it("show preprocessors: formatter renders nested scopes for live + mock", async () => {
		const live = normalizePreprocessorList(await getOk("/api/project/preprocessor/list"));
		const liveResult = formatPreprocessors(live, "all", "all");
		const mockResult = formatPreprocessors(
			createDefaultMockRuntime().project.preprocessors,
			"all",
			"all",
		);
		expect(liveResult.type === mockResult.type).toBe(true);
	});
});
