import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type {
	DataLoader,
	ModuleList,
	ScriptingApi,
	ScriptnodeList,
} from "./data.js";

// ── Node.js DataLoader for tests ────────────────────────────────────

// This is a concrete implementation used only in tests. The real Node.js
// implementation will live in src/tui/ or src/cli/ (not in engine/).

const DATA_DIR = path.resolve(import.meta.dirname, "../../data");

const nodeDataLoader: DataLoader = {
	async loadModuleList(): Promise<ModuleList> {
		const raw = fs.readFileSync(
			path.join(DATA_DIR, "moduleList.json"),
			"utf8",
		);
		return JSON.parse(raw) as ModuleList;
	},
	async loadScriptingApi(): Promise<ScriptingApi> {
		const raw = fs.readFileSync(
			path.join(DATA_DIR, "scripting_api.json"),
			"utf8",
		);
		return JSON.parse(raw) as ScriptingApi;
	},
	async loadScriptnodeList(): Promise<ScriptnodeList> {
		const raw = fs.readFileSync(
			path.join(DATA_DIR, "scriptnodeList.json"),
			"utf8",
		);
		return JSON.parse(raw) as ScriptnodeList;
	},
};

// ── Module List ─────────────────────────────────────────────────────

describe("DataLoader — moduleList", () => {
	it("loads the module list with correct version", async () => {
		const data = await nodeDataLoader.loadModuleList();
		expect(data.version).toBeDefined();
		expect(typeof data.version).toBe("string");
	});

	it("has exactly 79 modules", async () => {
		const data = await nodeDataLoader.loadModuleList();
		expect(data.modules).toHaveLength(79);
	});

	it("has category descriptions", async () => {
		const data = await nodeDataLoader.loadModuleList();
		expect(Object.keys(data.categories).length).toBeGreaterThan(0);
		expect(data.categories.oscillator).toBeDefined();
	});

	it("each module has required fields", async () => {
		const data = await nodeDataLoader.loadModuleList();
		for (const mod of data.modules) {
			expect(mod.id).toBeDefined();
			expect(mod.prettyName).toBeDefined();
			expect(mod.type).toBeDefined();
			expect(mod.subtype).toBeDefined();
			// parameters is optional — some modules (e.g. ScriptProcessor) have none
			if (mod.parameters !== undefined) {
				expect(Array.isArray(mod.parameters)).toBe(true);
			}
		}
	});

	it("module types are from the known set", async () => {
		const data = await nodeDataLoader.loadModuleList();
		const validTypes = new Set([
			"Modulator",
			"Effect",
			"MidiProcessor",
			"SoundGenerator",
		]);
		for (const mod of data.modules) {
			expect(validTypes.has(mod.type)).toBe(true);
		}
	});

	it("parameters have ranges", async () => {
		const data = await nodeDataLoader.loadModuleList();
		const withParams = data.modules.filter(
			(m) => m.parameters && m.parameters.length > 0,
		);
		expect(withParams.length).toBeGreaterThan(0);

		for (const mod of withParams) {
			for (const param of mod.parameters!) {
				expect(param.range).toBeDefined();
				expect(typeof param.range.min).toBe("number");
				expect(typeof param.range.max).toBe("number");
			}
		}
	});
});

// ── Scripting API ───────────────────────────────────────────────────

describe("DataLoader — scriptingApi", () => {
	it("loads with version info", async () => {
		const data = await nodeDataLoader.loadScriptingApi();
		expect(data.version).toBeDefined();
		expect(data.generated).toBeDefined();
	});

	it("has 89 classes", async () => {
		const data = await nodeDataLoader.loadScriptingApi();
		expect(Object.keys(data.classes)).toHaveLength(89);
	});

	it("has enriched classes list", async () => {
		const data = await nodeDataLoader.loadScriptingApi();
		expect(data.enrichedClasses.length).toBeGreaterThan(0);
		expect(data.enrichedClasses).toContain("Synth");
	});

	it("each class has methods with signatures", async () => {
		const data = await nodeDataLoader.loadScriptingApi();
		for (const [, cls] of Object.entries(data.classes)) {
			expect(cls.description).toBeDefined();
			expect(cls.category).toBeDefined();
			expect(Array.isArray(cls.methods)).toBe(true);

			for (const method of cls.methods) {
				expect(method.name).toBeDefined();
				expect(method.returnType).toBeDefined();
				expect(Array.isArray(method.parameters)).toBe(true);
			}
		}
	});

	it("class categories are from the known set", async () => {
		const data = await nodeDataLoader.loadScriptingApi();
		const validCategories = new Set([
			"namespace",
			"object",
			"scriptnode",
			"component",
		]);
		for (const [, cls] of Object.entries(data.classes)) {
			expect(validCategories.has(cls.category)).toBe(true);
		}
	});
});

// ── Scriptnode List ─────────────────────────────────────────────────

describe("DataLoader — scriptnodeList", () => {
	it("loads 194 nodes", async () => {
		const data = await nodeDataLoader.loadScriptnodeList();
		expect(Object.keys(data)).toHaveLength(194);
	});

	it("keys follow factory.nodeId pattern", async () => {
		const data = await nodeDataLoader.loadScriptnodeList();
		for (const key of Object.keys(data)) {
			expect(key).toMatch(/^[a-z_]+\.[a-z_0-9]+$/);
		}
	});

	it("each node has required fields", async () => {
		const data = await nodeDataLoader.loadScriptnodeList();
		for (const [, node] of Object.entries(data)) {
			expect(node.id).toBeDefined();
			expect(node.description).toBeDefined();
			expect(typeof node.hasChildren).toBe("boolean");
			expect(typeof node.hasFX).toBe("boolean");
			// parameters is optional — some nodes have none
			if (node.parameters !== undefined) {
				expect(Array.isArray(node.parameters)).toBe(true);
			}
		}
	});

	it("parameters have valid ranges", async () => {
		const data = await nodeDataLoader.loadScriptnodeList();
		for (const [, node] of Object.entries(data)) {
			if (!node.parameters) continue;
			for (const param of node.parameters) {
				expect(param.range).toBeDefined();
				expect(typeof param.range.min).toBe("number");
				expect(typeof param.range.max).toBe("number");
			}
		}
	});
});
