import { describe, expect, it } from "vitest";
import { parseCliArgs } from "./args.js";
import { createSession } from "../session-bootstrap.js";
import { listCliCommands } from "./commands.js";

function getCliCommands() {
	return listCliCommands(createSession({ connection: null }).session.allCommands());
}

describe("parseCliArgs", () => {
	it("parses one-shot script invocation", () => {
		const result = parseCliArgs(["node", "hise-cli", "-script", "Console.print(234)"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/script Console.print(234)");
			expect(result.mode).toBe("script");
		}
	});

	it("parses target path for mode commands", () => {
		const result = parseCliArgs(["node", "hise-cli", "-builder", "--target:SineGenerator", "add", "LFO"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/builder.SineGenerator add LFO");
		}
	});

	it("rejects missing one-shot tail for mode commands", () => {
		const result = parseCliArgs(["node", "hise-cli", "-script"], getCliCommands());
		expect(result).toEqual({
			kind: "error",
			message: "-script requires a one-shot command or expression",
		});
	});

	it("reserves --help for native CLI help", () => {
		const result = parseCliArgs(["node", "hise-cli", "--help"], getCliCommands());
		expect(result).toEqual({ kind: "help" });
	});

	it("supports root commands", () => {
		const result = parseCliArgs(["node", "hise-cli", "-modes"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/modes");
			expect(result.mode).toBe("root");
		}
	});

	it("preserves TUI-only flags when launching repl", () => {
		const result = parseCliArgs(["node", "hise-cli", "--no-animation"], getCliCommands());
		expect(result).toEqual({ kind: "tui", args: ["--no-animation"] });
	});
});

describe("wizard subcommand", () => {
	it("parses wizard list", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard", "list"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard list");
			expect(result.mode).toBe("root");
		}
	});

	it("defaults bare wizard to list", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard list");
		}
	});

	it("parses wizard --schema", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard", "plugin_export", "--schema"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard plugin_export --schema");
		}
	});

	it("parses wizard --answers with JSON", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "wizard", "plugin_export", "--answers", '{"ExportType":"Plugin","Format":"VST"}'],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toContain("/wizard plugin_export --run");
			expect(result.canonicalCommand).toContain("ExportType:Plugin");
			expect(result.canonicalCommand).toContain("Format:VST");
		}
	});

	it("parses wizard --answers with empty JSON", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "wizard", "recompile", "--answers", "{}"],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard recompile --run");
		}
	});

	it("errors on wizard id without --schema or --answers", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard", "plugin_export"], getCliCommands());
		expect(result).toEqual({
			kind: "error",
			message: "wizard subcommand requires --schema or --answers",
		});
	});

	it("errors on --answers without JSON argument", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard", "plugin_export", "--answers"], getCliCommands());
		expect(result).toEqual({
			kind: "error",
			message: "--answers requires a JSON string argument",
		});
	});

	it("errors on --answers with invalid JSON", () => {
		const result = parseCliArgs(["node", "hise-cli", "wizard", "plugin_export", "--answers", "not-json"], getCliCommands());
		expect(result.kind).toBe("error");
		if (result.kind === "error") {
			expect(result.message).toContain("invalid JSON");
		}
	});

	it("supports --mock flag", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "wizard", "recompile", "--mock", "--answers", "{}"],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.useMock).toBe(true);
		}
	});
});
