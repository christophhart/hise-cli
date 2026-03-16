import { describe, expect, it } from "vitest";
import { InspectMode, formatCpu, formatVoices, formatModules, formatMemory } from "./inspect.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import { CompletionEngine } from "../completion/engine.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createStatusResponse(data: Record<string, unknown> = {}) {
	return {
		success: true as const,
		result: JSON.stringify(data),
		logs: [] as string[],
		errors: [] as Array<{ errorMessage: string; callstack: string[] }>,
		...data,
	};
}

function createMockSession(
	statusData: Record<string, unknown> = {},
): SessionContext {
	const mock = new MockHiseConnection();
	mock.onGet("/api/status", () => ({
		success: true as const,
		result: statusData as unknown as string,
		value: statusData,
		logs: [],
		errors: [],
	}));
	return {
		connection: mock,
		popMode: () => ({ type: "text", content: "Exited Inspect mode." }),
	};
}

// ── InspectMode identity ────────────────────────────────────────────

describe("InspectMode", () => {
	it("has correct identity", () => {
		const mode = new InspectMode();
		expect(mode.id).toBe("inspect");
		expect(mode.name).toBe("Inspect");
		expect(mode.accent).toBe("#ae81ff");
		expect(mode.prompt).toBe("[inspect] > ");
	});

	it("shows help for unknown commands", async () => {
		const session = createMockSession();
		const mode = new InspectMode();
		const result = await mode.parse("nonexistent", session);
		expect(result.type).toBe("error");
	});

	it("shows help table for help command", async () => {
		const session = createMockSession();
		const mode = new InspectMode();
		const result = await mode.parse("help", session);
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.headers).toContain("Command");
			const commands = result.rows.map((r) => r[0]);
			expect(commands).toContain("cpu");
			expect(commands).toContain("voices");
			expect(commands).toContain("modules");
			expect(commands).toContain("memory");
		}
	});

	it("returns error when no connection", async () => {
		const mode = new InspectMode();
		const session: SessionContext = {
			connection: null,
			popMode: () => ({ type: "text", content: "Exited Inspect mode." }),
		};
		const result = await mode.parse("cpu", session);
		expect(result.type).toBe("error");
	});
});

// ── CPU formatting ──────────────────────────────────────────────────

describe("InspectMode cpu", () => {
	it("parses cpu data from status", async () => {
		const session = createMockSession({
			cpuUsage: 12.3,
			sampleRate: 44100,
			bufferSize: 512,
		});
		const mode = new InspectMode();
		const result = await mode.parse("cpu", session);
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.rows[0][1]).toContain("12.3%");
			expect(result.rows[1][1]).toContain("44100");
			expect(result.rows[2][1]).toContain("512");
		}
	});

	it("handles missing cpu data gracefully", () => {
		const result = formatCpu({});
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.rows[0][1]).toBe("0.0%");
		}
	});
});

// ── Voices formatting ───────────────────────────────────────────────

describe("InspectMode voices", () => {
	it("formats voice count", async () => {
		const session = createMockSession({
			activeVoices: 8,
			maxVoices: 256,
		});
		const mode = new InspectMode();
		const result = await mode.parse("voices", session);
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.rows[0][1]).toBe("8");
			expect(result.rows[1][1]).toBe("256");
		}
	});

	it("handles zero voices", () => {
		const result = formatVoices({ activeVoices: 0, maxVoices: 256 });
		if (result.type === "table") {
			expect(result.rows[2][1]).toBe("0.0%");
		}
	});
});

// ── Modules formatting ──────────────────────────────────────────────

describe("InspectMode modules", () => {
	it("formats module tree", () => {
		const result = formatModules({
			modules: [
				{
					name: "Sampler1",
					type: "StreamingSampler",
					children: [
						{ name: "AHDSR1", type: "AHDSR" },
					],
				},
			],
		});
		expect(result.type).toBe("tree");
		if (result.type === "tree") {
			expect(result.root.label).toBe("Root");
			expect(result.root.children).toHaveLength(1);
			expect(result.root.children![0].label).toBe("Sampler1");
			expect(result.root.children![0].children).toHaveLength(1);
		}
	});

	it("handles missing modules gracefully", () => {
		const result = formatModules({});
		expect(result.type).toBe("text");
	});
});

// ── Memory formatting ───────────────────────────────────────────────

describe("InspectMode memory", () => {
	it("formats memory data", () => {
		const result = formatMemory({
			heapSize: 134217728, // 128 MB
			preloadSize: 8388608, // 8 MB
		});
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.rows[0][1]).toBe("128.0 MB");
			expect(result.rows[1][1]).toBe("8.0 MB");
		}
	});

	it("shows N/A for missing data", () => {
		const result = formatMemory({});
		if (result.type === "table") {
			expect(result.rows[0][1]).toBe("N/A");
			expect(result.rows[1][1]).toBe("N/A");
		}
	});
});

// ── InspectMode completion ──────────────────────────────────────────

describe("InspectMode completion", () => {
	it("returns empty without engine", () => {
		const mode = new InspectMode();
		const result = mode.complete!("c", 1);
		expect(result.items).toHaveLength(0);
	});

	it("returns all commands for empty input", () => {
		const engine = new CompletionEngine();
		const mode = new InspectMode(engine);
		const result = mode.complete!("", 0);
		expect(result.items).toHaveLength(5);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("cpu");
		expect(labels).toContain("voices");
		expect(labels).toContain("modules");
		expect(labels).toContain("memory");
		expect(labels).toContain("help");
	});

	it("filters by prefix", () => {
		const engine = new CompletionEngine();
		const mode = new InspectMode(engine);
		const result = mode.complete!("vo", 2);
		expect(result.items.some((i) => i.label === "voices")).toBe(true);
	});
});
