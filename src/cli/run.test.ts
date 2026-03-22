import { describe, expect, it } from "vitest";
import { executeCliCommand } from "./run.js";
import { createSession } from "../session-bootstrap.js";
import { MockHiseConnection } from "../engine/hise.js";
import type { DataLoader } from "../engine/data.js";
import { listCliCommands } from "./commands.js";

function getCliCommands() {
	return listCliCommands(createSession({ connection: null }).session.allCommands());
}

function createDataLoader(): DataLoader {
	return {
		async loadModuleList() {
			return { modules: [], categories: {} } as never;
		},
		async loadScriptingApi() {
			return { classes: [] } as never;
		},
		async loadScriptnodeList() {
			return { factories: [], nodes: [] } as never;
		},
	};
}

describe("executeCliCommand", () => {
	it("returns JSON envelope for script expressions", async () => {
		const connection = new MockHiseConnection()
			.setProbeResult(true)
			.onPost("/api/repl", () => ({
				success: true,
				result: "ok",
				value: 234,
				logs: [],
				errors: [],
			}));

		const result = await executeCliCommand(
			["node", "hise-cli", "-script", "Console.print(234)"],
			getCliCommands(),
			createDataLoader(),
			connection,
		);

		expect(result.kind).toBe("json");
		if (result.kind === "json") {
			expect(result.payload.ok).toBe(true);
			expect(result.payload.command).toBe("/script Console.print(234)");
			expect(result.payload.result.type).toBe("markdown");
			if (result.payload.result.type === "markdown") {
				expect(result.payload.result.content).toContain("234");
			}
		}
	});

	it("serializes root slash commands through the same path", async () => {
		const result = await executeCliCommand(
			["node", "hise-cli", "-modes"],
			getCliCommands(),
			createDataLoader(),
			new MockHiseConnection().setProbeResult(true),
		);

		expect(result.kind).toBe("json");
		if (result.kind === "json") {
			expect(result.payload.command).toBe("/modes");
			expect(result.payload.result.type).toBe("table");
		}
	});
});
