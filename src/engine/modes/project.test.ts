import { describe, expect, it } from "vitest";
import { ProjectMode } from "./project.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";
import { CompletionEngine } from "../completion/engine.js";
import { createDefaultMockRuntime } from "../../mock/runtime.js";
import { installProjectMock } from "../../mock/projectMock.js";
import { createMockProjectState } from "../../mock/projectFixtures.js";
import { createMockStatusPayload } from "../../mock/runtime.js";
import {
	extractScopeClauses,
	parseBoolToken,
	parseOS,
	parseSaveCommand,
	parseTarget,
	tokenize,
} from "./project-parse.js";

function createMockSession(): {
	session: SessionContext;
	mock: MockHiseConnection;
	state: ReturnType<typeof createMockProjectState>;
	dirtyCount: () => number;
} {
	const state = createMockProjectState();
	const status = createMockStatusPayload();
	const mock = new MockHiseConnection();
	mock.setProbeResult(true);
	mock.onGet("/api/status", () => ({
		success: true,
		activeIsSnippetBrowser: false,
		server: status.server,
		project: status.project,
		scriptProcessors: status.scriptProcessors,
		logs: [],
		errors: [],
	}));
	installProjectMock(mock, state, status);
	let dirty = 0;
	const session: SessionContext = {
		connection: mock,
		popMode: () => ({ type: "text", content: "Exited Project mode." }),
		markProjectTreeDirty: () => {
			dirty++;
		},
		copyToClipboard: () => {},
		readClipboard: async () => null,
	};
	return { session, mock, state, dirtyCount: () => dirty };
}

describe("ProjectMode identity", () => {
	it("has correct id, name, accent, prompt", () => {
		const mode = new ProjectMode();
		expect(mode.id).toBe("project");
		expect(mode.name).toBe("Project");
		expect(mode.accent).toBe("#e6db74");
		expect(mode.prompt).toBe("[project] > ");
	});
});

describe("ProjectMode help / dispatch", () => {
	it("shows help table for empty input", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("help", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("/project commands");
			expect(result.content).toContain("snippet");
		}
	});

	it("errors on unknown verb", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("compile", session);
		expect(result.type).toBe("error");
	});

	it("info renders project name + folder", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("info", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("Mock Project");
			expect(result.content).toContain("/mock/project");
		}
	});

	it("show projects marks active project", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("show projects", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("Mock Project");
			expect(result.content).toContain("●");
		}
	});

	it("get <key> returns just the value", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("get Version", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("1.0.0");
		}
	});

	it("get <key> normalizes booleans", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("get VST3Support", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("true");
		}
	});

	it("get without key errors", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("get", session);
		expect(result.type).toBe("error");
	});

	it("get unknown key errors", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("get Bogus", session);
		expect(result.type).toBe("error");
	});

	it("show settings renders stacked name/value blocks", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("show settings", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("**VST3Support**");
			expect(result.content).toContain("## Project Settings");
			expect(result.content).toContain("[true|false]");
			expect(result.content).not.toContain("| Key | Value |");
			expect(result.content).not.toContain("```");
		}
	});

	it("show files lists xml + hip entries", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("show files", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("Mock Project.xml");
			expect(result.content).toContain("Mock Project.hip");
		}
	});

	it("show preprocessors renders nested scopes", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("show preprocessors", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("*.*");
			expect(result.content).toContain("Project.*");
			expect(result.content).toContain("Project.Windows");
			expect(result.content).toContain("HAS_LICENSE_KEY");
		}
	});

	it("describe renders setting body + options", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("describe VST3Support", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("VST3Support");
			expect(result.content).toContain("Options");
			expect(result.content).toContain("VST3");
		}
	});

	it("describe errors on unknown key", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("describe Bogus", session);
		expect(result.type).toBe("error");
	});
});

describe("ProjectMode mutations", () => {
	it("switch by name resolves to path and marks dirty", async () => {
		const { session, mock, state, dirtyCount } = createMockSession();
		const result = await new ProjectMode().parse("switch TestSynth", session);
		expect(result.type).not.toBe("error");
		expect(state.list.active).toBe("TestSynth");
		const switchCall = mock.calls.find((c) => c.endpoint === "/api/project/switch");
		expect(switchCall).toBeDefined();
		expect((switchCall!.body as { project: string }).project).toBe("/mock/TestSynth");
		expect(dirtyCount()).toBeGreaterThan(0);
	});

	it("switch by absolute path passes through", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("switch /mock/DemoEffect", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/switch");
		expect((call!.body as { project: string }).project).toBe("/mock/DemoEffect");
	});

	it("switch errors on unknown name (non-absolute)", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("switch DoesNotExist", session);
		expect(result.type).toBe("error");
	});

	it("save xml as Foo reports master chain rename", async () => {
		const { session, state } = createMockSession();
		const result = await new ProjectMode().parse("save xml as RenamedProject", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("Master chain renamed");
			expect(result.content).toContain("RenamedProject");
		}
		expect(state.chainId).toBe("RenamedProject");
	});

	it("save hip without filename does not rename master chain", async () => {
		const { session, state } = createMockSession();
		const before = state.chainId;
		const result = await new ProjectMode().parse("save hip", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).not.toContain("Master chain renamed");
		}
		expect(state.chainId).toBe(before);
	});

	it("set bool norm: yes -> true (sent as string)", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("set VST3Support yes", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/settings/set");
		expect(call).toBeDefined();
		expect((call!.body as { value: string }).value).toBe("true");
	});

	it("set bool norm: off -> false", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("set AAXSupport off", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/settings/set");
		expect((call!.body as { value: string }).value).toBe("false");
	});

	it("set passthrough for non-bool keys", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("set Version 2.0.0", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/settings/set");
		expect((call!.body as { value: string }).value).toBe("2.0.0");
	});

	it("set errors on unknown setting", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("set Bogus 1", session);
		expect(result.type).toBe("error");
	});

	it("set preprocessor with lenient OS+target aliases", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("set preprocessor ENABLE_FOO 1 on win for plugin", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/preprocessor/set");
		expect(call).toBeDefined();
		const body = call!.body as { OS: string; target: string; preprocessor: string; value: string };
		expect(body.OS).toBe("Windows");
		expect(body.target).toBe("Project");
		expect(body.preprocessor).toBe("ENABLE_FOO");
		expect(body.value).toBe("1");
	});

	it("clear preprocessor maps to value=default", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("clear preprocessor SHARED_FLAG", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/preprocessor/set");
		expect(call).toBeDefined();
		const body = call!.body as { value: string };
		expect(body.value).toBe("default");
	});

	it("set preprocessor X default and clear preprocessor X are equivalent", async () => {
		const { session, mock } = createMockSession();
		await new ProjectMode().parse("set preprocessor SHARED_FLAG default", session);
		const a = mock.calls[mock.calls.length - 1]!;
		await new ProjectMode().parse("clear preprocessor SHARED_FLAG", session);
		const b = mock.calls[mock.calls.length - 1]!;
		expect((a.body as { value: string }).value).toBe("default");
		expect((b.body as { value: string }).value).toBe("default");
	});

	it("set preprocessor non-integer errors before request", async () => {
		const { session, mock } = createMockSession();
		const result = await new ProjectMode().parse("set preprocessor X foo", session);
		expect(result.type).toBe("error");
		const sent = mock.calls.find((c) => c.endpoint === "/api/project/preprocessor/set");
		expect(sent).toBeUndefined();
	});

	it("snippet export copies to clipboard + truncates preview", async () => {
		const { session, state } = createMockSession();
		state.snippet = "HiseSnippet 9999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_extra";
		let captured = "";
		session.copyToClipboard = (text) => {
			captured = text;
		};
		const result = await new ProjectMode().parse("snippet export", session);
		expect(result.type).toBe("markdown");
		expect(captured).toBe(state.snippet);
		if (result.type === "markdown") {
			expect(result.content).toContain("…");
			expect(result.content).toContain("bytes");
		}
	});

	it("snippet load (inline) sends import_snippet", async () => {
		const { session, mock } = createMockSession();
		const result = await new ProjectMode().parse(
			"snippet load HiseSnippet 1.test_payload",
			session,
		);
		expect(result.type).not.toBe("error");
		const call = mock.calls.find((c) => c.endpoint === "/api/project/import_snippet");
		expect(call).toBeDefined();
		expect((call!.body as { snippet: string }).snippet).toContain("HiseSnippet 1.test_payload");
	});

	it("snippet load errors when string lacks HiseSnippet prefix", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("snippet load not_a_snippet", session);
		expect(result.type).toBe("error");
	});

	it("snippet load (no arg) reads from clipboard", async () => {
		const { session, mock } = createMockSession();
		session.readClipboard = async () => "HiseSnippet 5.from_clipboard";
		await new ProjectMode().parse("snippet load", session);
		const call = mock.calls.find((c) => c.endpoint === "/api/project/import_snippet");
		expect(call).toBeDefined();
		expect((call!.body as { snippet: string }).snippet).toBe("HiseSnippet 5.from_clipboard");
	});

	it("snippet load (no arg, no clipboard) errors cleanly", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("snippet load", session);
		expect(result.type).toBe("error");
	});

	it("load <file> succeeds for a known relative path and marks dirty", async () => {
		const { session, dirtyCount } = createMockSession();
		const result = await new ProjectMode().parse(
			"load XmlPresetBackups/Mock Project.xml",
			session,
		);
		expect(result.type).not.toBe("error");
		expect(dirtyCount()).toBeGreaterThan(0);
	});

	it("load <bareName> prefers .xml over .hip when both exist", async () => {
		const { session, mock } = createMockSession();
		const result = await new ProjectMode().parse("load Mock Project", session);
		expect(result.type).not.toBe("error");
		const call = mock.calls.find((c) => c.endpoint === "/api/project/load");
		expect((call!.body as { file: string }).file).toBe("XmlPresetBackups/Mock Project.xml");
	});

	it("load <bareName>.hip overrides the .xml preference", async () => {
		const { session, mock } = createMockSession();
		const result = await new ProjectMode().parse("load Mock Project.hip", session);
		expect(result.type).not.toBe("error");
		const call = mock.calls.find((c) => c.endpoint === "/api/project/load");
		expect((call!.body as { file: string }).file).toBe("Presets/Mock Project.hip");
	});

	it("load errors with a clear message when no file matches", async () => {
		const { session } = createMockSession();
		const result = await new ProjectMode().parse("load DoesNotExist", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain('No project file matches "DoesNotExist"');
		}
	});
});

describe("ProjectMode contract validation against mock runtime", () => {
	it("/api/project/list payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/list");
		const { normalizeProjectList } = await import("../../mock/contracts/project.js");
		expect(() => normalizeProjectList(response as unknown)).not.toThrow();
	});

	it("/api/project/tree payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/tree");
		const { normalizeProjectTree } = await import("../../mock/contracts/project.js");
		expect(() => normalizeProjectTree(response as unknown)).not.toThrow();
	});

	it("/api/project/files payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/files");
		const { normalizeProjectFiles } = await import("../../mock/contracts/project.js");
		expect(() => normalizeProjectFiles(response as unknown)).not.toThrow();
	});

	it("/api/project/settings/list payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/settings/list");
		const { normalizeProjectSettings } = await import("../../mock/contracts/project.js");
		expect(() => normalizeProjectSettings(response as unknown)).not.toThrow();
	});

	it("/api/project/preprocessor/list payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/preprocessor/list");
		const { normalizePreprocessorList } = await import("../../mock/contracts/project.js");
		expect(() => normalizePreprocessorList(response as unknown)).not.toThrow();
	});

	it("/api/project/export_snippet payload normalizes", async () => {
		const runtime = createDefaultMockRuntime();
		const response = await runtime.connection.get("/api/project/export_snippet");
		const { normalizeProjectSnippet } = await import("../../mock/contracts/project.js");
		expect(() => normalizeProjectSnippet(response as unknown)).not.toThrow();
	});
});

describe("project-parse helpers", () => {
	it("parseOS lenient aliases", () => {
		expect(parseOS("win")).toBe("Windows");
		expect(parseOS("WIN")).toBe("Windows");
		expect(parseOS("x64")).toBe("Windows");
		expect(parseOS("apple")).toBe("macOS");
		expect(parseOS("darwin")).toBe("macOS");
		expect(parseOS("MacOSX")).toBe("macOS");
		expect(parseOS("linux")).toBe("Linux");
		expect(parseOS("all")).toBe("all");
		expect(parseOS("*")).toBe("all");
		expect(parseOS(undefined)).toBe("all");
		expect(parseOS("ios")).toBeNull();
	});

	it("parseTarget lenient aliases", () => {
		expect(parseTarget("plugin")).toBe("Project");
		expect(parseTarget("project")).toBe("Project");
		expect(parseTarget("Project")).toBe("Project");
		expect(parseTarget("DLL")).toBe("Dll");
		expect(parseTarget("dll")).toBe("Dll");
		expect(parseTarget("all")).toBe("all");
		expect(parseTarget("*")).toBe("all");
		expect(parseTarget(undefined)).toBe("all");
		expect(parseTarget("script")).toBeNull();
	});

	it("parseBoolToken lenient", () => {
		expect(parseBoolToken("true")).toBe(true);
		expect(parseBoolToken("yes")).toBe(true);
		expect(parseBoolToken("on")).toBe(true);
		expect(parseBoolToken("1")).toBe(true);
		expect(parseBoolToken("enable")).toBe(true);
		expect(parseBoolToken("no")).toBe(false);
		expect(parseBoolToken("off")).toBe(false);
		expect(parseBoolToken("disabled")).toBe(false);
		expect(parseBoolToken("maybe")).toBeNull();
	});

	it("tokenize handles quoted strings + spaces", () => {
		expect(tokenize('save xml as "My Project v2"')).toEqual(["save", "xml", "as", "My Project v2"]);
		expect(tokenize("set Version 2.0.0")).toEqual(["set", "Version", "2.0.0"]);
	});

	it("extractScopeClauses strips on/for clauses", () => {
		const result = extractScopeClauses(["ENABLE_FOO", "1", "on", "win", "for", "plugin"]);
		expect(result).toEqual({ tokens: ["ENABLE_FOO", "1"], os: "Windows", target: "Project" });
	});

	it("extractScopeClauses defaults to all/all", () => {
		const result = extractScopeClauses(["ENABLE_FOO", "1"]);
		expect(result).toEqual({ tokens: ["ENABLE_FOO", "1"], os: "all", target: "all" });
	});

	it("extractScopeClauses errors on unknown OS", () => {
		const result = extractScopeClauses(["X", "1", "on", "ios"]);
		expect(result).toEqual({ error: 'Unknown OS "ios"' });
	});

	it("parseSaveCommand happy path", () => {
		expect(parseSaveCommand("xml as Foo")).toEqual({ format: "xml", filename: "Foo" });
		expect(parseSaveCommand("hip")).toEqual({ format: "hip" });
	});

	it("parseSaveCommand errors on bad format", () => {
		expect(parseSaveCommand("ogg")).toEqual({ error: 'save format must be "xml" or "hip", got "ogg"' });
	});
});

describe("ProjectMode completion", () => {
	it("suggests verbs at top level", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("", 0);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("info");
		expect(labels).toContain("show");
		expect(labels).toContain("snippet");
	});

	it("suggests show subcommands", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("show ", 5);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("projects");
		expect(labels).toContain("settings");
		expect(labels).toContain("preprocessors");
	});

	it("suggests preprocessor names from data when available", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine, {
			preprocessors: {
				ENABLE_FOO: stubPreprocessor("ENABLE_FOO"),
				ENABLE_BAR: stubPreprocessor("ENABLE_BAR"),
			},
		});
		const result = mode.complete!("set preprocessor EN", 19);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("ENABLE_FOO");
		expect(labels).toContain("ENABLE_BAR");
	});

	it("suggests OS values after `on`", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("set preprocessor X 1 on ", 24);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("Windows");
		expect(labels).toContain("macOS");
		expect(labels).toContain("Linux");
	});

	it("suggests target values after `for`", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("set preprocessor X 1 on win for ", 32);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("Project");
		expect(labels).toContain("Dll");
	});

	it("replaces only the trailing token when completing a sub-arg", () => {
		// Regression: previously `from` was 0, so accepting `switch Pro<Tab>` wiped the verb.
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const input = "switch Pro";
		const result = mode.complete!(input, input.length);
		expect(result.from).toBe(7); // start of "Pro"
		expect(result.to).toBe(input.length);
	});

	it("first token completion still spans the whole verb", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("swi", 3);
		expect(result.from).toBe(0);
		expect(result.to).toBe(3);
	});

	it("suggests export targets after `export`", () => {
		const engine = new CompletionEngine();
		const mode = new ProjectMode(engine);
		const result = mode.complete!("export ", 7);
		const labels = result.items.map((i) => i.label);
		expect(labels).toContain("dll");
		expect(labels).toContain("project");
	});
});

describe("ProjectMode export verb", () => {
	function makeWizardRegistry() {
		const wizards = new Map<string, { id: string; title?: string; pages: unknown[] }>([
			["compile_networks", { id: "compile_networks", title: "Compile networks", pages: [] }],
			["plugin_export", { id: "plugin_export", title: "Plugin export", pages: [] }],
		]);
		return {
			get: (id: string) => wizards.get(id) ?? null,
			list: () => [...wizards.values()],
		};
	}

	it("export dll returns wizardResult for compile_networks", async () => {
		const { session } = createMockSession();
		(session as { wizardRegistry?: unknown }).wizardRegistry = makeWizardRegistry();
		const result = await new ProjectMode().parse("export dll", session);
		expect(result.type).toBe("wizard");
		if (result.type === "wizard") {
			expect(result.definition.id).toBe("compile_networks");
		}
	});

	it("export project returns wizardResult for plugin_export", async () => {
		const { session } = createMockSession();
		(session as { wizardRegistry?: unknown }).wizardRegistry = makeWizardRegistry();
		const result = await new ProjectMode().parse("export project", session);
		expect(result.type).toBe("wizard");
		if (result.type === "wizard") {
			expect(result.definition.id).toBe("plugin_export");
		}
	});

	it("export errors on unknown target", async () => {
		const { session } = createMockSession();
		(session as { wizardRegistry?: unknown }).wizardRegistry = makeWizardRegistry();
		const result = await new ProjectMode().parse("export bogus", session);
		expect(result.type).toBe("error");
	});
});

function stubPreprocessor(_name: string) {
	return {
		autoConfig: false,
		brief: "",
		category: "",
		"category-slug": "",
		crossRefs: [],
		defaultValue: 0,
		description: "",
		supportsHotReload: false,
		value: 0,
		valueRange: "",
		vestigal: false,
	};
}
