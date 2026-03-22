import { describe, expect, it } from "vitest";
import { normalizeReplResponse } from "./contracts/repl.js";
import { normalizeStatusPayload } from "./contracts/status.js";

describe("mock contracts", () => {
	it("normalizes repl success envelopes", () => {
		const normalized = normalizeReplResponse({
			success: true,
			result: "ok",
			value: 123,
			moduleId: "Interface",
			logs: ["hello"],
			errors: [],
		});

		expect(normalized).toMatchObject({
			kind: "success",
			value: 123,
			moduleId: "Interface",
			logs: ["hello"],
		});
	});

	it("normalizes status payloads", () => {
		const normalized = normalizeStatusPayload({
			server: { version: "4.1.0", compileTimeout: "20.0" },
			project: {
				name: "Demo Project",
				projectFolder: "/demo",
				scriptsFolder: "/demo/Scripts",
			},
			scriptProcessors: [{
				moduleId: "Interface",
				isMainInterface: true,
				externalFiles: [],
				callbacks: [{ id: "onInit", empty: false }],
			}],
		});

		expect(normalized.server.version).toBe("4.1.0");
		expect(normalized.project.name).toBe("Demo Project");
		expect(normalized.scriptProcessors[0]?.moduleId).toBe("Interface");
	});
});
