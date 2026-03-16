import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import {
	BuilderMode,
	parseBuilderInput,
	validateAddCommand,
	validateSetCommand,
} from "./builder.js";
import type { ModuleList } from "../data.js";
import type { SessionContext } from "./mode.js";
import { CompletionEngine, buildDatasets } from "../completion/engine.js";

// ── Load module list for validation tests ───────────────────────────

let moduleList: ModuleList;

beforeAll(() => {
	const dataDir = path.resolve(import.meta.dirname, "../../../data");
	const raw = fs.readFileSync(
		path.join(dataDir, "moduleList.json"),
		"utf8",
	);
	moduleList = JSON.parse(raw) as ModuleList;
});

const nullSession: SessionContext = { connection: null };

// ── Parser tests ────────────────────────────────────────────────────

describe("builder parser — add commands", () => {
	it("parses simple add", () => {
		const result = parseBuilderInput("add AHDSR");
		expect("command" in result).toBe(true);
		if ("command" in result) {
			expect(result.command.type).toBe("add");
			if (result.command.type === "add") {
				expect(result.command.moduleType).toBe("AHDSR");
			}
		}
	});

	it("parses add with alias", () => {
		const result = parseBuilderInput('add StreamingSampler as "MySampler"');
		if ("command" in result && result.command.type === "add") {
			expect(result.command.moduleType).toBe("StreamingSampler");
			expect(result.command.alias).toBe("MySampler");
		}
	});

	it("parses add with target", () => {
		const result = parseBuilderInput("add AHDSR to Sampler1.gain");
		if ("command" in result && result.command.type === "add") {
			expect(result.command.moduleType).toBe("AHDSR");
			expect(result.command.parent).toBe("Sampler1");
			expect(result.command.chain).toBe("gain");
		}
	});

	it("parses add with alias and target", () => {
		const result = parseBuilderInput(
			'add AHDSR as "MyEnv" to Sampler1.gain',
		);
		if ("command" in result && result.command.type === "add") {
			expect(result.command.moduleType).toBe("AHDSR");
			expect(result.command.alias).toBe("MyEnv");
			expect(result.command.parent).toBe("Sampler1");
			expect(result.command.chain).toBe("gain");
		}
	});

	it("rejects malformed add", () => {
		const result = parseBuilderInput("add");
		expect("error" in result).toBe(true);
	});
});

describe("builder parser — show commands", () => {
	it("parses show tree", () => {
		const result = parseBuilderInput("show tree");
		if ("command" in result) {
			expect(result.command.type).toBe("show");
			if (result.command.type === "show") {
				expect(result.command.what).toBe("tree");
			}
		}
	});

	it("parses show types", () => {
		const result = parseBuilderInput("show types");
		if ("command" in result && result.command.type === "show") {
			expect(result.command.what).toBe("types");
		}
	});

	it("is case insensitive", () => {
		const result = parseBuilderInput("SHOW TREE");
		if ("command" in result && result.command.type === "show") {
			expect(result.command.what).toBe("tree");
		}
	});
});

describe("builder parser — set commands", () => {
	it("parses set with number value", () => {
		const result = parseBuilderInput("set AHDSR Attack 100");
		if ("command" in result && result.command.type === "set") {
			expect(result.command.target).toBe("AHDSR");
			expect(result.command.param).toBe("Attack");
			expect(result.command.value).toBe(100);
		}
	});

	it("parses set with string value", () => {
		const result = parseBuilderInput('set Sampler1 PreloadSize "8192"');
		if ("command" in result && result.command.type === "set") {
			expect(result.command.value).toBe("8192");
		}
	});

	it("parses set with 'to' keyword", () => {
		const result = parseBuilderInput("set AHDSR Attack to 200");
		if ("command" in result && result.command.type === "set") {
			expect(result.command.param).toBe("Attack");
			expect(result.command.value).toBe(200);
		}
	});

	it("parses set with decimal value", () => {
		const result = parseBuilderInput("set AHDSR DecayCurve 0.5");
		if ("command" in result && result.command.type === "set") {
			expect(result.command.value).toBe(0.5);
		}
	});
});

describe("builder parser — error cases", () => {
	it("rejects empty input", () => {
		const result = parseBuilderInput("");
		expect("error" in result).toBe(true);
	});

	it("rejects unknown verb", () => {
		const result = parseBuilderInput("delete AHDSR");
		expect("error" in result).toBe(true);
	});
});

// ── Validation tests ────────────────────────────────────────────────

describe("validateAddCommand", () => {
	it("accepts valid module type", () => {
		const result = validateAddCommand(
			{ type: "add", moduleType: "AHDSR" },
			moduleList,
		);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("accepts all 79 module types", () => {
		for (const mod of moduleList.modules) {
			const result = validateAddCommand(
				{ type: "add", moduleType: mod.id },
				moduleList,
			);
			expect(result.valid).toBe(true);
		}
	});

	it("rejects unknown module type", () => {
		const result = validateAddCommand(
			{ type: "add", moduleType: "FakeModule" },
			moduleList,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("Unknown module type");
	});

	it("suggests closest match for typo", () => {
		const result = validateAddCommand(
			{ type: "add", moduleType: "AHDRS" },
			moduleList,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("Did you mean");
		expect(result.errors[0]).toContain("AHDSR");
	});

	it("suggests for common misspellings", () => {
		const cases = [
			{ input: "StreamingSamplr", expected: "StreamingSampler" },
			{ input: "SimplGain", expected: "SimpleGain" },
			{ input: "LFo", expected: "LFO" },
		];

		for (const { input, expected } of cases) {
			const result = validateAddCommand(
				{ type: "add", moduleType: input },
				moduleList,
			);
			expect(result.valid).toBe(false);
			expect(result.suggestions).toContain(expected);
		}
	});
});

describe("validateSetCommand", () => {
	it("accepts valid parameter and value", () => {
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attack", value: 100 },
			moduleList,
		);
		expect(result.valid).toBe(true);
	});

	it("rejects unknown parameter", () => {
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "FakeParam", value: 100 },
			moduleList,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("Unknown parameter");
	});

	it("suggests closest parameter for typo", () => {
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attck", value: 100 },
			moduleList,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("Did you mean");
		expect(result.errors[0]).toContain("Attack");
	});

	it("rejects value out of range", () => {
		// AHDSR Attack range is 0–20000
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attack", value: 50000 },
			moduleList,
		);
		expect(result.valid).toBe(false);
		expect(result.errors[0]).toContain("out of range");
		expect(result.errors[0]).toContain("0");
		expect(result.errors[0]).toContain("20000");
	});

	it("accepts value at range boundary", () => {
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attack", value: 0 },
			moduleList,
		);
		expect(result.valid).toBe(true);

		const result2 = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attack", value: 20000 },
			moduleList,
		);
		expect(result2.valid).toBe(true);
	});

	it("skips validation for unknown target module", () => {
		const result = validateSetCommand(
			{ type: "set", target: "UnknownModule", param: "Whatever", value: 42 },
			moduleList,
		);
		// Can't validate — passes through
		expect(result.valid).toBe(true);
	});

	it("accepts string values without range check", () => {
		const result = validateSetCommand(
			{ type: "set", target: "AHDSR", param: "Attack", value: "fast" },
			moduleList,
		);
		// String values can't be range-checked
		expect(result.valid).toBe(true);
	});
});

// ── BuilderMode integration ─────────────────────────────────────────

describe("BuilderMode", () => {
	it("has correct identity", () => {
		const mode = new BuilderMode();
		expect(mode.id).toBe("builder");
		expect(mode.name).toBe("Builder");
		expect(mode.accent).toBe("#fd971f");
	});

	it("parses and validates add commands", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("add AHDSR", nullSession);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("add AHDSR");
		}
	});

	it("returns error for invalid module type", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("add FakeModule", nullSession);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Unknown module type");
		}
	});

	it("returns suggestion for typo", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("add AHDRS", nullSession);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("Did you mean");
		}
	});

	it("show types returns table of all modules", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("show types", nullSession);
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.rows).toHaveLength(79);
		}
	});

	it("validates set parameter range", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("set AHDSR Attack 50000", nullSession);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("out of range");
		}
	});

	it("accepts valid set command", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("set AHDSR Attack 100", nullSession);
		expect(result.type).toBe("text");
	});

	it("works without module data (skips validation)", async () => {
		const mode = new BuilderMode();
		const result = await mode.parse("add AHDSR", nullSession);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("validation skipped");
		}
	});

	it("returns parse error for invalid syntax", async () => {
		const mode = new BuilderMode(moduleList);
		const result = await mode.parse("add", nullSession);
		expect(result.type).toBe("error");
	});
});

// ── BuilderMode completion ──────────────────────────────────────────

describe("BuilderMode completion", () => {
	function createBuilderWithEngine(): BuilderMode {
		const engine = new CompletionEngine();
		engine.setDatasets(buildDatasets(moduleList, null, null));
		return new BuilderMode(moduleList, engine);
	}

	it("returns empty without engine", () => {
		const mode = new BuilderMode(moduleList);
		const result = mode.complete!("a", 1);
		expect(result.items).toHaveLength(0);
	});

	it("completes keywords for empty input", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("", 0);
		expect(result.items).toHaveLength(6); // add, show, set, cd, ls, pwd
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("add");
		expect(labels).toContain("show");
		expect(labels).toContain("set");
		expect(labels).toContain("cd");
		expect(labels).toContain("ls");
		expect(labels).toContain("pwd");
	});

	it("completes keyword prefix", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("a", 1);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].label).toBe("add");
	});

	it("completes module types after 'add '", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("add AH", 6);
		expect(result.items.some((i) => i.label === "AHDSR")).toBe(true);
	});

	it("completes show subcommands after 'show '", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("show ", 5);
		expect(result.items).toHaveLength(2);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("tree");
		expect(labels).toContain("types");
	});

	it("completes show subcommand prefix", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("show tr", 7);
		expect(result.items).toHaveLength(1);
		expect(result.items[0].label).toBe("tree");
	});

	it("completes parameter names after 'set <module> '", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("set AHDSR ", 10);
		expect(result.items.length).toBeGreaterThan(0);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("Attack");
	});

	it("filters parameter names by prefix", () => {
		const mode = createBuilderWithEngine();
		const result = mode.complete!("set AHDSR At", 12);
		expect(result.items.some((i) => i.label === "Attack")).toBe(true);
		expect(result.items.some((i) => i.label === "AttackLevel")).toBe(true);
	});
});
