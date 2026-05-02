import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "../hise.js";
import {
	clearTargetPreprocessor,
	getProjectFolder,
	HiseError,
	readTargetPreprocessor,
	readTargetSettings,
	writeTargetPreprocessor,
	writeTargetSetting,
} from "./hiseAdapter.js";

function statusFixture() {
	return {
		success: true,
		server: { version: "1.0", buildCommit: "abc", compileTimeout: "30000" },
		project: {
			name: "Demo",
			projectFolder: "/projects/Demo",
			scriptsFolder: "/projects/Demo/Scripts",
		},
		scriptProcessors: [],
		logs: [],
		errors: [],
	};
}

describe("getProjectFolder", () => {
	it("returns project.projectFolder", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/status", () => statusFixture());
		expect(await getProjectFolder(conn)).toBe("/projects/Demo");
	});

	it("throws HiseError on transport error", async () => {
		const conn = new MockHiseConnection(); // no handler -> 404 envelope
		await expect(getProjectFolder(conn)).rejects.toBeInstanceOf(HiseError);
	});
});

describe("readTargetSettings", () => {
	it("flattens settings map to value strings", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/project/settings/list", () => ({
			success: true,
			settings: {
				Name: { value: "Demo" },
				Version: { value: "1.0.0" },
				OSXStaticLibs: { value: "" },
			},
			logs: [],
			errors: [],
		}));
		expect(await readTargetSettings(conn)).toEqual({
			Name: "Demo",
			Version: "1.0.0",
			OSXStaticLibs: "",
		});
	});

	it("coerces non-string values to strings", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/project/settings/list", () => ({
			success: true,
			settings: { Channels: { value: 4 }, Flag: { value: true }, Empty: { value: null } },
			logs: [],
			errors: [],
		}));
		expect(await readTargetSettings(conn)).toEqual({
			Channels: "4",
			Flag: "true",
			Empty: "",
		});
	});
});

describe("writeTargetSetting", () => {
	it("posts key/value", async () => {
		const conn = new MockHiseConnection();
		const writes: Array<{ key: unknown; value: unknown }> = [];
		conn.onPost("/api/project/settings/set", (body) => {
			writes.push(body as { key: unknown; value: unknown });
			return { success: true, result: "OK", logs: [], errors: [] };
		});
		await writeTargetSetting(conn, "OSXStaticLibs", "-framework Foo");
		expect(writes).toEqual([{ key: "OSXStaticLibs", value: "-framework Foo" }]);
	});

	it("throws HiseError on failed envelope", async () => {
		const conn = new MockHiseConnection();
		conn.onPost("/api/project/settings/set", () => ({
			success: false,
			result: null,
			logs: [],
			errors: [{ errorMessage: "Unknown setting", callstack: [] }],
		}));
		await expect(writeTargetSetting(conn, "Bogus", "x"))
			.rejects.toThrow(/Unknown setting/);
	});
});

describe("readTargetPreprocessor", () => {
	const list = (preprocessors: Record<string, Record<string, unknown>>) => ({
		success: true,
		preprocessors,
		logs: [],
		errors: [],
	});

	it("returns null when macro not defined", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/project/preprocessor/list?OS=all&target=all", () =>
			list({ "*.*": {} }));
		expect(await readTargetPreprocessor(conn, "FOO")).toBeNull();
	});

	it("walks scopes broadest -> narrowest, last wins", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/project/preprocessor/list?OS=all&target=all", () =>
			list({
				"*.*": { FOO: 1 },
				"Project.*": { FOO: 2 },
				"Project.Windows": { FOO: 3 },
			}));
		expect(await readTargetPreprocessor(conn, "FOO")).toBe("3");
	});

	it("returns most-specific defined scope", async () => {
		const conn = new MockHiseConnection();
		conn.onGet("/api/project/preprocessor/list?OS=all&target=all", () =>
			list({
				"*.*": { FOO: 1 },
				"Project.macOS": { FOO: 7 },
			}));
		expect(await readTargetPreprocessor(conn, "FOO")).toBe("7");
	});
});

describe("writeTargetPreprocessor", () => {
	it("posts catch-all OS=all target=all", async () => {
		const conn = new MockHiseConnection();
		const writes: unknown[] = [];
		conn.onPost("/api/project/preprocessor/set", (body) => {
			writes.push(body);
			return { success: true, result: "OK", logs: [], errors: [] };
		});
		await writeTargetPreprocessor(conn, "FOO", "1");
		expect(writes[0]).toEqual({
			OS: "all", target: "all", preprocessor: "FOO", value: "1",
		});
	});
});

describe("clearTargetPreprocessor", () => {
	it("posts value=default", async () => {
		const conn = new MockHiseConnection();
		const writes: unknown[] = [];
		conn.onPost("/api/project/preprocessor/set", (body) => {
			writes.push(body);
			return { success: true, result: "OK", logs: [], errors: [] };
		});
		await clearTargetPreprocessor(conn, "FOO");
		expect((writes[0] as { value: string }).value).toBe("default");
	});
});
