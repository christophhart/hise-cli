import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandSession } from "./registry.js";
import { textResult } from "../result.js";

function createMockSession(): CommandSession {
	const modes: string[] = [];
	return {
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
		popMode() {
			if (modes.length === 0) {
				return textResult("Already at root.");
			}
			modes.pop();
			return textResult("Exited mode.");
		},
		requestQuit() {},
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
