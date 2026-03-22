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
