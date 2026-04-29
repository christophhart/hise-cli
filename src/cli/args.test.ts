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

	it("passes multi-word verb args through without re-quoting", () => {
		const result = parseCliArgs(["node", "hise-cli", "-builder", "show tree"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/builder show tree");
		}
	});

	it("strips matching outer double quotes from a tail arg (Git Bash on Windows)", () => {
		const result = parseCliArgs(["node", "hise-cli", "-builder", '"show tree"'], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/builder show tree");
		}
	});

	it("strips matching outer single quotes from a tail arg", () => {
		const result = parseCliArgs(["node", "hise-cli", "-builder", "'show tree'"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/builder show tree");
		}
	});

	it("preserves internal quotes inside an arg (e.g. quoted identifiers)", () => {
		const result = parseCliArgs(["node", "hise-cli", "-builder", 'add "MyGain"'], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe('/builder add "MyGain"');
		}
	});
});

describe("parseCliArgs --run verbosity", () => {
	it("defaults to summary verbosity", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "foo.hsc"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.verbosity).toBe("summary");
			expect(result.source).toEqual({ type: "file", path: "foo.hsc" });
		}
	});

	it("--verbose alias sets verbose", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "foo.hsc", "--verbose"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") expect(result.verbosity).toBe("verbose");
	});

	it("--quiet alias sets quiet", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "foo.hsc", "--quiet"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") expect(result.verbosity).toBe("quiet");
	});

	it("--verbosity=<level> wins over alias", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "--run", "foo.hsc", "--quiet", "--verbosity=summary"],
			getCliCommands(),
		);
		expect(result.kind).toBe("run");
		if (result.kind === "run") expect(result.verbosity).toBe("summary");
	});

	it("rejects unknown --verbosity value", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "--run", "foo.hsc", "--verbosity=bogus"],
			getCliCommands(),
		);
		expect(result.kind).toBe("error");
		if (result.kind === "error") expect(result.message).toContain("Invalid --verbosity");
	});

	it("strips verbosity flags from positional path", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "--run", "--quiet", "foo.hsc"],
			getCliCommands(),
		);
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.source).toEqual({ type: "file", path: "foo.hsc" });
			expect(result.verbosity).toBe("quiet");
		}
	});
});

describe("-wizard mode flag", () => {
	it("parses -wizard list", () => {
		const result = parseCliArgs(["node", "hise-cli", "-wizard", "list"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard list");
			expect(result.mode).toBe("root");
		}
	});

	it("parses -wizard get <id>", () => {
		const result = parseCliArgs(["node", "hise-cli", "-wizard", "get", "compile_networks"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard get compile_networks");
		}
	});

	it("parses -wizard run <id>", () => {
		const result = parseCliArgs(["node", "hise-cli", "-wizard", "run", "compile_networks"], getCliCommands());
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard run compile_networks");
		}
	});

	it("parses -wizard run <id> with K=V", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "-wizard", "run", "compile_networks", "with", "Configuration=Release"],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard run compile_networks with Configuration=Release");
		}
	});

	it("parses -wizard run <id> with K=V, K2=V2", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "-wizard", "run", "plugin_export", "with", "Format=VST3,", "ExportType=Plugin"],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.canonicalCommand).toBe("/wizard run plugin_export with Format=VST3, ExportType=Plugin");
		}
	});

	it("supports --mock flag", () => {
		const result = parseCliArgs(
			["node", "hise-cli", "-wizard", "run", "recompile", "--mock"],
			getCliCommands(),
		);
		expect(result.kind).toBe("execute");
		if (result.kind === "execute") {
			expect(result.useMock).toBe(true);
			expect(result.canonicalCommand).toBe("/wizard run recompile");
		}
	});
});

describe("--run subcommand", () => {
	it("parses --run with file path", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "test.hsc"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.source).toEqual({ type: "file", path: "test.hsc" });
			expect(result.dryRun).toBe(false);
			expect(result.useMock).toBe(false);
		}
	});

	it("parses --run with stdin", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "-"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.source).toEqual({ type: "stdin" });
		}
	});

	it("parses --run with --inline", () => {
		const script = "/builder\nadd SineSynth\n/script\n/expect Engine.getSampleRate() is 44100";
		const result = parseCliArgs(["node", "hise-cli", "--run", "--inline", script], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.source).toEqual({ type: "inline", content: script });
		}
	});

	it("supports --mock flag", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "test.hsc", "--mock"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.useMock).toBe(true);
		}
	});

	it("supports --dry-run flag", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "test.hsc", "--dry-run"], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run") {
			expect(result.dryRun).toBe(true);
		}
	});

	it("errors on --inline without content", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run", "--inline"], getCliCommands());
		expect(result.kind).toBe("error");
	});

	it("errors on --run with no source", () => {
		const result = parseCliArgs(["node", "hise-cli", "--run"], getCliCommands());
		expect(result.kind).toBe("error");
	});

	it("accepts bare run (no dashes)", () => {
		const result = parseCliArgs(["node", "hise-cli", "run", "test.hsc"], getCliCommands());
		expect(result.kind).toBe("run");
	});

	it("demangles MSYS path conversion in --inline", () => {
		// Git-bash converts /script to C:/Program Files/Git/script
		const mangled = "C:/Program Files/Git/script\n/expect Engine.getSampleRate() is 44100";
		const result = parseCliArgs(["node", "hise-cli", "--run", "--inline", mangled], getCliCommands());
		expect(result.kind).toBe("run");
		if (result.kind === "run" && result.source.type === "inline") {
			expect(result.source.content).toBe("/script\n/expect Engine.getSampleRate() is 44100");
		}
	});
});
