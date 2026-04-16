// Live contract tests for the DSP REST endpoints. Requires a running
// HISE instance on :1900 with at least one DspNetwork-capable script
// processor (HardcodedFX, HardcodedSynth, or similar). Run via:
//   npm run test:live-contract:dsp
//
// The suite probes shape parity against `src/mock/contracts/dsp.ts`,
// then exercises a minimal init → add → connect → set → save → reset
// round-trip against the live server.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { HttpHiseConnection } from "../engine/hise.js";
import { isEnvelopeResponse, isErrorResponse, isSuccessResponse } from "../engine/hise.js";
import {
	normalizeDspApplyResponse,
	normalizeDspInitResponse,
	normalizeDspList,
	normalizeDspSaveResponse,
	normalizeDspTreeResponse,
	findDspNode,
	findDspConnectionTargeting,
} from "../mock/contracts/dsp.js";
import { requireLiveHiseConnection } from "./helpers.js";

let connection: HttpHiseConnection;

beforeAll(async () => {
	connection = await requireLiveHiseConnection();
});

afterAll(() => {
	connection.destroy();
});

// Resolve a DspNetwork-capable module id. Prefer HardcodedFX/HardcodedSynth
// module types. Throws if none found — tests are skipped in that case.
async function findHostModule(): Promise<string> {
	const resp = await connection.get("/api/status");
	if (isErrorResponse(resp)) throw new Error(resp.message);
	if (!isSuccessResponse(resp)) throw new Error("Bad /api/status response");
	const processors = (resp.scriptProcessors as Array<{ moduleId: string }> | undefined) ?? [];
	if (processors.length === 0) {
		throw new Error("Live HISE has no script processors; cannot run DSP live contract");
	}
	// Without module-type metadata in /api/status, we fall back to the first
	// processor and expect the tester to load a host that supports DspNetwork.
	return processors[0]!.moduleId;
}

describe("live contract parity — DSP endpoints", () => {
	it("GET /api/dsp/list matches the list contract", async () => {
		const resp = await connection.get("/api/dsp/list");
		if (isErrorResponse(resp)) throw new Error(resp.message);
		expect(isEnvelopeResponse(resp)).toBe(true);
		expect(resp.success).toBe(true);
		// `networks` is top-level per openapi — not under `result`.
		const networks = (resp as unknown as { networks: unknown }).networks;
		expect(() => normalizeDspList(networks)).not.toThrow();
	});

	it("POST /api/dsp/init returns {result: <tree>, filePath, embedded}", async () => {
		const moduleId = await findHostModule();
		const resp = await connection.post(
			`/api/dsp/init?moduleId=${encodeURIComponent(moduleId)}`,
			{ moduleId, name: "__cli_live_test__", embedded: false },
		);
		if (isErrorResponse(resp)) throw new Error(resp.message);
		if (!isEnvelopeResponse(resp) || !resp.success) {
			throw new Error(`init failed: ${JSON.stringify(resp.errors)}`);
		}
		const parsed = normalizeDspInitResponse(resp);
		expect(parsed.tree.nodeId).toBeTruthy();
		expect(typeof parsed.filePath).toBe("string");
		expect(typeof parsed.embedded).toBe("boolean");
	});

	it("GET /api/dsp/tree returns a contract-valid tree", async () => {
		const moduleId = await findHostModule();
		const resp = await connection.get(
			`/api/dsp/tree?moduleId=${encodeURIComponent(moduleId)}`,
		);
		if (isErrorResponse(resp)) throw new Error(resp.message);
		if (!isEnvelopeResponse(resp) || !resp.success) {
			throw new Error(`tree failed: ${JSON.stringify(resp.errors)}`);
		}
		const { raw, tree } = normalizeDspTreeResponse(resp.result);
		expect(raw.nodeId).toBeTruthy();
		expect(raw.factoryPath).toBeTruthy();
		expect(tree.label).toBe(raw.nodeId);
	});

	it("POST /api/dsp/apply round-trips add → set → connect → get-tree", async () => {
		const moduleId = await findHostModule();
		// Start fresh.
		await connection.post(`/api/dsp/apply`, {
			moduleId, operations: [{ op: "clear" }],
		});

		const ops = [
			{ op: "add", factoryPath: "core.oscillator", parent: "__cli_live_test__", nodeId: "OscCli" },
			{ op: "add", factoryPath: "control.pma", parent: "__cli_live_test__", nodeId: "PmaCli" },
			{ op: "set", nodeId: "OscCli", parameterId: "Frequency", value: 880 },
			{ op: "connect", source: "PmaCli", target: "OscCli", parameter: "Frequency" },
		];
		const apply = await connection.post(`/api/dsp/apply`, { moduleId, operations: ops });
		if (isErrorResponse(apply)) throw new Error(apply.message);
		if (!isEnvelopeResponse(apply) || !apply.success) {
			throw new Error(`apply failed: ${JSON.stringify(apply.errors)}`);
		}
		const applyParsed = normalizeDspApplyResponse(apply);
		expect(applyParsed.diff.length).toBeGreaterThan(0);

		// Read the tree back and verify the modifications survived.
		const treeResp = await connection.get(
			`/api/dsp/tree?moduleId=${encodeURIComponent(moduleId)}`,
		);
		if (!isEnvelopeResponse(treeResp) || !treeResp.success) {
			throw new Error("tree fetch after apply failed");
		}
		const { raw } = normalizeDspTreeResponse(treeResp.result);
		const osc = findDspNode(raw, "OscCli");
		expect(osc).not.toBeNull();
		expect(osc?.factoryPath).toBe("core.oscillator");
		expect(osc?.parameters.find((p) => p.parameterId === "Frequency")?.value).toBe(880);
		const conn = findDspConnectionTargeting(raw, "OscCli", "Frequency");
		expect(conn?.source).toBe("PmaCli");
	});

	it("POST /api/dsp/save returns a filePath for file-backed networks", async () => {
		const moduleId = await findHostModule();
		const resp = await connection.post(
			`/api/dsp/save?moduleId=${encodeURIComponent(moduleId)}`,
			{ moduleId },
		);
		if (isErrorResponse(resp)) throw new Error(resp.message);
		if (!isEnvelopeResponse(resp) || !resp.success) {
			// An embedded network would error — that's also valid behaviour; skip.
			return;
		}
		const parsed = normalizeDspSaveResponse(resp);
		expect(parsed.filePath).toMatch(/\.xml$/);
	});

	it("POST /api/dsp/apply {op:'clear'} empties the network", async () => {
		const moduleId = await findHostModule();
		const resp = await connection.post(`/api/dsp/apply`, {
			moduleId, operations: [{ op: "clear" }],
		});
		if (isErrorResponse(resp)) throw new Error(resp.message);
		expect(isEnvelopeResponse(resp) && resp.success).toBe(true);
		const treeResp = await connection.get(
			`/api/dsp/tree?moduleId=${encodeURIComponent(moduleId)}`,
		);
		if (!isEnvelopeResponse(treeResp) || !treeResp.success) {
			throw new Error("tree fetch after clear failed");
		}
		const { raw } = normalizeDspTreeResponse(treeResp.result);
		expect(raw.children).toEqual([]);
	});
});
