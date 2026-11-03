import { describe, it, expect } from "vitest";
import { MockHiseConnection } from "../engine/hise.js";
import { executeDiagnose, executeDiagnoseCode, parseDiagnoseFlags } from "./diagnose.js";

const PROJECT_FOLDER = "/project";
const SCRIPTS_FOLDER = `${PROJECT_FOLDER}/Scripts`;

function mockWithStatus(mock: MockHiseConnection, scriptsFolder = SCRIPTS_FOLDER) {
	mock.onGet("/api/status", () => ({
		success: true,
		result: null,
		project: { projectFolder: PROJECT_FOLDER, scriptsFolder },
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

describe("parseDiagnoseFlags", () => {
	it("parses inline source", () => {
		expect(parseDiagnoseFlags(["--code", "Console.print(1);"]).flags.code).toBe("Console.print(1);");
		expect(parseDiagnoseFlags(["--code=Console.print(1);"]).flags.code).toBe("Console.print(1);");
	});
});

describe("executeDiagnoseCode", () => {
	it("submits source directly and returns diagnostics", async () => {
		const mock = new MockHiseConnection();
		mock.onPost("/api/diagnose_script", () => ({ success: true, result: null, diagnostics: [], logs: [], errors: [] }));
		const result = await executeDiagnoseCode("Console.print(1);", mock);
		expect(result).toEqual({ ok: true, diagnostics: [] });
		expect(mock.calls.find((call) => call.endpoint === "/api/diagnose_script")?.body).toEqual({ code: "Console.print(1);" });
	});
});

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

	it("fails when a file in the scripts folder is not included", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, []);

		const result = await executeDiagnose("/project/Scripts/new.js", mock);
		expect(result.ok).toBe(false);
		expect("error" in result && result.error).toContain("No included HiseScript file matches");
	});

	it("fails when the input does not resolve to an included file", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, []);

		const result = await executeDiagnose("/other/path/file.js", mock);
		expect(result.ok).toBe(false);
		expect("error" in result && result.error).toContain("No included HiseScript file matches");
	});

	it("returns error when HISE is not running", async () => {
		const mock = new MockHiseConnection();
		// No handlers registered — will return error responses

		const result = await executeDiagnose("/project/Scripts/ext.js", mock);
		expect(result.ok).toBe(false);
		expect("error" in result).toBe(true);
	});

	it("resolves absolute, Scripts-relative, and project-relative input forms", async () => {
		for (const [input, listedPath] of [
			["/project/Scripts/sub/deep.js", "/project/Scripts/sub/deep.js"],
			["sub/deep.js", "sub/deep.js"],
			["Scripts/sub/deep.js", "Scripts/sub/deep.js"],
		] as const) {
			const mock = new MockHiseConnection();
			mockWithStatus(mock);
			mockWithFiles(mock, [{ path: listedPath, processor: "Interface" }]);
			mock.onPost("/api/diagnose_script", () => ({
				success: true,
				result: null,
				diagnostics: [],
				logs: [],
				errors: [],
			}));

			const result = await executeDiagnose(input, mock);
			expect(result.ok).toBe(true);
			const postCall = mock.calls.find((call) => call.endpoint === "/api/diagnose_script");
			expect(postCall?.body).toEqual({ filePath: "sub/deep.js" });
		}
	});

	it("normalizes path separators and dot segments", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, [{ path: "/project/Scripts/sub/deep.js", processor: "Interface" }]);
		mock.onPost("/api/diagnose_script", () => ({ success: true, result: null, diagnostics: [], logs: [], errors: [] }));

		const result = await executeDiagnose("Scripts\\sub\\..\\sub\\deep.js", mock);
		expect(result.ok).toBe(true);
		expect(mock.calls.find((call) => call.endpoint === "/api/diagnose_script")?.body).toEqual({ filePath: "sub/deep.js" });
	});

	it("reports ambiguous relative paths instead of guessing", async () => {
		const mock = new MockHiseConnection();
		mockWithStatus(mock);
		mockWithFiles(mock, [
			{ path: "/project/Scripts/foo.js", processor: "Interface" },
			{ path: "/project/Scripts/Scripts/foo.js", processor: "Interface" },
		]);

		const result = await executeDiagnose("Scripts/foo.js", mock);
		expect(result.ok).toBe(false);
		expect("error" in result && result.error).toContain("matches multiple included files");
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
