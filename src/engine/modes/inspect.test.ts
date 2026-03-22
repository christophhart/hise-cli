import { describe, expect, it } from "vitest";
import { InspectMode, extractStatusPayload, formatProject, formatVersion } from "./inspect.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import { CompletionEngine } from "../completion/engine.js";
import { createDefaultMockRuntime } from "../../mock/runtime.js";

function createMockSession(overrides: Partial<ReturnType<typeof createDefaultMockRuntime>["status"]> = {}): SessionContext {
	const runtime = createDefaultMockRuntime();
	const status = {
		...runtime.status,
		...overrides,
	};
	const mock = new MockHiseConnection();
	mock.onGet("/api/status", () => ({
		success: true as const,
		result: JSON.stringify(status),
		value: status,
		logs: [],
		errors: [],
	}));
	return {
		connection: mock,
		popMode: () => ({ type: "text", content: "Exited Inspect mode." }),
	};
}

describe("InspectMode", () => {
	it("has correct identity", () => {
		const mode = new InspectMode();
		expect(mode.id).toBe("inspect");
		expect(mode.name).toBe("Inspect");
		expect(mode.accent).toBe("#ae81ff");
		expect(mode.prompt).toBe("[inspect] > ");
	});

	it("shows help table for help command", async () => {
		const result = await new InspectMode().parse("help", createMockSession());
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("version");
			expect(result.content).toContain("project");
		}
	});

	it("shows error for unknown commands", async () => {
		const result = await new InspectMode().parse("cpu", createMockSession());
		expect(result.type).toBe("error");
	});

	it("extracts a contract-valid status payload from mock runtime", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/status");
		if (!("success" in response) || !response.success) throw new Error("Expected success response");
		expect(extractStatusPayload(response)).toEqual(runtime.status);
	});
});

describe("InspectMode version", () => {
	it("formats version data", async () => {
		const result = await new InspectMode().parse("version", createMockSession());
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("## Server Version");
			expect(result.content).toContain("4.1.0-mock");
		}
	});

	it("formats version helper directly", () => {
		const result = formatVersion(createDefaultMockRuntime().status);
		if (result.type === "markdown") {
			expect(result.content).toContain("Compile Timeout");
		}
	});
});

describe("InspectMode project", () => {
	it("formats project data", async () => {
		const result = await new InspectMode().parse("project", createMockSession());
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("## Project");
			expect(result.content).toContain("Mock Project");
			expect(result.content).toContain("Interface");
		}
	});

	it("formats project helper directly", () => {
		const result = formatProject(createDefaultMockRuntime().status);
		if (result.type === "markdown") {
			expect(result.content).toContain("Script Processors");
		}
	});
});

describe("InspectMode completion", () => {
	it("returns empty without engine", () => {
		const result = new InspectMode().complete!("v", 1);
		expect(result.items).toHaveLength(0);
	});

	it("returns all commands for empty input", () => {
		const result = new InspectMode(new CompletionEngine()).complete!("", 0);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("version");
		expect(labels).toContain("project");
		expect(labels).toContain("help");
	});

	it("filters by prefix", () => {
		const result = new InspectMode(new CompletionEngine()).complete!("pro", 3);
		expect(result.items.some((i) => i.label === "project")).toBe(true);
	});
});
