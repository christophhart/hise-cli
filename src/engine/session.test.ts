import { describe, expect, it } from "vitest";
import { Session } from "./session.js";
import { MockHiseConnection } from "./hise.js";
import type { CommandResult } from "./result.js";
import type { Mode, SessionContext } from "./modes/mode.js";

// ── Test helpers ────────────────────────────────────────────────────

function createStubMode(id: string, response?: CommandResult): Mode {
	return {
		id: id as Mode["id"],
		name: id.charAt(0).toUpperCase() + id.slice(1),
		accent: "#ffffff",
		prompt: `[${id}] > `,
		async parse(_input: string, _session: SessionContext) {
			return response ?? { type: "text", content: `${id}: ${_input}` };
		},
	};
}

function createSession(): Session {
	const session = new Session(null);
	// Register a few stub modes for testing
	session.registerMode("script", (ctx) =>
		createStubMode(ctx ? `script:${ctx}` : "script"),
	);
	session.registerMode("builder", () => createStubMode("builder"));
	session.registerMode("inspect", () => createStubMode("inspect"));
	return session;
}

// ── Session basics ──────────────────────────────────────────────────

describe("Session", () => {
	it("starts in root mode", () => {
		const session = createSession();
		expect(session.currentMode().id).toBe("root");
		expect(session.modeStackDepth).toBe(0);
	});

	it("accepts a null connection", () => {
		const session = new Session(null);
		expect(session.connection).toBeNull();
	});

	it("accepts a HiseConnection", () => {
		const mock = new MockHiseConnection();
		const session = new Session(mock);
		expect(session.connection).toBe(mock);
	});
});

// ── Mode stack ──────────────────────────────────────────────────────

describe("Session mode stack", () => {
	it("pushes a registered mode", () => {
		const session = createSession();
		const result = session.pushMode("builder");
		expect(result).toBeNull(); // success
		expect(session.currentMode().id).toBe("builder");
		expect(session.modeStackDepth).toBe(1);
	});

	it("pushes mode with context", () => {
		const session = createSession();
		session.pushMode("script:Interface");
		expect(session.currentMode().id).toBe("script:Interface");
	});

	it("returns error for unregistered mode", () => {
		const session = createSession();
		const result = session.pushMode("nonexistent");
		expect(result).not.toBeNull();
		expect(result!.type).toBe("error");
	});

	it("pops back to previous mode", () => {
		const session = createSession();
		session.pushMode("builder");
		expect(session.currentMode().id).toBe("builder");

		const result = session.popMode();
		expect(result.type).toBe("text");
		expect(session.currentMode().id).toBe("root");
	});

	it("pops at root signals quit", () => {
		const session = createSession();
		expect(session.shouldQuit).toBe(false);

		session.popMode();
		expect(session.shouldQuit).toBe(true);
	});

	it("supports nested mode stack", () => {
		const session = createSession();
		session.pushMode("builder");
		session.pushMode("inspect");
		expect(session.modeStackDepth).toBe(2);
		expect(session.currentMode().id).toBe("inspect");

		session.popMode();
		expect(session.currentMode().id).toBe("builder");

		session.popMode();
		expect(session.currentMode().id).toBe("root");
	});
});

// ── Input dispatch ──────────────────────────────────────────────────

describe("Session input dispatch", () => {
	it("dispatches slash commands to registry", async () => {
		const session = createSession();
		const result = await session.handleInput("/help");
		expect(result.type).toBe("text");
	});

	it("dispatches plain input to current mode", async () => {
		const session = createSession();
		session.pushMode("script");
		const result = await session.handleInput("Engine.getSampleRate()");
		expect(result.type).toBe("text");
		if (result.type === "text") {
			expect(result.content).toContain("Engine.getSampleRate()");
		}
	});

	it("root mode rejects plain input", async () => {
		const session = createSession();
		const result = await session.handleInput("something");
		expect(result.type).toBe("error");
	});

	it("empty input returns empty result", async () => {
		const session = createSession();
		const result = await session.handleInput("");
		expect(result.type).toBe("empty");
	});

	it("whitespace-only input returns empty result", async () => {
		const session = createSession();
		const result = await session.handleInput("   ");
		expect(result.type).toBe("empty");
	});

	it("/builder switches to builder mode", async () => {
		const session = createSession();
		await session.handleInput("/builder");
		expect(session.currentMode().id).toBe("builder");
	});

	it("/script Interface switches to script mode with context", async () => {
		const session = createSession();
		await session.handleInput("/script Interface");
		expect(session.currentMode().id).toBe("script:Interface");
	});

	it("/exit pops mode", async () => {
		const session = createSession();
		await session.handleInput("/builder");
		expect(session.currentMode().id).toBe("builder");

		await session.handleInput("/exit");
		expect(session.currentMode().id).toBe("root");
	});

	it("/clear returns empty", async () => {
		const session = createSession();
		const result = await session.handleInput("/clear");
		expect(result.type).toBe("empty");
	});

	it("/modes returns table", async () => {
		const session = createSession();
		const result = await session.handleInput("/modes");
		expect(result.type).toBe("table");
	});
});

// ── History tracking ────────────────────────────────────────────────

describe("Session history", () => {
	it("records input in history", async () => {
		const session = createSession();
		session.pushMode("script");
		await session.handleInput("first");
		await session.handleInput("second");
		expect(session.history).toEqual(["first", "second"]);
	});

	it("deduplicates consecutive identical inputs", async () => {
		const session = createSession();
		session.pushMode("script");
		await session.handleInput("same");
		await session.handleInput("same");
		await session.handleInput("different");
		await session.handleInput("same");
		expect(session.history).toEqual(["same", "different", "same"]);
	});

	it("does not record empty input", async () => {
		const session = createSession();
		await session.handleInput("");
		await session.handleInput("   ");
		expect(session.history).toHaveLength(0);
	});

	it("records slash commands in history", async () => {
		const session = createSession();
		await session.handleInput("/help");
		expect(session.history).toContain("/help");
	});
});
