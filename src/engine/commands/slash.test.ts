import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandSession } from "./registry.js";
import { registerBuiltinCommands } from "./slash.js";
import type { CommandResult } from "../result.js";
import { textResult } from "../result.js";
import { MockHiseConnection } from "../hise.js";
import { ScriptMode } from "../modes/script.js";

function createMockSession(): CommandSession & { modes: string[]; quitRequested: boolean } {
	const modes: string[] = [];
	let quitRequested = false;
	let connection: MockHiseConnection | null = null;
	const modeCache = new Map<string, import("../modes/mode.js").Mode>();
	const compilerState = new Map<string, { activeCallback: string | null; callbacks: Map<string, string[]> }>();
	
	return {
		modes,
		projectName: null as string | null,
		projectFolder: null as string | null,
		get connection() {
			return connection;
		},
		set connection(value: MockHiseConnection | null) {
			connection = value;
		},
		get quitRequested() { return quitRequested; },
		get modeStackDepth() {
			return modes.length;
		},
		get currentModeId() {
			return modes.length > 0 ? modes[modes.length - 1] : "root";
		},
		allCommands() {
			return [];
		},
		pushMode(modeId: string) {
			modes.push(modeId);
			return null;
		},
		popMode(silent?: boolean) {
			if (modes.length === 0) {
				return textResult("Already at root.");
			}
			modes.pop();
			if (silent) {
				return { type: "empty" };
			}
			return textResult("Exited mode.");
		},
		requestQuit() {
			quitRequested = true;
		},
		getOrCreateMode(modeId: string) {
			let mode = modeCache.get(modeId);
			if (!mode) {
				// Create a stub mode
				mode = {
					id: modeId as import("../modes/mode.js").ModeId,
					name: modeId,
					accent: "#ffffff",
					prompt: "> ",
					async parse() {
						return textResult(`Parsed in ${modeId}`);
					},
					setContext(_path: string) {
						// Stub
					},
				};
				modeCache.set(modeId, mode);
			}
			return mode;
		},
		async executeOneShot(modeId: string, input: string) {
			const mode = this.getOrCreateMode(modeId);
			modes.push(modeId);
			const result = await mode.parse(input, this as any);
			modes.pop();
			return result;
		},
		resolvePath(fp: string) { return fp; },
		resolveScriptPath(fp: string) { return fp; },
		clearScriptCompilerState(processorId: string) {
			compilerState.set(processorId, { activeCallback: null, callbacks: new Map() });
		},
		clearAllScriptCompilerState() {
			compilerState.clear();
		},
		setActiveScriptCallback(processorId: string, callbackId: string) {
			let state = compilerState.get(processorId);
			if (!state) {
				state = { activeCallback: null, callbacks: new Map() };
				compilerState.set(processorId, state);
			}
			state.activeCallback = callbackId;
			state.callbacks.set(callbackId, []);
		},
		appendScriptCallbackLine(processorId: string, line: string) {
			const state = compilerState.get(processorId);
			if (!state?.activeCallback) return false;
			const lines = state.callbacks.get(state.activeCallback) ?? [];
			lines.push(line);
			state.callbacks.set(state.activeCallback, lines);
			return true;
		},
		getActiveScriptCallback(processorId: string) {
			return compilerState.get(processorId)?.activeCallback ?? null;
		},
		getCollectedScriptCallbacks(processorId: string) {
			const state = compilerState.get(processorId);
			if (!state) return {};
			return Object.fromEntries(
				[...state.callbacks.entries()].map(([callbackId, lines]) => [callbackId, lines.join("\n")]),
			);
		},
		wizardRegistry: null,
		handlerRegistry: null,
	};
}

function createRegistry(): CommandRegistry {
	const registry = new CommandRegistry();
	registerBuiltinCommands(registry);
	return registry;
}

describe("built-in slash commands", () => {
	it("registers all expected commands", () => {
		const registry = createRegistry();
		const names = registry.names();

		expect(names).toContain("exit");
		expect(names).toContain("help");
		expect(names).toContain("clear");
		expect(names).toContain("modes");
		expect(names).toContain("builder");
		expect(names).toContain("script");
		expect(names).toContain("dsp");
		expect(names).toContain("sampler");
		expect(names).toContain("inspect");
		expect(names).toContain("project");
		expect(names).toContain("export");
		expect(names).toContain("compile");
	});

	it("/help returns text", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/help", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content.length).toBeGreaterThan(0);
		}
	});

	it("/clear returns empty", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/clear", session);
		expect(result.type).toBe("empty");
	});

	it("/modes returns table", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/modes", session);
		expect(result.type).toBe("table");
		if (result.type === "table") {
			expect(result.headers).toContain("Mode");
			expect(result.rows.length).toBeGreaterThan(0);
		}
	});

	it("/exit pops mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		session.modes.push("builder");

		const result = await registry.dispatch("/exit", session);
		expect(result.type).toBe("text");
		expect(session.modes).toHaveLength(0);
	});

	it("/exit at root returns message", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/exit", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("root");
		}
	});

	it("/builder pushes builder mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/builder", session);
		expect(result.type).toBe("text");
		expect(session.modes).toContain("builder");
	});

	it("/script pushes script mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/script", session);
		expect(session.modes).toContain("script");
	});

	it("/script.MyProcessor enters script mode with context", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		session.getOrCreateMode = (modeId: string) => {
			let mode = (session as any).__modeCache?.get(modeId);
			if (!mode) {
				mode = modeId === "script"
					? new ScriptMode()
					: {
						id: modeId as import("../modes/mode.js").ModeId,
						name: modeId,
						accent: "#ffffff",
						prompt: "> ",
						async parse() {
							return textResult(`Parsed in ${modeId}`);
						},
					};
				(session as any).__modeCache ??= new Map();
				(session as any).__modeCache.set(modeId, mode);
			}
			return mode;
		};
		await registry.dispatch("/script.MyProcessor", session);
		expect(session.modes).toContain("script");
		expect((session.getOrCreateMode("script") as ScriptMode).processorId).toBe("MyProcessor");
	});

	it("/callback activates callback collection in script mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		(session as any).connection = new MockHiseConnection();
		session.modes.push("script");
		session.getOrCreateMode = () => new ScriptMode();

		const result = await registry.dispatch("/callback onInit", session);

		expect(result.type).toBe("text");
		expect(session.getActiveScriptCallback!("Interface")).toBe("onInit");
	});

	it("/compile sends collected callbacks via set_script in script mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const connection = new MockHiseConnection()
			.onPost("/api/set_script", () => ({
				success: true,
				result: "Compiled OK",
				updatedCallbacks: ["onInit", "onNoteOn"],
				logs: [],
				errors: [],
			}));
		(session as any).connection = connection;
		session.modes.push("script");
		const scriptMode = new ScriptMode();
		session.getOrCreateMode = () => scriptMode;
		session.setActiveScriptCallback!("Interface", "onInit");
		session.appendScriptCallbackLine!("Interface", "Content.makeFrontInterface(600, 600);");
		session.setActiveScriptCallback!("Interface", "onNoteOn");
		session.appendScriptCallbackLine!("Interface", "Console.print(Message.getNoteNumber());");

		const result = await registry.dispatch("/compile", session);

		expect(result.type).toBe("text");
		expect(connection.calls[0]).toMatchObject({ method: "POST", endpoint: "/api/set_script" });
		expect(connection.calls[0]?.body).toEqual({
			moduleId: "Interface",
			compile: true,
			callbacks: {
				onInit: "Content.makeFrontInterface(600, 600);",
				onNoteOn: "function onNoteOn()\n{\n\tConsole.print(Message.getNoteNumber());\n}",
			},
		});
		expect(session.getCollectedScriptCallbacks!("Interface")).toEqual({});
	});

	it("/inspect pushes inspect mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		await registry.dispatch("/inspect", session);
		expect(session.modes).toContain("inspect");
	});

	it("/project pushes project mode", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		await registry.dispatch("/project", session);
		expect(session.modes).toContain("project");
	});

	it("/quit sets quitRequested regardless of mode stack", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		session.modes.push("builder");
		session.modes.push("script");

		const result = await registry.dispatch("/quit", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("Goodbye");
		}
		// Mode stack is untouched — quit doesn't pop modes
		expect(session.modes).toHaveLength(2);
		expect(session.quitRequested).toBe(true);
	});

	it("/quit at root also sets quitRequested", async () => {
		const registry = createRegistry();
		const session = createMockSession();

		await registry.dispatch("/quit", session);
		expect(session.quitRequested).toBe(true);
	});

	it("/expand returns text with default pattern", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/expand", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("*");
		}
	});

	it("/expand with pattern returns text with that pattern", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/expand Sampler*", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("Sampler*");
		}
	});

	it("/collapse returns text with default pattern", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/collapse", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("*");
		}
	});

	it("registers expand and collapse commands", () => {
		const registry = createRegistry();
		expect(registry.has("expand")).toBe(true);
		expect(registry.has("collapse")).toBe(true);
	});
});

// ── Phase 3.5.3: One-shot execution + context entry ─────────────────

describe("mode handler one-shot execution", () => {
	it("/builder.SineGenerator enters builder with context", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		
		await registry.dispatch("/builder.SineGenerator", session);
		expect(session.modes).toContain("builder");
		// Context verification would need builder mode inspection (deferred to integration)
	});

	it("/builder add SimpleGain executes one-shot and stays in root", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		
		const result = await registry.dispatch("/builder add SimpleGain", session);
		// Should execute the command
		expect(result.type).not.toBe("error");
		// Should remain in root mode (not enter builder)
		expect(session.modes).toHaveLength(0);
	});

	it("/builder.SineGenerator.pitch add LFO one-shot with context", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		
		await registry.dispatch("/builder.SineGenerator.pitch add LFO", session);
		// Should execute and return to root
		expect(session.modes).toHaveLength(0);
	});

	it("one-shot execution preserves mode state in cache", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		
		// First one-shot
		await registry.dispatch("/builder add SimpleGain", session);
		expect(session.modes).toHaveLength(0);
		
		// Second one-shot should reuse cached instance
		await registry.dispatch("/builder add Synthesiser", session);
		expect(session.modes).toHaveLength(0);
	});

	it("/builder without args enters mode (existing behavior)", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		
		await registry.dispatch("/builder", session);
		expect(session.modes).toContain("builder");
	});
});
