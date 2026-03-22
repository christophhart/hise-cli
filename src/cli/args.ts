import type { CommandEntry } from "../engine/commands/registry.js";

export type CliParseResult =
	| { kind: "tui"; args: string[] }
	| { kind: "help" }
	| { kind: "error"; message: string }
	| {
		kind: "execute";
		entry: CommandEntry;
		canonicalCommand: string;
		mode: string;
		useMock: boolean;
	};

const RESERVED_FLAGS = new Set(["--help", "-h", "--mock"]);

export function parseCliArgs(argv: string[], commands: CommandEntry[]): CliParseResult {
	const args = argv.slice(2);
	if (args.length === 0) return { kind: "tui", args: [] };
	if (args.includes("--help") || args.includes("-h")) return { kind: "help" };

	const first = args[0]!;
	if (first === "repl") {
		return { kind: "tui", args: args.slice(1) };
	}

	const flagToEntry = new Map<string, CommandEntry>();
	for (const command of commands) {
		flagToEntry.set(`-${command.name}`, command);
		flagToEntry.set(`--${command.name}`, command);
	}
	const commandFlags = args.filter((arg) => {
		if (RESERVED_FLAGS.has(arg)) return false;
		if (arg.startsWith("--target:")) return false;
		return flagToEntry.has(arg);
	});

	if (commandFlags.length === 0) {
		return { kind: "tui", args };
	}

	if (commandFlags.length > 1) {
		return { kind: "error", message: `Multiple command flags provided: ${commandFlags.join(", ")}` };
	}

	const commandFlag = commandFlags[0]!;
	const entry = flagToEntry.get(commandFlag)!;

	const useMock = args.includes("--mock");
	const targetArg = args.find((arg) => arg.startsWith("--target:"));
	const target = targetArg ? targetArg.slice("--target:".length) : "";

	if (target && entry.kind !== "mode") {
		return { kind: "error", message: `${commandFlag} does not support --target` };
	}

	const tailParts = args.filter((arg) => arg !== commandFlag && arg !== targetArg && arg !== "--mock");
	const tail = tailParts.join(" ").trim();

	if (entry.kind === "mode" && tail === "") {
		return { kind: "error", message: `${commandFlag} requires a one-shot command or expression` };
	}

	const mode = entry.kind === "mode" ? entry.name : "root";
	const targetSuffix = target ? `.${target}` : "";
	const canonicalCommand = `/${entry.name}${targetSuffix}${tail ? ` ${tail}` : ""}`;

	return { kind: "execute", entry, canonicalCommand, mode, useMock };
}
