import { describe, expect, it } from "vitest";
import { CommandRegistry, type CommandSession } from "./registry.js";
import { registerBuiltinCommands } from "./slash.js";
import type { CommandResult } from "../result.js";
import { textResult } from "../result.js";

function createMockSession(): CommandSession & { modes: string[]; quitRequested: boolean } {
	const modes: string[] = [];
	let quitRequested = false;
	return {
		modes,
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
		popMode() {
			if (modes.length === 0) {
				return textResult("Already at root.");
			}
			modes.pop();
			return textResult("Exited mode.");
		},
		requestQuit() {
			quitRequested = true;
		},
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
		expect(names).toContain("import");
		expect(names).toContain("wizard");
	});

	it("/help returns overlay", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/help", session);
		expect(result.type).toBe("overlay");
		if (result.type === "overlay") {
			expect(result.title).toContain("Help");
			expect(result.lines.length).toBeGreaterThan(0);
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

	it("/script with processor arg includes it", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		await registry.dispatch("/script MyProcessor", session);
		expect(session.modes).toContain("script:MyProcessor");
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

	it("/wizard without args returns error", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/wizard", session);
		expect(result.type).toBe("error");
	});

	it("/wizard with id returns not-implemented error", async () => {
		const registry = createRegistry();
		const session = createMockSession();
		const result = await registry.dispatch("/wizard broadcaster", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("broadcaster");
		}
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
