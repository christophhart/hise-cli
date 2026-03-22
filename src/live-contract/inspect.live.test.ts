import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HttpHiseConnection } from "../engine/hise.js";
import { formatProject, formatVersion } from "../engine/modes/inspect.js";
import { normalizeStatusPayload } from "../mock/contracts/status.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import { getLiveStatusPayload, requireLiveHiseConnection, sanitizeFormattingSnapshot } from "./helpers.js";

let connection: HttpHiseConnection;

beforeAll(async () => {
	connection = await requireLiveHiseConnection();
});

afterAll(() => {
	connection.destroy();
});

describe("live contract parity — inspect /api/status", () => {
	it("matches the mock status contract shape", async () => {
		const live = normalizeStatusPayload(await getLiveStatusPayload(connection));
		const mock = createDefaultMockRuntime().status;
		expect(Object.keys(live).sort()).toEqual(Object.keys(mock).sort());
	});

	it("preserves version formatter structure", async () => {
		const live = normalizeStatusPayload(await getLiveStatusPayload(connection));
		const mock = createDefaultMockRuntime().status;
		const liveResult = formatVersion(live);
		const mockResult = formatVersion(mock);
		expect(liveResult.type).toBe("markdown");
		expect(mockResult.type).toBe("markdown");
		if (liveResult.type === "markdown" && mockResult.type === "markdown") {
			expect(sanitizeFormattingSnapshot(liveResult.content)).toBe(sanitizeFormattingSnapshot(mockResult.content));
		}
	});

	it("preserves project formatter structure", async () => {
		const live = normalizeStatusPayload(await getLiveStatusPayload(connection));
		const mock = createDefaultMockRuntime().status;
		const liveResult = formatProject(live);
		const mockResult = formatProject(mock);
		expect(liveResult.type).toBe("markdown");
		expect(mockResult.type).toBe("markdown");
		if (liveResult.type === "markdown" && mockResult.type === "markdown") {
			expect(sanitizeFormattingSnapshot(liveResult.content)).toBe(sanitizeFormattingSnapshot(mockResult.content));
		}
	});
});
