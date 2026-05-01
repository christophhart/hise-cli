import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandSession } from "./registry.js";
import { textResult } from "../result.js";

function createMockSession(): CommandSession {
	const modes: string[] = [];
	const modeCache = new Map<string, import("../modes/mode.js").Mode>();
	
	return {
		connection: null,
		projectName: null,
		projectFolder: null,
		cwd: null,
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
			return null; // success
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
		requestQuit() {},
		getOrCreateMode(modeId: string) {
			let mode = modeCache.get(modeId);
			if (!mode) {
				mode = {
					id: modeId as import("../modes/mode.js").ModeId,
					name: modeId,
					accent: "#ffffff",
					prompt: "> ",
					async parse() {
						return textResult(`Parsed in ${modeId}`);
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
		wizardRegistry: null,
		handlerRegistry: null,
	};
}

describe("CommandRegistry", () => {
	it("registers and retrieves commands", () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "test",
			description: "Test command",
			handler: async () => textResult("ok"),
		});

		expect(registry.has("test")).toBe(true);
		expect(registry.get("test")?.name).toBe("test");
		expect(registry.has("nonexistent")).toBe(false);
	});

	it("lists all registered commands", () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "alpha",
			description: "A",
			handler: async () => textResult("a"),
		});
		registry.register({
			name: "beta",
			description: "B",
			handler: async () => textResult("b"),
		});

		expect(registry.names()).toEqual(["alpha", "beta"]);
		expect(registry.all()).toHaveLength(2);
	});

	it("dispatches slash commands", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "ping",
			description: "Ping",
			handler: async () => textResult("pong"),
		});

		const session = createMockSession();
		const result = await registry.dispatch("/ping", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("pong");
		}
	});

	it("passes arguments to handler", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "echo",
			description: "Echo",
			handler: async (args) => textResult(args),
		});

		const session = createMockSession();
		const result = await registry.dispatch("/echo hello world", session);
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toBe("hello world");
		}
	});

	it("returns error for unknown commands", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "help",
			description: "Help",
			handler: async () => textResult("help"),
		});

		const session = createMockSession();
		const result = await registry.dispatch("/unknown", session);
		expect(result.type).toBe("error");
	});

	it("suggests similar commands for typos", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "builder",
			description: "Builder",
			handler: async () => textResult("ok"),
		});

		const session = createMockSession();
		const result = await registry.dispatch("/buildre", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("builder");
		}
	});

	it("rejects non-slash input", async () => {
		const registry = new CommandRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("plain input", session);
		expect(result.type).toBe("error");
	});

	it("handles commands with no arguments", async () => {
		const registry = new CommandRegistry();
		registry.register({
			name: "clear",
			description: "Clear",
			handler: async (args) => textResult(`args='${args}'`),
		});

		const session = createMockSession();
		const result = await registry.dispatch("/clear", session);
		if (result.type === "text") {
			expect(result.content).toBe("args=''");
		}
	});
});

// ── Phase 3.5.3: Dot-notation dispatch ──────────────────────────────

describe("CommandRegistry dot-notation dispatch", () => {
	it("splits command.suffix and prepends dot to args", async () => {
		const registry = new CommandRegistry();
		let receivedArgs = "";
		registry.register({
			name: "builder",
			description: "Builder",
			handler: async (args) => {
				receivedArgs = args;
				return textResult("ok");
			},
		});

		const session = createMockSession();
		await registry.dispatch("/builder.SineGenerator", session);
		expect(receivedArgs).toBe(".SineGenerator");
	});

	it("combines dot-suffix with existing args", async () => {
		const registry = new CommandRegistry();
		let receivedArgs = "";
		registry.register({
			name: "builder",
			description: "Builder",
			handler: async (args) => {
				receivedArgs = args;
				return textResult("ok");
			},
		});

		const session = createMockSession();
		await registry.dispatch("/builder.SineGenerator add SimpleGain", session);
		expect(receivedArgs).toBe(".SineGenerator add SimpleGain");
	});

	it("handles multiple dots in suffix", async () => {
		const registry = new CommandRegistry();
		let receivedArgs = "";
		registry.register({
			name: "builder",
			description: "Builder",
			handler: async (args) => {
				receivedArgs = args;
				return textResult("ok");
			},
		});

		const session = createMockSession();
		await registry.dispatch("/builder.Sine.Gain.pitch", session);
		expect(receivedArgs).toBe(".Sine.Gain.pitch");
	});

	it("works with plain command name (no dots)", async () => {
		const registry = new CommandRegistry();
		let receivedArgs = "";
		registry.register({
			name: "builder",
			description: "Builder",
			handler: async (args) => {
				receivedArgs = args;
				return textResult("ok");
			},
		});

		const session = createMockSession();
		await registry.dispatch("/builder", session);
		expect(receivedArgs).toBe("");
	});

	it("returns error for unknown base command with dots", async () => {
		const registry = new CommandRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/unknown.path", session);
		expect(result.type).toBe("error");
	});
});
