import { describe, expect, it } from "vitest";
import { normalizeReplResponse } from "./contracts/repl.js";
import { normalizeStatusPayload } from "./contracts/status.js";
import {
	normalizeBuilderTree,
	normalizeBuilderTreeResponse,
	normalizeBuilderApplyResult,
	applyDiffToTree,
	type RawTreeNode,
	type BuilderDiffEntry,
} from "./contracts/builder.js";

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

	it("normalizes repl evaluation-failed envelopes", () => {
		const normalized = normalizeReplResponse({
			success: false,
			result: "Error at REPL Evaluation",
			value: "undefined",
			moduleId: "Interface",
			logs: [],
			errors: [{ errorMessage: "This expression is not a function!", callstack: ["eval() at Interface.js:1:1"] }],
		});

		expect(normalized).toMatchObject({
			kind: "success",
			success: false,
			moduleId: "Interface",
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

// ── Builder contract tests ──────────────────────────────────────────

// Minimal raw node factory for test fixtures
function rawNode(overrides: Partial<RawTreeNode> = {}): RawTreeNode {
	return {
		id: "SineSynth",
		processorId: "Osc 1",
		prettyName: "Sine Synthesiser",
		type: "SoundGenerator",
		subtype: "SoundGenerator",
		category: ["oscillator"],
		hasChildren: false,
		hasFX: false,
		bypassed: false,
		colour: "#414141",
		modulation: [],
		parameters: [],
		...overrides,
	};
}

describe("builder contract - normalizeBuilderTree", () => {
	it("converts a leaf module node", () => {
		const tree = normalizeBuilderTree(rawNode());
		expect(tree).toEqual({
			label: "Osc 1",
			id: "Osc 1",
			type: "SineSynth",
			nodeKind: "module",
		});
	});

	it("converts MIDI chain children", () => {
		const tree = normalizeBuilderTree(rawNode({
			midi: [rawNode({ id: "ScriptProcessor", processorId: "Interface" })],
		}));

		expect(tree.children).toHaveLength(1);
		const midiChain = tree.children![0]!;
		expect(midiChain.label).toBe("MIDI Processor Chain");
		expect(midiChain.nodeKind).toBe("chain");
		expect(midiChain.chainConstrainer).toBe("MidiProcessor");
		expect(midiChain.children).toHaveLength(1);
		expect(midiChain.children![0]!.label).toBe("Interface");
	});

	it("converts modulation chains with hex colours", () => {
		const tree = normalizeBuilderTree(rawNode({
			modulation: [
				{
					chainIndex: 1, id: "Gain Modulation", disabled: false,
					constrainer: "*", modulationMode: "gain", colour: "#BE952C",
					children: [],
				},
			],
		}));

		expect(tree.children).toHaveLength(1);
		const modChain = tree.children![0]!;
		expect(modChain.label).toBe("Gain Modulation");
		expect(modChain.nodeKind).toBe("chain");
		expect(modChain.chainConstrainer).toBe("*");
		expect(modChain.colour).toBe("#BE952C");
	});

	it("drops non-hex colour from disabled modulation chains", () => {
		const tree = normalizeBuilderTree(rawNode({
			modulation: [
				{
					chainIndex: 2, id: "Pitch Modulation", disabled: true,
					constrainer: "*", modulationMode: "pitch", colour: "0",
				},
			],
		}));

		const modChain = tree.children![0]!;
		expect(modChain.colour).toBeUndefined();
	});

	it("preserves hex colour on disabled modulation chains", () => {
		const tree = normalizeBuilderTree(rawNode({
			modulation: [
				{
					chainIndex: 2, id: "Pitch Modulation", disabled: true,
					constrainer: "*", modulationMode: "pitch", colour: "#808080",
				},
			],
		}));

		const modChain = tree.children![0]!;
		expect(modChain.colour).toBe("#808080");
	});

	it("converts FX chain children", () => {
		const tree = normalizeBuilderTree(rawNode({
			hasFX: true,
			fx_constrainer: "MasterEffect|MonophonicEffect",
			fx: [rawNode({ id: "SimpleGain", processorId: "Limiter" })],
		}));

		const fxChain = tree.children![0]!;
		expect(fxChain.label).toBe("FX Chain");
		expect(fxChain.nodeKind).toBe("chain");
		expect(fxChain.chainConstrainer).toBe("MasterEffect|MonophonicEffect");
		expect(fxChain.children).toHaveLength(1);
		expect(fxChain.children![0]!.label).toBe("Limiter");
	});

	it("shows empty FX chain when hasFX is true but fx array is empty", () => {
		const tree = normalizeBuilderTree(rawNode({
			hasFX: true,
			fx: [],
		}));

		// hasFX = true but empty array -> still rendered
		const fxChain = tree.children!.find(c => c.label === "FX Chain");
		expect(fxChain).toBeDefined();
		expect(fxChain!.children).toBeUndefined();
	});

	it("preserves child ordering: MIDI, modulation, FX, children", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain",
			processorId: "Master",
			hasChildren: true,
			hasFX: true,
			fx_constrainer: "MasterEffect",
			midi: [rawNode({ id: "ScriptProcessor", processorId: "Interface" })],
			modulation: [
				{
					chainIndex: 1, id: "Gain Modulation", disabled: false,
					constrainer: "TimeVariantModulator", modulationMode: "gain",
					colour: "#BE952C", children: [],
				},
			],
			fx: [rawNode({ id: "SimpleGain", processorId: "Output" })],
			children: [rawNode({ id: "SineSynth", processorId: "Osc 1" })],
		}));

		const labels = tree.children!.map(c => c.label);
		expect(labels).toEqual([
			"MIDI Processor Chain",
			"Gain Modulation",
			"FX Chain",
			"Osc 1",
		]);
	});

	it("recursively normalizes nested modulators inside modulation chains", () => {
		const tree = normalizeBuilderTree(rawNode({
			modulation: [
				{
					chainIndex: 1, id: "Gain Modulation", disabled: false,
					constrainer: "*", modulationMode: "gain", colour: "#BE952C",
					children: [rawNode({
						id: "AHDSR", processorId: "Volume Env",
						modulation: [
							{
								chainIndex: 0, id: "AttackTimeModulation", disabled: false,
								constrainer: "VoiceStartModulator", modulationMode: "gain",
								colour: "#BE952C", children: [],
							},
						],
					})],
				},
			],
		}));

		const gainChain = tree.children![0]!;
		const ahdsr = gainChain.children![0]!;
		expect(ahdsr.label).toBe("Volume Env");
		expect(ahdsr.type).toBe("AHDSR");
		expect(ahdsr.nodeKind).toBe("module");

		const attackMod = ahdsr.children![0]!;
		expect(attackMod.label).toBe("AttackTimeModulation");
		expect(attackMod.nodeKind).toBe("chain");
		expect(attackMod.chainConstrainer).toBe("VoiceStartModulator");
	});
});

describe("builder contract - normalizeBuilderTreeResponse", () => {
	it("rejects non-object input", () => {
		expect(() => normalizeBuilderTreeResponse(null)).toThrow("must be an object");
		expect(() => normalizeBuilderTreeResponse("foo")).toThrow("must be an object");
	});

	it("rejects objects without id/processorId", () => {
		expect(() => normalizeBuilderTreeResponse({ foo: "bar" })).toThrow("must have id and processorId");
	});

	it("accepts valid raw tree", () => {
		const tree = normalizeBuilderTreeResponse(rawNode());
		expect(tree.label).toBe("Osc 1");
		expect(tree.nodeKind).toBe("module");
	});
});

describe("builder contract - normalizeBuilderApplyResult", () => {
	it("returns null for null/undefined", () => {
		expect(normalizeBuilderApplyResult(null)).toBeNull();
		expect(normalizeBuilderApplyResult(undefined)).toBeNull();
	});

	it("rejects non-object input", () => {
		expect(() => normalizeBuilderApplyResult("foo")).toThrow("must be an object");
	});

	it("normalizes a valid apply result with diff", () => {
		const result = normalizeBuilderApplyResult({
			scope: "group",
			groupName: "Add reverb",
			diff: [
				{ domain: "builder", action: "+", target: "Hall Reverb" },
				{ domain: "builder", action: "*", target: "Master" },
			],
		});

		expect(result).toEqual({
			scope: "group",
			groupName: "Add reverb",
			diff: [
				{ domain: "builder", action: "+", target: "Hall Reverb" },
				{ domain: "builder", action: "*", target: "Master" },
			],
		});
	});

	it("defaults scope and groupName for missing fields", () => {
		const result = normalizeBuilderApplyResult({ diff: [] });
		expect(result!.scope).toBe("unknown");
		expect(result!.groupName).toBe("unknown");
		expect(result!.diff).toEqual([]);
	});

	it("handles missing diff array gracefully", () => {
		const result = normalizeBuilderApplyResult({ scope: "root" });
		expect(result!.diff).toEqual([]);
	});
});

describe("builder contract - applyDiffToTree", () => {
	it("marks added nodes", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master", hasChildren: true,
			children: [rawNode({ processorId: "Osc 1" })],
		}));

		const diff: BuilderDiffEntry[] = [
			{ domain: "builder", action: "+", target: "Osc 1" },
		];

		applyDiffToTree(tree, diff);
		const osc = tree.children![0]!;
		expect(osc.diff).toBe("added");
		expect(tree.diff).toBeUndefined(); // parent not in diff
	});

	it("marks removed nodes", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master", hasChildren: true,
			children: [rawNode({ processorId: "Old Synth" })],
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "-", target: "Old Synth" },
		]);

		expect(tree.children![0]!.diff).toBe("removed");
	});

	it("marks modified nodes", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master",
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "*", target: "Master" },
		]);

		expect(tree.diff).toBe("modified");
	});

	it("structural action (+) takes priority over modified (*)", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master", hasChildren: true,
			children: [rawNode({ processorId: "New Synth" })],
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "*", target: "New Synth" },
			{ domain: "builder", action: "+", target: "New Synth" },
		]);

		expect(tree.children![0]!.diff).toBe("added");
	});

	it("structural action (-) takes priority over modified (*)", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master", hasChildren: true,
			children: [rawNode({ processorId: "Old Synth" })],
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "*", target: "Old Synth" },
			{ domain: "builder", action: "-", target: "Old Synth" },
		]);

		expect(tree.children![0]!.diff).toBe("removed");
	});

	it("first structural action wins over later structural", () => {
		const tree = normalizeBuilderTree(rawNode({
			id: "SynthChain", processorId: "Master", hasChildren: true,
			children: [rawNode({ processorId: "Synth" })],
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "+", target: "Synth" },
			{ domain: "builder", action: "-", target: "Synth" },
		]);

		// first structural action sticks - later structural does not overwrite
		expect(tree.children![0]!.diff).toBe("added");
	});

	it("clears diff from nodes not in the diff list", () => {
		const tree = normalizeBuilderTree(rawNode({ processorId: "Master" }));
		tree.diff = "modified"; // pre-existing diff

		applyDiffToTree(tree, []); // empty diff

		expect(tree.diff).toBeUndefined();
	});

	it("ignores non-builder domain entries", () => {
		const tree = normalizeBuilderTree(rawNode({ processorId: "Master" }));

		applyDiffToTree(tree, [
			{ domain: "script", action: "*", target: "Master" },
		]);

		expect(tree.diff).toBeUndefined();
	});

	it("does not set diff on chain nodes", () => {
		const tree = normalizeBuilderTree(rawNode({
			modulation: [
				{
					chainIndex: 1, id: "Gain Modulation", disabled: false,
					constrainer: "*", modulationMode: "gain", colour: "#BE952C",
				},
			],
		}));

		applyDiffToTree(tree, [
			{ domain: "builder", action: "+", target: "Gain Modulation" },
		]);

		const chain = tree.children![0]!;
		expect(chain.nodeKind).toBe("chain");
		expect(chain.diff).toBeUndefined();
	});
});
