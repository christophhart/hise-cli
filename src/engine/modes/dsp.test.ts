// ── DSP mode tests ────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
	parseSingleDspCommand,
	parseDspInput,
	type DspCommand,
	type AddCommand,
	type ConnectCommand,
	type SetCommand,
	type GetCommand,
	type CreateParameterCommand,
} from "./dsp-parser.js";
import { commandToDspOps } from "./dsp-ops.js";
import { DspMode, parseDspScreenshotClauses } from "./dsp.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import {
	validateAddCommand,
	validateSetCommand,
	validateCreateParameterCommand,
} from "./dsp-validate.js";
import {
	normalizeDspList,
	normalizeDspTreeResponse,
	normalizeDspApplyResponse,
	normalizeDspInitResponse,
	normalizeDspSaveResponse,
	findDspNode,
	findDspParent,
	findDspConnectionTargeting,
	type RawDspNode,
} from "../../mock/contracts/dsp.js";
import type { ScriptnodeList } from "../data.js";

// ── Parser ────────────────────────────────────────────────────────

function parseOk(input: string): DspCommand {
	const res = parseSingleDspCommand(input);
	if ("error" in res) throw new Error(`Parse failed: ${res.error} (input: ${input})`);
	return res.command;
}

describe("dsp parser — show / navigation", () => {
	it("parses show networks", () => {
		const cmd = parseOk("show networks");
		expect(cmd).toEqual({ type: "show", what: "networks" });
	});
	it("parses show modules / tree / connections", () => {
		expect(parseOk("show modules")).toEqual({ type: "show", what: "modules" });
		expect(parseOk("show tree")).toEqual({ type: "show", what: "tree" });
		expect(parseOk("show connections")).toEqual({ type: "show", what: "connections" });
	});
	it("parses show <nodeId>", () => {
		expect(parseOk("show Osc1")).toEqual({ type: "show", what: "node", nodeId: "Osc1" });
	});
});

describe("dsp parser — lifecycle", () => {
	it("parses use <moduleId>", () => {
		const cmd = parseOk("use ScriptFX1");
		expect(cmd).toEqual({ type: "use", moduleId: "ScriptFX1" });
	});
	it("parses use with quoted multi-word moduleId", () => {
		const cmd = parseOk('use "Script FX1"');
		expect(cmd).toEqual({ type: "use", moduleId: "Script FX1" });
	});
	it("parses init <name> as auto mode", () => {
		const cmd = parseOk("init MyDSP");
		expect(cmd).toEqual({ type: "init", name: "MyDSP", mode: "auto" });
	});
	it("parses load <name> as load mode", () => {
		const cmd = parseOk("load MyDSP");
		expect(cmd).toEqual({ type: "init", name: "MyDSP", mode: "load" });
	});
	it("parses create <name> as create mode", () => {
		const cmd = parseOk("create MyDSP");
		expect(cmd).toEqual({ type: "init", name: "MyDSP", mode: "create" });
	});
	it("parses save", () => {
		expect(parseOk("save")).toEqual({ type: "save" });
	});
	it("parses reset", () => {
		expect(parseOk("reset")).toEqual({ type: "reset" });
	});
});

describe("dsp parser — graph mutations", () => {
	it("parses add factory.node", () => {
		const cmd = parseOk("add core.oscillator") as AddCommand;
		expect(cmd.type).toBe("add");
		expect(cmd.factoryPath).toBe("core.oscillator");
		expect(cmd.alias).toBeUndefined();
		expect(cmd.parent).toBeUndefined();
	});
	it("parses add with a factory node name that matches a verb keyword", () => {
		// Regression: scriptnode ships nodes whose names collide with DSP
		// verbs — `math.add`, `math.set`, `core.bypass` etc. The node slot
		// after `.` in addCommand must accept keyword tokens.
		const collisions = ["add", "set", "get", "show", "move", "remove", "save", "load", "create", "bypass"];
		for (const name of collisions) {
			const cmd = parseOk(`add math.${name}`) as AddCommand;
			expect(cmd.factoryPath.toLowerCase()).toBe(`math.${name}`);
		}
	});
	it("parses add with alias and parent", () => {
		const cmd = parseOk("add core.oscillator as Osc1 to Main") as AddCommand;
		expect(cmd.factoryPath).toBe("core.oscillator");
		expect(cmd.alias).toBe("Osc1");
		expect(cmd.parent).toBe("Main");
	});
	it("parses add with quoted alias", () => {
		const cmd = parseOk('add core.oscillator as "My Osc"') as AddCommand;
		expect(cmd.alias).toBe("My Osc");
	});
	it("parses remove", () => {
		expect(parseOk("remove Osc1")).toEqual({ type: "remove", nodeId: "Osc1" });
	});
	it("parses move with index", () => {
		expect(parseOk("move Osc1 to SubChain at 2")).toEqual({
			type: "move", nodeId: "Osc1", parent: "SubChain", index: 2,
		});
	});
	it("parses connect (default sourceOutput)", () => {
		const cmd = parseOk("connect LFO1 to Filter1.Frequency") as ConnectCommand;
		expect(cmd.type).toBe("connect");
		expect(cmd.source).toBe("LFO1");
		expect(cmd.sourceOutput).toBeUndefined();
		expect(cmd.target).toBe("Filter1");
		expect(cmd.parameter).toBe("Frequency");
	});
	it("parses connect with explicit sourceOutput (string name)", () => {
		const cmd = parseOk("connect env1.Value to Filter1.Cutoff") as ConnectCommand;
		expect(cmd.sourceOutput).toBe("Value");
	});
	it("parses connect with numeric sourceOutput (slot index)", () => {
		const cmd = parseOk("connect xfader1.1 to gain1.Gain") as ConnectCommand;
		expect(cmd.source).toBe("xfader1");
		expect(cmd.sourceOutput).toBe(1);
		expect(typeof cmd.sourceOutput).toBe("number");
		expect(cmd.target).toBe("gain1");
		expect(cmd.parameter).toBe("Gain");
	});
	it("parses connect with numeric sourceOutput 0", () => {
		const cmd = parseOk("connect xfader1.0 to gain1.Gain") as ConnectCommand;
		expect(cmd.sourceOutput).toBe(0);
	});
	it("parses connect with no target parameter (routing shorthand)", () => {
		// `connect SEND to RCV` — HISE resolves the default routing target
		// server-side and maps this to a set on SEND.Connection.
		const cmd = parseOk("connect SEND to RCV") as ConnectCommand;
		expect(cmd.type).toBe("connect");
		expect(cmd.source).toBe("SEND");
		expect(cmd.target).toBe("RCV");
		expect(cmd.parameter).toBeUndefined();
		expect(cmd.sourceOutput).toBeUndefined();
	});
	it("parses disconnect", () => {
		expect(parseOk("disconnect LFO1 from Filter1.Frequency")).toEqual({
			type: "disconnect", source: "LFO1", target: "Filter1", parameter: "Frequency",
		});
	});
	it("parses set with number", () => {
		const cmd = parseOk("set Osc1.Frequency 440") as SetCommand;
		expect(cmd).toEqual({
			type: "set", nodeId: "Osc1", parameterId: "Frequency", value: 440,
		});
	});
	it("parses set with `to` and float", () => {
		const cmd = parseOk("set Filter1.Q to 0.5") as SetCommand;
		expect(cmd.value).toBe(0.5);
	});
	it("parses set with quoted string value", () => {
		const cmd = parseOk('set Osc1.Mode "Saw"') as SetCommand;
		expect(cmd.value).toBe("Saw");
	});
	it("parses set with enum identifier value", () => {
		const cmd = parseOk("set Osc1.Mode Sine") as SetCommand;
		expect(cmd.value).toBe("Sine");
	});
	it("parses set with hex literal (0xAARRGGBB)", () => {
		const cmd = parseOk("set Osc1.NodeColour 0xFF00AABB") as SetCommand;
		expect(cmd.value).toBe(0xFF00AABB);
		expect(typeof cmd.value).toBe("number");
	});
	it("parses set with lowercase hex literal", () => {
		const cmd = parseOk("set Osc1.NodeColour 0xff00aabb") as SetCommand;
		expect(cmd.value).toBe(0xFF00AABB);
	});
	it("parses set with parameter name that starts with a verb keyword (Connection)", () => {
		// Regression: lexer used to match `connect` as keyword prefix of `Connection`,
		// rejecting `set SEND.Connection RCV` as a parse error.
		const cmd = parseOk("set SEND.Connection RCV") as SetCommand;
		expect(cmd).toEqual({
			type: "set", nodeId: "SEND", parameterId: "Connection", value: "RCV",
		});
	});
	it("parses set when parameter name exact-matches a verb keyword", () => {
		// The property slot after `.` accepts any keyword token — grammar is
		// unambiguous there, so `Show`, `Add`, `Save`, `Load`, `Create` etc.
		// must parse as parameter names, not as verbs.
		const collisions = ["Show", "Add", "Save", "Load", "Create", "Set", "Get", "Move", "Remove", "Reset", "Init", "Enable", "Bypass", "Connect", "Disconnect"];
		for (const name of collisions) {
			const cmd = parseOk(`set Osc1.${name} 1`) as SetCommand;
			expect(cmd.parameterId.toLowerCase()).toBe(name.toLowerCase());
			expect(cmd.value).toBe(1);
		}
	});
	it("parses get <node>.<keyword-property>", () => {
		const cmd = parseOk("get Osc1.Show");
		expect(cmd.type).toBe("get");
		if (cmd.type === "get" && cmd.query === "param") {
			expect(cmd.parameterId.toLowerCase()).toBe("show");
		}
	});
	it("parses get source of <node>.<keyword-property>", () => {
		const cmd = parseOk("get source of Osc1.Load");
		expect(cmd.type).toBe("get");
		if (cmd.type === "get" && cmd.query === "source") {
			expect(cmd.parameterId.toLowerCase()).toBe("load");
		}
	});
	it("parses connect with keyword-named target parameter", () => {
		const cmd = parseOk("connect LFO1 to Filter1.Save") as ConnectCommand;
		expect(cmd.parameter?.toLowerCase()).toBe("save");
	});
	it("parses disconnect with keyword-named target parameter", () => {
		const res = parseSingleDspCommand("disconnect LFO1 from Filter1.Create");
		if ("error" in res) throw new Error(res.error);
		expect(res.command.type).toBe("disconnect");
		if (res.command.type === "disconnect") {
			expect(res.command.parameter.toLowerCase()).toBe("create");
		}
	});
	it("parses create_parameter with keyword-named parameter", () => {
		const cmd = parseOk("create_parameter Main.Save") as CreateParameterCommand;
		expect(cmd.parameterId.toLowerCase()).toBe("save");
	});
	it("still tokenises `connect` as the modulation verb", () => {
		const cmd = parseOk("connect LFO1 to F1.Cutoff") as ConnectCommand;
		expect(cmd.type).toBe("connect");
	});
	it("still tokenises `show connections`", () => {
		expect(parseOk("show connections")).toEqual({ type: "show", what: "connections" });
	});
	it("parses bypass / enable", () => {
		expect(parseOk("bypass Osc1")).toEqual({ type: "bypass", nodeId: "Osc1" });
		expect(parseOk("enable Osc1")).toEqual({ type: "enable", nodeId: "Osc1" });
	});
	it("parses create_parameter bare", () => {
		const cmd = parseOk("create_parameter Main.Cutoff") as CreateParameterCommand;
		expect(cmd.type).toBe("create_parameter");
		expect(cmd.nodeId).toBe("Main");
		expect(cmd.parameterId).toBe("Cutoff");
	});
	it("parses create_parameter with range and defaults", () => {
		const cmd = parseOk("create_parameter Main.Cutoff 20 20000 default 1000 step 1") as CreateParameterCommand;
		expect(cmd.min).toBe(20);
		expect(cmd.max).toBe(20000);
		expect(cmd.defaultValue).toBe(1000);
		expect(cmd.stepSize).toBe(1);
	});
});

describe("dsp parser — get variants", () => {
	it("parses get <nodeId>", () => {
		expect(parseOk("get Osc1")).toEqual({ type: "get", query: "factory", nodeId: "Osc1" });
	});
	it("parses get <node>.<param>", () => {
		expect(parseOk("get Osc1.Frequency")).toEqual({
			type: "get", query: "param", nodeId: "Osc1", parameterId: "Frequency",
		});
	});
	it("parses get source of <node>.<param>", () => {
		expect(parseOk("get source of Filter1.Frequency")).toEqual({
			type: "get", query: "source", nodeId: "Filter1", parameterId: "Frequency",
		});
	});
	it("parses get parent of <node>.<param>", () => {
		expect(parseOk("get parent of Osc1.Frequency")).toEqual({
			type: "get", query: "parent", nodeId: "Osc1", parameterId: "Frequency",
		});
	});
});

describe("dsp parser — comma chaining", () => {
	it("chains two explicit verbs", () => {
		const res = parseDspInput("add core.oscillator as Osc1, set Osc1.Frequency 440");
		expect("commands" in res).toBe(true);
		if (!("commands" in res)) return;
		expect(res.commands).toHaveLength(2);
		expect(res.commands[0]!.type).toBe("add");
		expect(res.commands[1]!.type).toBe("set");
	});
	it("inherits verb across segments", () => {
		const res = parseDspInput("add core.oscillator as Osc1, core.gain as G1");
		if (!("commands" in res)) throw new Error("expected commands");
		expect(res.commands).toHaveLength(2);
		expect(res.commands[0]!.type).toBe("add");
		expect(res.commands[1]!.type).toBe("add");
	});
	it("reports error with no verb to inherit", () => {
		const res = parseDspInput("Osc1");
		expect("error" in res).toBe(true);
	});
});

// ── Command → op translation ──────────────────────────────────────

describe("commandToDspOps — field names match openapi", () => {
	const emptyTree: RawDspNode = {
		nodeId: "Main",
		factoryPath: "container.chain",
		bypassed: false,
		parameters: [],
		connections: [],
		children: [],
	};

	it("add uses factoryPath and parent, not path/id", () => {
		const res = commandToDspOps(
			{ type: "add", factoryPath: "core.oscillator", alias: "Osc1" },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "add", factoryPath: "core.oscillator", parent: "Main", nodeId: "Osc1",
		});
	});

	it("add without parent falls back to CWD", () => {
		const res = commandToDspOps(
			{ type: "add", factoryPath: "core.gain" },
			emptyTree,
			["SubChain"],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]!.parent).toBe("SubChain");
	});

	it("add without parent falls back to root when CWD is empty", () => {
		const res = commandToDspOps(
			{ type: "add", factoryPath: "core.oscillator" },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]!.parent).toBe("Main");
	});

	it("set uses nodeId and parameterId, not node/id", () => {
		const res = commandToDspOps(
			{ type: "set", nodeId: "Osc1", parameterId: "Frequency", value: 440 },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "set", nodeId: "Osc1", parameterId: "Frequency", value: 440,
		});
	});

	it("connect uses source/target/parameter with optional sourceOutput", () => {
		const res = commandToDspOps(
			{ type: "connect", source: "LFO1", target: "Filter1", parameter: "Frequency" },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "connect", source: "LFO1", target: "Filter1", parameter: "Frequency",
		});
	});

	it("connect with sourceOutput includes the field", () => {
		const res = commandToDspOps(
			{ type: "connect", source: "env1", sourceOutput: "Value", target: "Filter1", parameter: "Cutoff" },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "connect", source: "env1", sourceOutput: "Value",
			target: "Filter1", parameter: "Cutoff",
		});
	});

	it("connect preserves numeric sourceOutput as a number on the wire", () => {
		const res = commandToDspOps(
			{ type: "connect", source: "xfader1", sourceOutput: 1, target: "gain1", parameter: "Gain" },
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "connect", source: "xfader1", sourceOutput: 1,
			target: "gain1", parameter: "Gain",
		});
		expect(typeof (res.ops[0] as unknown as { sourceOutput: unknown }).sourceOutput).toBe("number");
	});

	it("connect without target parameter omits the parameter field in the op", () => {
		const res = commandToDspOps(
			{ type: "connect", source: "SEND", target: "RCV" } as ConnectCommand,
			emptyTree, [],
		);
		if ("error" in res) throw new Error(res.error);
		const op = res.ops[0] as Record<string, unknown>;
		expect(op).toEqual({ op: "connect", source: "SEND", target: "RCV" });
		expect(op).not.toHaveProperty("parameter");
		expect(op).not.toHaveProperty("sourceOutput");
	});

	it("reset translates to clear op", () => {
		const res = commandToDspOps({ type: "reset" }, emptyTree, []);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({ op: "clear" });
	});

	it("create_parameter preserves canonical range IDs", () => {
		const res = commandToDspOps(
			{
				type: "create_parameter",
				nodeId: "Main",
				parameterId: "Cutoff",
				min: 20, max: 20000, defaultValue: 1000, stepSize: 1,
			},
			emptyTree,
			[],
		);
		if ("error" in res) throw new Error(res.error);
		expect(res.ops[0]).toEqual({
			op: "create_parameter", nodeId: "Main", parameterId: "Cutoff",
			min: 20, max: 20000, defaultValue: 1000, stepSize: 1,
		});
	});

	it("bypass and enable both emit {op:'bypass', bypassed}", () => {
		const b = commandToDspOps({ type: "bypass", nodeId: "Osc1" }, emptyTree, []);
		if ("error" in b) throw new Error(b.error);
		expect(b.ops[0]).toEqual({ op: "bypass", nodeId: "Osc1", bypassed: true });
		const e = commandToDspOps({ type: "enable", nodeId: "Osc1" }, emptyTree, []);
		if ("error" in e) throw new Error(e.error);
		expect(e.ops[0]).toEqual({ op: "bypass", nodeId: "Osc1", bypassed: false });
	});

	it("local-only commands (get/show/use/init/save) produce no ops", () => {
		const g = commandToDspOps(
			{ type: "get", query: "factory", nodeId: "X" } as GetCommand,
			emptyTree,
			[],
		);
		if ("error" in g) throw new Error(g.error);
		expect(g.ops).toEqual([]);
	});
});

// ── Validation ────────────────────────────────────────────────────

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
				parameterIndex: 0,
				id: "Frequency",
				metadataType: "static",
				description: "",
				type: "Slider",
				disabled: false,
				range: { min: 20, max: 20000, stepSize: 0 },
				defaultValue: 440,
			},
			{
				parameterIndex: 1,
				id: "Mode",
				metadataType: "static",
				description: "",
				type: "ComboBox",
				disabled: false,
				range: { min: 0, max: 4, stepSize: 1 },
				defaultValue: 0,
			},
		],
		modulation: [],
		hasMidi: false,
		properties: {},
		interfaces: [],
	},
	"container.chain": {
		id: "chain",
		description: "",
		type: "polyphonic",
		subtype: "",
		category: [],
		hasChildren: true,
		hasFX: false,
		metadataType: "static",
		parameters: [],
		modulation: [],
		hasMidi: false,
		properties: {},
		interfaces: [],
	},
	"control.cable_expr": {
		id: "cable_expr",
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
		properties: { Code: "input", Debug: false },
		interfaces: [],
	},
};

describe("dsp-validate — add", () => {
	it("accepts known factory paths", () => {
		const v = validateAddCommand(
			{ type: "add", factoryPath: "core.oscillator" },
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("rejects unknown factory paths with suggestion", () => {
		const v = validateAddCommand(
			{ type: "add", factoryPath: "core.oscilator" },
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/Unknown factory path/);
		expect(v.suggestions?.[0]).toBe("core.oscillator");
	});
});

describe("dsp-validate — set", () => {
	it("rejects unknown parameter", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Bogus", value: 1 },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/Unknown parameter/);
	});
	it("rejects value out of range", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Frequency", value: 99999 },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/out of range/);
	});
	it("accepts valid range", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Frequency", value: 440 },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("skips validation when factoryPath unknown", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "X", parameterId: "Y", value: 1 },
			null,
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("accepts universal property Comment", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Comment", value: "hi" },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("accepts universal property Folded", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Folded", value: "true" },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("accepts container property IsVertical on container node", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Main", parameterId: "IsVertical", value: "true" },
			"container.chain",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("rejects container-only property on leaf node", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "IsVertical", value: "true" },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/Unknown parameter/);
	});
	it("accepts factory-specific property Code", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Expr1", parameterId: "Code", value: "input * 2" },
			"control.cable_expr",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("accepts factory-specific property Debug", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Expr1", parameterId: "Debug", value: "true" },
			"control.cable_expr",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("suggests Comment for typo Commnt", () => {
		const v = validateSetCommand(
			{ type: "set", nodeId: "Osc1", parameterId: "Commnt", value: "hi" },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/Did you mean "Comment"/);
	});
});

describe("dsp-validate — create_parameter", () => {
	it("rejects on non-container", () => {
		const v = validateCreateParameterCommand(
			{ type: "create_parameter", nodeId: "Osc1", parameterId: "X" },
			"core.oscillator",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
		expect(v.errors[0]).toMatch(/not a container/);
	});
	it("accepts on container", () => {
		const v = validateCreateParameterCommand(
			{ type: "create_parameter", nodeId: "Main", parameterId: "Cutoff", min: 0, max: 1 },
			"container.chain",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(true);
	});
	it("rejects inverted range", () => {
		const v = validateCreateParameterCommand(
			{ type: "create_parameter", nodeId: "Main", parameterId: "X", min: 10, max: 5 },
			"container.chain",
			scriptnodeFixture,
		);
		expect(v.valid).toBe(false);
	});
});

// ── Contract normalization ───────────────────────────────────────

describe("dsp contract — normalizeDspList", () => {
	it("returns string array", () => {
		expect(normalizeDspList(["A", "B"])).toEqual(["A", "B"]);
	});
	it("throws on non-array", () => {
		expect(() => normalizeDspList({} as unknown)).toThrow();
	});
	it("throws on non-string entry", () => {
		expect(() => normalizeDspList([1] as unknown)).toThrow();
	});
});

describe("dsp contract — normalizeDspTreeResponse", () => {
	const valid = {
		nodeId: "Main",
		factoryPath: "container.chain",
		bypassed: false,
		parameters: [],
		connections: [],
		children: [
			{
				nodeId: "Osc1",
				factoryPath: "core.oscillator",
				bypassed: false,
				parameters: [{ parameterId: "Frequency", value: 440 }],
				children: [],
			},
		],
	};

	it("validates and normalizes a valid tree", () => {
		const { raw, tree } = normalizeDspTreeResponse(valid);
		expect(raw.nodeId).toBe("Main");
		expect(tree.label).toBe("Main");
		expect(tree.nodeKind).toBe("chain");
		expect(tree.children?.[0]?.label).toBe("Osc1");
		expect(tree.children?.[0]?.nodeKind).toBe("module");
		expect(tree.children?.[0]?.type).toBe("core.oscillator");
	});

	it("throws on missing required field", () => {
		expect(() => normalizeDspTreeResponse({ factoryPath: "x" })).toThrow();
	});

	it("throws on missing parameters array", () => {
		expect(() => normalizeDspTreeResponse({
			nodeId: "Main", factoryPath: "container.chain", bypassed: false,
			children: [],
		})).toThrow();
	});

	it("throws on invalid parameter shape", () => {
		expect(() => normalizeDspTreeResponse({
			nodeId: "Main", factoryPath: "container.chain", bypassed: false,
			parameters: [{ value: 1 }], children: [],
		})).toThrow();
	});
});

describe("dsp contract — normalizeDspApplyResponse", () => {
	it("normalizes scope + groupName + diff", () => {
		const r = normalizeDspApplyResponse({
			scope: "root",
			groupName: "",
			diff: [
				{ domain: "dsp", action: "+", target: "Osc1" },
				{ domain: "dsp", action: "*", target: "Osc1" },
			],
		});
		expect(r.scope).toBe("root");
		expect(r.diff).toHaveLength(2);
		expect(r.diff[0]!.action).toBe("+");
	});

	it("defaults missing fields gracefully", () => {
		const r = normalizeDspApplyResponse({});
		expect(r.scope).toBe("unknown");
		expect(r.diff).toEqual([]);
	});
});

describe("dsp contract — normalizeDspInitResponse", () => {
	it("parses full init response with source=created", () => {
		const r = normalizeDspInitResponse({
			result: {
				nodeId: "MyDSP", factoryPath: "container.chain",
				bypassed: false, parameters: [], connections: [], children: [],
			},
			filePath: "/proj/DspNetworks/MyDSP.xml",
			source: "created",
		});
		expect(r.filePath).toBe("/proj/DspNetworks/MyDSP.xml");
		expect(r.source).toBe("created");
		expect(r.tree.nodeId).toBe("MyDSP");
	});

	it("parses full init response with source=loaded", () => {
		const r = normalizeDspInitResponse({
			result: {
				nodeId: "MyDSP", factoryPath: "container.chain",
				bypassed: false, parameters: [], connections: [], children: [],
			},
			filePath: "/proj/DspNetworks/MyDSP.xml",
			source: "loaded",
		});
		expect(r.source).toBe("loaded");
	});

	it("throws when result tree is missing", () => {
		expect(() => normalizeDspInitResponse({ filePath: "", source: "created" })).toThrow();
	});

	it("throws when source is missing or invalid", () => {
		const tree = {
			nodeId: "X", factoryPath: "container.chain",
			bypassed: false, parameters: [], connections: [], children: [],
		};
		expect(() => normalizeDspInitResponse({ result: tree, filePath: "x.xml" })).toThrow();
		expect(() => normalizeDspInitResponse({ result: tree, filePath: "x.xml", source: "bogus" })).toThrow();
	});
});

describe("dsp contract — normalizeDspSaveResponse", () => {
	it("extracts filePath", () => {
		const r = normalizeDspSaveResponse({ filePath: "/path/to/x.xml" });
		expect(r.filePath).toBe("/path/to/x.xml");
	});
	it("throws on missing filePath", () => {
		expect(() => normalizeDspSaveResponse({})).toThrow();
	});
});

// ── Raw-tree query helpers (used by `get` commands) ──────────────

describe("raw-tree helpers for `get` resolution", () => {
	const tree: RawDspNode = {
		nodeId: "Main",
		factoryPath: "container.chain",
		bypassed: false,
		parameters: [],
		connections: [
			{ source: "LFO1", sourceOutput: "Value", target: "Filter1", parameter: "Frequency" },
		],
		children: [
			{
				nodeId: "Osc1",
				factoryPath: "core.oscillator",
				bypassed: false,
				parameters: [{ parameterId: "Frequency", value: 440 }],
				children: [],
			},
			{
				nodeId: "Filter1",
				factoryPath: "filters.svf",
				bypassed: false,
				parameters: [{ parameterId: "Frequency", value: 2000 }, { parameterId: "Q", value: 0.5 }],
				children: [],
			},
			{
				nodeId: "LFO1",
				factoryPath: "control.pma",
				bypassed: false,
				parameters: [{ parameterId: "Value", value: 0 }],
				children: [],
			},
		],
	};

	it("findDspNode returns nodes by id", () => {
		expect(findDspNode(tree, "Osc1")?.factoryPath).toBe("core.oscillator");
		expect(findDspNode(tree, "bogus")).toBeNull();
	});

	it("findDspParent returns owner of child", () => {
		expect(findDspParent(tree, "Osc1")?.nodeId).toBe("Main");
		expect(findDspParent(tree, "Main")).toBeNull();
	});

	it("findDspConnectionTargeting returns modulation source", () => {
		const c = findDspConnectionTargeting(tree, "Filter1", "Frequency");
		expect(c?.source).toBe("LFO1");
		expect(findDspConnectionTargeting(tree, "Filter1", "Q")).toBeNull();
	});
});

// ── Screenshot clause parser ───────────────────────────────────────

describe("parseDspScreenshotClauses", () => {
	it("returns empty opts for empty input", () => {
		expect(parseDspScreenshotClauses("")).toEqual({});
	});

	it("parses 'at 50%' as scale 0.5", () => {
		expect(parseDspScreenshotClauses("at 50%")).toEqual({ scale: 0.5 });
	});

	it("parses 'at 0.5' as scale 0.5", () => {
		expect(parseDspScreenshotClauses("at 0.5")).toEqual({ scale: 0.5 });
	});

	it("parses 'at 2.0' as scale 2.0", () => {
		expect(parseDspScreenshotClauses("at 2.0")).toEqual({ scale: 2.0 });
	});

	it("parses 'to <path>'", () => {
		expect(parseDspScreenshotClauses("to foo.png")).toEqual({ outputPath: "foo.png" });
	});

	it("parses combined clauses in any order", () => {
		expect(parseDspScreenshotClauses("at 2.0 to out.png"))
			.toEqual({ scale: 2.0, outputPath: "out.png" });
		expect(parseDspScreenshotClauses("to out.png at 0.5"))
			.toEqual({ scale: 0.5, outputPath: "out.png" });
	});

	it("rejects unsupported scale (75%)", () => {
		const res = parseDspScreenshotClauses("at 75%");
		expect(typeof res).toBe("string");
		expect(res as string).toContain("Invalid scale");
	});

	it("rejects unsupported scale (1.5)", () => {
		const res = parseDspScreenshotClauses("at 1.5");
		expect(typeof res).toBe("string");
		expect(res as string).toContain("Invalid scale");
	});

	it("rejects non-png output path", () => {
		const res = parseDspScreenshotClauses("to out.jpg");
		expect(typeof res).toBe("string");
		expect(res as string).toContain(".png");
	});

	it("strips leading slash from relative path", () => {
		expect(parseDspScreenshotClauses("to /subfolder/screenshot.png"))
			.toEqual({ outputPath: "subfolder/screenshot.png" });
	});

	it("strips leading backslash from relative path", () => {
		expect(parseDspScreenshotClauses("to \\subfolder\\screenshot.png"))
			.toEqual({ outputPath: "subfolder/screenshot.png" });
	});

	it("preserves absolute path with drive letter", () => {
		expect(parseDspScreenshotClauses("to D:/Projects/graph.png"))
			.toEqual({ outputPath: "D:/Projects/graph.png" });
	});

	it("normalizes backslashes to forward slashes", () => {
		expect(parseDspScreenshotClauses("to sub\\dir\\graph.png"))
			.toEqual({ outputPath: "sub/dir/graph.png" });
	});

	it("preserves plain relative path with subfolders", () => {
		expect(parseDspScreenshotClauses("to subfolder/screenshot.png"))
			.toEqual({ outputPath: "subfolder/screenshot.png" });
	});
});

// ── DspMode screenshot command ─────────────────────────────────────

describe("DspMode screenshot", () => {
	function mockSession(mock: MockHiseConnection | null): SessionContext {
		return {
			connection: mock,
			projectName: null,
			projectFolder: null,
			popMode: () => ({ type: "text", content: "Exited DSP mode." }),
		};
	}

	function makeMode(withModule: boolean): DspMode {
		const mode = new DspMode();
		if (withModule) mode.setContext("Script FX1");
		return mode;
	}

	it("errors without module context", async () => {
		const mode = makeMode(false);
		const mock = new MockHiseConnection();
		const result = await mode.parse("screenshot", mockSession(mock));
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("module context");
		}
	});

	it("errors without connection", async () => {
		const mode = makeMode(true);
		const result = await mode.parse("screenshot", mockSession(null));
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("HISE connection");
		}
	});

	it("defaults to screenshot.png and sends moduleId", async () => {
		const mode = makeMode(true);
		const mock = new MockHiseConnection();
		mock.onGet("/api/dsp/screenshot", () => ({
			success: true as const,
			moduleId: "Script FX1",
			width: 800, height: 600, scale: 1.0,
			filePath: "D:/Projects/Test/Images/screenshot.png",
			logs: [],
			errors: [],
		}));

		const result = await mode.parse("screenshot", mockSession(mock));
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("screenshot.png");
			expect(result.content).toContain("800x600");
		}
		const call = mock.calls.find((c) => c.endpoint.startsWith("/api/dsp/screenshot"));
		expect(call).toBeDefined();
		expect(call!.endpoint).toContain("moduleId=Script+FX1");
		expect(call!.endpoint).toContain("outputPath=screenshot.png");
		expect(call!.endpoint).not.toContain("scale=");
	});

	it("sends scale when provided via 'at 50%'", async () => {
		const mode = makeMode(true);
		const mock = new MockHiseConnection();
		mock.onGet("/api/dsp/screenshot", () => ({
			success: true as const,
			moduleId: "Script FX1",
			width: 400, height: 300, scale: 0.5,
			filePath: "D:/Projects/Test/Images/screenshot.png",
			logs: [],
			errors: [],
		}));

		await mode.parse("screenshot at 50%", mockSession(mock));
		const call = mock.calls.find((c) => c.endpoint.startsWith("/api/dsp/screenshot"));
		expect(call!.endpoint).toContain("scale=0.5");
	});

	it("sends custom output path and scale together", async () => {
		const mode = makeMode(true);
		const mock = new MockHiseConnection();
		mock.onGet("/api/dsp/screenshot", () => ({
			success: true as const,
			moduleId: "Script FX1",
			width: 1600, height: 1200, scale: 2.0,
			filePath: "D:/Projects/Test/Images/graph.png",
			logs: [],
			errors: [],
		}));

		const result = await mode.parse("screenshot at 2.0 to graph.png", mockSession(mock));
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("graph.png");
			expect(result.content).toContain("1600x1200");
		}
		const call = mock.calls.find((c) => c.endpoint.startsWith("/api/dsp/screenshot"));
		expect(call!.endpoint).toContain("scale=2");
		expect(call!.endpoint).toContain("outputPath=graph.png");
	});

	it("rejects invalid scale before hitting the API", async () => {
		const mode = makeMode(true);
		const mock = new MockHiseConnection();
		mock.onGet("/api/dsp/screenshot", () => ({
			success: true as const,
			width: 0, height: 0,
			logs: [],
			errors: [],
		}));

		const result = await mode.parse("screenshot at 75%", mockSession(mock));
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Invalid scale");
		}
		expect(mock.calls.filter((c) => c.endpoint.includes("/api/dsp/screenshot"))).toHaveLength(0);
	});

	it("surfaces envelope error messages", async () => {
		const mode = makeMode(true);
		const mock = new MockHiseConnection();
		mock.onGet("/api/dsp/screenshot", () => ({
			success: false as const,
			logs: [],
			errors: [{ errorMessage: "Headless mode", callstack: [] }],
		}));

		const result = await mode.parse("screenshot", mockSession(mock));
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Headless mode");
		}
	});

	it("completes 'at' and 'to' keywords after screenshot", () => {
		const mode = makeMode(true);
		const res = mode.complete!("screenshot a", "screenshot a".length);
		expect(res.items.some((i) => i.label === "at")).toBe(true);
	});
});

describe("DspMode show <nodeId>", () => {
	function mockSession(mock: MockHiseConnection | null): SessionContext {
		return {
			connection: mock,
			projectName: null,
			projectFolder: null,
			popMode: () => ({ type: "text", content: "Exited DSP mode." }),
		};
	}

	const verboseTree = {
		nodeId: "sfx",
		factoryPath: "container.chain",
		bypassed: false,
		parameters: [],
		properties: [
			{ propertyId: "Bypassed", value: false },
			{ propertyId: "NodeColour", value: 0 },
			{ propertyId: "Name", value: "sfx" },
			{ propertyId: "Comment", value: "" },
			{ propertyId: "IsVertical", value: true },
		],
		connections: [
			{ source: "xfader", sourceOutput: 1, target: "receive", parameter: "Feedback" },
			{ source: "peak", sourceOutput: 0, target: "mul", parameter: "Value" },
		],
		children: [
			{
				nodeId: "xfader",
				factoryPath: "control.xfader",
				bypassed: false,
				parameters: [
					{
						parameterId: "Value", value: 0,
						min: 0, max: 1, stepSize: 0, defaultValue: 0,
					},
				],
				properties: [
					{ propertyId: "Name", value: "xfader" },
					{ propertyId: "Comment", value: "crossfader" },
					{ propertyId: "Mode", value: "Linear" },
				],
				children: [],
			},
			{
				nodeId: "mul",
				factoryPath: "math.mul",
				bypassed: false,
				parameters: [
					{
						parameterId: "Value", value: 1,
						min: 0, max: 1, stepSize: 0, defaultValue: 1,
					},
				],
				children: [],
			},
		],
	};

	function makeMock(): MockHiseConnection {
		const mock = new MockHiseConnection();
		mock.onGet("/api/undo/diff", () => ({
			success: true as const, groupName: "root", logs: [], errors: [],
		}));
		mock.onGet("/api/dsp/tree", () => ({
			success: true as const, result: verboseTree, logs: [], errors: [],
		}));
		return mock;
	}

	it("renders header, properties, parameters, modulation for a leaf node", async () => {
		const mode = new DspMode();
		mode.setContext("sfx");
		const mock = makeMock();
		const result = await mode.parse("show xfader", mockSession(mock));
		expect(result.type).toBe("preformatted");
		if (result.type !== "preformatted") return;
		const content = result.content;
		expect(content).toContain("control.xfader");
		expect(content).toContain("xfader");
		expect(content).toContain("parent: sfx");
		expect(content).toContain("bypassed: no");
		expect(content).toContain("Comment");
		expect(content).toContain('"crossfader"');
		expect(content).toContain("Mode");
		expect(content).toContain('"Linear"');
		expect(content).toContain("Parameters");
		expect(content).toContain("Value");
		expect(content).toContain("range 0 - 1");
		expect(content).toContain("default 0");
		expect(content).toContain("Modulation");
		expect(content).toContain("out -> receive.Feedback");
		expect(content).toContain("in  <- (none)");
	});

	it("shows incoming edge for target node", async () => {
		const mode = new DspMode();
		mode.setContext("sfx");
		const mock = makeMock();
		const result = await mode.parse("show mul", mockSession(mock));
		if (result.type !== "preformatted") throw new Error("expected preformatted");
		expect(result.content).toContain("in  <- peak");
		expect(result.content).toContain("out -> (none)");
	});

	it("errors without a module context", async () => {
		const mode = new DspMode();
		const mock = makeMock();
		const result = await mode.parse("show xfader", mockSession(mock));
		expect(result.type).toBe("error");
		if (result.type === "error") expect(result.message).toContain("module context");
	});

	it("errors when node is not found", async () => {
		const mode = new DspMode();
		mode.setContext("sfx");
		const mock = makeMock();
		const result = await mode.parse("show bogus", mockSession(mock));
		expect(result.type).toBe("error");
		if (result.type === "error") expect(result.message).toContain('"bogus" not found');
	});

	it("uses verbose=true on the tree fetch", async () => {
		const mode = new DspMode();
		mode.setContext("sfx");
		const mock = makeMock();
		await mode.parse("show xfader", mockSession(mock));
		const hit = mock.calls.find((c) =>
			c.endpoint.startsWith("/api/dsp/tree") && c.endpoint.includes("verbose=true"),
		);
		expect(hit).toBeDefined();
	});
});
