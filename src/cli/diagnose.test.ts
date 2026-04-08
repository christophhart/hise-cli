import { describe, it, expect } from "vitest";
import { MockHiseConnection } from "../engine/hise.js";
import { executeDiagnose } from "./diagnose.js";

const SCRIPTS_FOLDER = "/project/Scripts";

function mockWithStatus(mock: MockHiseConnection, scriptsFolder = SCRIPTS_FOLDER) {
	mock.onGet("/api/status", () => ({
		success: true,
		result: null,
		project: { scriptsFolder },
		logs: [],
		errors: [],
	}));
}

function mockWithFiles(mock: MockHiseConnection, files: Array<{ path: string; processor: string }> = []) {
	mock.onGet("/api/get_included_files", () => ({
		success: true,
		result: null,
		files,
		logs: [],
		errors: [],
	}));
}

describe("executeDiagnose", () => {
	it("returns diagnostics for an included file with errors", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, [{ path: "/project/Scripts/ext.js", processor: "Interface" }]);
		mock.onPost("/api/diagnose_script", () => ({
			success: true,
			result: null,
			diagnostics: [
				{ line: 6, column: 15, severity: "error", source: "api-validation", message: "Not found: Console.prins", suggestions: ["print"] },
			],
			logs: [],
			errors: [],
		}));

		const result = await executeDiagnose("/project/Scripts/ext.js", mock);
		expect(result.ok).toBe(false);
		expect("diagnostics" in result && result.diagnostics).toHaveLength(1);
		expect("file" in result && result.file).toBe("/project/Scripts/ext.js");
	});

	it("returns ok for clean file", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, [{ path: "/project/Scripts/clean.js", processor: "Interface" }]);
		mock.onPost("/api/diagnose_script", () => ({
			success: true,
			result: null,
			diagnostics: [],
			logs: [],
			errors: [],
		}));

		const result = await executeDiagnose("/project/Scripts/clean.js", mock);
		expect(result.ok).toBe(true);
		expect("diagnostics" in result && result.diagnostics).toHaveLength(0);
	});

	it("returns warning for file in scripts folder but not included", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, []);

		const result = await executeDiagnose("/project/Scripts/new.js", mock);
		expect(result.ok).toBe(true);
		expect("warning" in result && result.warning).toContain("include this file");
	});

	it("returns silently for file outside scripts folder", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, []);

		const result = await executeDiagnose("/other/path/file.js", mock);
		expect(result.ok).toBe(true);
		expect("diagnostics" in result && result.diagnostics).toHaveLength(0);
		expect("warning" in result).toBe(false);
	});

	it("returns error when HISE is not running", async () => {
		const mock = new MockHiseConnection();
		// No handlers registered — will return error responses

		const result = await executeDiagnose("/project/Scripts/ext.js", mock);
		expect(result.ok).toBe(false);
		expect("error" in result).toBe(true);
	});

	it("sends relative path to diagnose_script endpoint", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, [{ path: "/project/Scripts/sub/deep.js", processor: "Interface" }]);
		mock.onPost("/api/diagnose_script", () => ({
			success: true,
			result: null,
			diagnostics: [],
			logs: [],
			errors: [],
		}));

		await executeDiagnose("/project/Scripts/sub/deep.js", mock);
		const postCall = mock.calls.find((c) => c.endpoint === "/api/diagnose_script");
		expect(postCall?.body).toEqual({ filePath: "sub/deep.js" });
	});
});
