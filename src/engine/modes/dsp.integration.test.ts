// ── DSP mode — end-to-end integration against the mock runtime ───────
//
// Exercises the real DspMode wired to the mock HISE, covering a full
// init → add → connect → set → get → save flow.

import { describe, it, expect } from "vitest";
import { DspMode } from "./dsp.js";
import { createDefaultMockRuntime } from "../../mock/runtime.js";
import type { SessionContext } from "./mode.js";
import type { ScriptnodeList } from "../data.js";

const scriptnodeFixture: ScriptnodeList = {
	"core.oscillator": {
		id: "oscillator",
		description: "",
		type: "polyphonic",
		subtype: "",
		category: [],
		hasChildren: false,
		hasFX: false,
		metadataType: "static",
		parameters: [
			{
				parameterIndex: 0, id: "Frequency", metadataType: "static",
				description: "", type: "Slider", disabled: false,
				range: { min: 20, max: 20000, stepSize: 0 }, defaultValue: 440,
			},
		],
		modulation: [],
		hasMidi: false,
		properties: {},
		interfaces: [],
	},
	"filters.svf": {
		id: "svf",
		description: "",
		type: "polyphonic",
		subtype: "",
		category: [],
		hasChildren: false,
		hasFX: false,
		metadataType: "static",
		parameters: [
			{
				parameterIndex: 0, id: "Frequency", metadataType: "static",
				description: "", type: "Slider", disabled: false,
				range: { min: 20, max: 20000, stepSize: 0 }, defaultValue: 2000,
			},
		],
		modulation: [],
		hasMidi: false,
		properties: {},
		interfaces: [],
	},
	"control.pma": {
		id: "pma",
		description: "",
		type: "polyphonic",
		subtype: "",
		category: [],
		hasChildren: false,
		hasFX: false,
		metadataType: "static",
		parameters: [],
		modulation: [],
		hasMidi: false,
		properties: {},
		interfaces: [],
	},
};

function makeSession(): { mode: DspMode; ctx: SessionContext } {
	const runtime = createDefaultMockRuntime();
	const mode = new DspMode(scriptnodeFixture, undefined, "ScriptFX1");
	const ctx: SessionContext = {
		connection: runtime.connection,
		popMode: () => ({ type: "empty" }),
	};
	return { mode, ctx };
}

describe("DspMode — init → add → connect → set → get → save", () => {
	it("round-trips a minimal graph", async () => {
		const { mode, ctx } = makeSession();

		const init = await mode.parse("init MyDSP", ctx);
		expect(init.type).not.toBe("error");
		expect(init.type === "text" && init.content.includes("MyDSP")).toBe(true);

		const addOsc = await mode.parse("add core.oscillator as Osc1", ctx);
		expect(addOsc.type).not.toBe("error");

		const addFilter = await mode.parse("add filters.svf as Filter1", ctx);
		expect(addFilter.type).not.toBe("error");

		const addLfo = await mode.parse("add control.pma as LFO1", ctx);
		expect(addLfo.type).not.toBe("error");

		const connect = await mode.parse("connect LFO1 to Filter1.Frequency", ctx);
		expect(connect.type).not.toBe("error");

		const setFreq = await mode.parse("set Osc1.Frequency 880", ctx);
		expect(setFreq.type).not.toBe("error");

		const getFreq = await mode.parse("get Osc1.Frequency", ctx);
		expect(getFreq.type === "text" && getFreq.content === "880").toBe(true);

		const getFactory = await mode.parse("get Osc1", ctx);
		expect(getFactory.type === "text" && getFactory.content === "core.oscillator").toBe(true);

		const getSource = await mode.parse("get source of Filter1.Frequency", ctx);
		expect(getSource.type === "text" && getSource.content === "LFO1").toBe(true);

		const getSourceMissing = await mode.parse("get source of Osc1.Frequency", ctx);
		expect(getSourceMissing.type === "text" && getSourceMissing.content === "(not connected)").toBe(true);

		const getParent = await mode.parse("get parent of Osc1.Frequency", ctx);
		expect(getParent.type === "text" && getParent.content === "MyDSP").toBe(true);

		const save = await mode.parse("save", ctx);
		expect(save.type === "text" && save.content.includes("MyDSP.xml")).toBe(true);

		const reset = await mode.parse("reset", ctx);
		expect(reset.type).not.toBe("error");
	});

	it("rejects set with value out of range (local validation)", async () => {
		const { mode, ctx } = makeSession();
		await mode.parse("init MyDSP", ctx);
		await mode.parse("add core.oscillator as Osc1", ctx);
		const set = await mode.parse("set Osc1.Frequency 99999", ctx);
		expect(set.type).toBe("error");
	});

	it("rejects add with unknown factory path (local validation)", async () => {
		const { mode, ctx } = makeSession();
		await mode.parse("init MyDSP", ctx);
		const add = await mode.parse("add core.oscilator as Osc1", ctx);
		expect(add.type).toBe("error");
	});

	it("show networks returns the mock network list", async () => {
		const { mode, ctx } = makeSession();
		const out = await mode.parse("show networks", ctx);
		expect(out.type).toBe("table");
		if (out.type !== "table") return;
		expect(out.rows.length).toBeGreaterThan(0);
	});

	it("show connections lists edges after connect", async () => {
		const { mode, ctx } = makeSession();
		await mode.parse("init MyDSP", ctx);
		await mode.parse("add filters.svf as Filter1", ctx);
		await mode.parse("add control.pma as LFO1", ctx);
		await mode.parse("connect LFO1 to Filter1.Frequency", ctx);
		const out = await mode.parse("show connections", ctx);
		expect(out.type).toBe("table");
		if (out.type !== "table") return;
		expect(out.rows).toContainEqual(["LFO1", "0", "Filter1", "Frequency"]);
	});

	it("cd/ls navigate the graph", async () => {
		const { mode, ctx } = makeSession();
		await mode.parse("init MyDSP", ctx);
		await mode.parse("add core.oscillator as Osc1", ctx);
		const ls = await mode.parse("ls", ctx);
		expect(ls.type).toBe("table");
		if (ls.type !== "table") return;
		expect(ls.rows[0]?.[0]).toBe("Osc1");
	});
});
