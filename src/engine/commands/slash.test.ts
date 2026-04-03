import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandSession } from "./registry.js";
import { registerBuiltinCommands } from "./slash.js";
import type { CommandResult } from "../result.js";
import { textResult } from "../result.js";

function createMockSession(): CommandSession & { modes: string[]; quitRequested: boolean } {
	const modes: string[] = [];
	let quitRequested = false;
	const modeCache = new Map<string, import("../modes/mode.js").Mode>();
	
	return {
		modes,
		connection: null,
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
		wizardRegistry: null,
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
		await registry.dispatch("/script.MyProcessor", session);
		expect(session.modes).toContain("script");
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
