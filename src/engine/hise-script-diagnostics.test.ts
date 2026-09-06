import { describe, expect, it } from "vitest";
import { MockHiseConnection } from "./hise.js";
import { diagnoseHiseScriptCode } from "./hise-script-diagnostics.js";

describe("diagnoseHiseScriptCode", () => {
	it("sends raw code mode and returns normalized issues", async () => {
		const connection = new MockHiseConnection();
		connection.onPost("/api/diagnose_script", () => ({
			success: true,
			moduleId: "Interface",
			filePath: "",
			diagnostics: [{
				line: 1,
				column: 13,
				severity: "error",
				source: "api-validation",
				message: "Function / constant not found: Console.prnt",
				suggestions: ["print"],
			}],
			logs: [],
			errors: [],
		}));

		await expect(diagnoseHiseScriptCode(connection, 'Console.prnt("hello");')).resolves.toEqual([{
			line: 1,
			column: 13,
			severity: "error",
			source: "api-validation",
			message: "Function / constant not found: Console.prnt",
			suggestions: ["print"],
		}]);
		expect(connection.calls).toContainEqual({
			method: "POST",
			endpoint: "/api/diagnose_script",
			body: { code: 'Console.prnt("hello");' },
		});
	});

	it("optionally supplies an explicit module context", async () => {
		const connection = new MockHiseConnection();
		connection.onPost("/api/diagnose_script", () => ({
			success: true, diagnostics: [], logs: [], errors: [],
		}));
		await expect(diagnoseHiseScriptCode(connection, "Console.print(1);", { moduleId: "Interface" })).resolves.toEqual([]);
		expect(connection.calls[0]?.body).toEqual({ code: "Console.print(1);", moduleId: "Interface" });
	});

	it("fails on endpoint and malformed responses", async () => {
		const unavailable = new MockHiseConnection();
		unavailable.onPost("/api/diagnose_script", () => ({ error: true, message: "offline" }));
		await expect(diagnoseHiseScriptCode(unavailable, "Console.print(1);")).rejects.toThrow("HISE diagnose_script failed: offline");

		const malformed = new MockHiseConnection();
		malformed.onPost("/api/diagnose_script", () => ({ success: true, logs: [], errors: [] }));
		await expect(diagnoseHiseScriptCode(malformed, "Console.print(1);")).rejects.toThrow("returned no diagnostics array");
	});
});
