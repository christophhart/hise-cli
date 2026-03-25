import { describe, expect, it } from "vitest";
import { createDefaultMockRuntime } from "./runtime.js";
import { normalizeReplResponse } from "./contracts/repl.js";
import { normalizeStatusPayload } from "./contracts/status.js";
import { BuilderMode } from "../engine/modes/builder.js";

describe("createDefaultMockRuntime", () => {
	it("provides a contract-valid status payload", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/status");
		if (!("success" in response) || !response.success) {
			throw new Error("Expected success response");
		}

		expect(normalizeStatusPayload(response.value)).toEqual(runtime.status);
	});

	it("provides a contract-valid repl response", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.post("/api/repl", {
			expression: "Engine.getSampleRate()",
			moduleId: "Interface",
		});

		const normalized = normalizeReplResponse(response);
		expect(normalized.kind).toBe("success");
		if (normalized.kind === "success") {
			expect(normalized.value).toBe(48000);
		}
	});
});

describe("BuilderMode mock tree ownership", () => {
	it("returns null tree in normal runtime", () => {
		const mode = new BuilderMode();
		expect(mode.getTree()).toBeNull();
	});

	it("uses injected tree in mock runtime", () => {
		const runtime = createDefaultMockRuntime();
		const mode = new BuilderMode(undefined, undefined, undefined, runtime.builderTree);
		const tree = mode.getTree();
		expect(tree).not.toBeNull();
		expect(tree?.label).toBe("Master Chain");
	});
});
