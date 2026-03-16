import { describe, expect, it } from "vitest";
import { RootMode } from "./root.js";
import type { SessionContext } from "./mode.js";

const mockSession: SessionContext = {
	connection: null,
	popMode: () => ({ type: "text", content: "Goodbye." }),
};

describe("RootMode", () => {
	const root = new RootMode();

	it("has correct identity", () => {
		expect(root.id).toBe("root");
		expect(root.name).toBe("Root");
		expect(root.prompt).toBe("> ");
	});

	it("rejects non-slash input with error", async () => {
		const result = await root.parse("some input", mockSession);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("No mode active");
		}
	});

	it("rejects any plain text", async () => {
		const inputs = ["add AHDSR", "Engine.getSampleRate()", "hello"];
		for (const input of inputs) {
			const result = await root.parse(input, mockSession);
			expect(result.type).toBe("error");
		}
	});

	it("returns empty completions", () => {
		const result = root.complete("test", 4);
		expect(result.items).toHaveLength(0);
	});
});
