import type { CommandEntry } from "../engine/commands/registry.js";

export type CliParseResult =
	| { kind: "tui"; args: string[] }
	| { kind: "help"; scope?: string }
	| { kind: "error"; message: string }
	| { kind: "diagnose"; filePath: string }
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

	// --help with no mode flag → global help
	// -builder --help or wizard --help → scoped help
	if (args.includes("--help") || args.includes("-h")) {
		const nonHelp = args.filter((a) => a !== "--help" && a !== "-h");
		if (nonHelp.length === 0) return { kind: "help" };
		const scopeArg = nonHelp[0]!;
		const scope = scopeArg.replace(/^-{1,2}/, "");
		return { kind: "help", scope };
	}

	const first = args[0]!;
	if (first === "repl") {
		return { kind: "tui", args: args.slice(1) };
	}

	if (first === "diagnose") {
		const rest = args.slice(1);
		if (rest.length === 0) {
			return { kind: "error", message: "diagnose requires a file path argument" };
		}
		return { kind: "diagnose", filePath: rest[0]! };
	}

	if (first === "wizard") {
		if (args.includes("--help") || args.includes("-h")) return { kind: "help", scope: "wizard" };
		return parseWizardSubcommand(args.slice(1), commands);
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
	// Re-quote args that contain spaces (shell strips the user's quotes)
	const tail = tailParts.map((p) => p.includes(" ") ? `"${p}"` : p).join(" ").trim();

	if (entry.kind === "mode" && tail === "") {
		return { kind: "error", message: `${commandFlag} requires a one-shot command or expression` };
	}

	const mode = entry.kind === "mode" ? entry.name : "root";
	const targetSuffix = target ? `.${target}` : "";
	const canonicalCommand = `/${entry.name}${targetSuffix}${tail ? ` ${tail}` : ""}`;

	return { kind: "execute", entry, canonicalCommand, mode, useMock };
}

// ── wizard subcommand ────────────────────────────────────────────────

const WIZARD_RESERVED = new Set(["--mock", "--schema", "--answers"]);

function parseWizardSubcommand(args: string[], commands: CommandEntry[]): CliParseResult {
	const wizardEntry = commands.find((c) => c.name === "wizard");
	if (!wizardEntry) {
		return { kind: "error", message: "Wizard command not available" };
	}

	const useMock = args.includes("--mock");
	const rest = args.filter((a) => a !== "--mock");

	if (rest.length === 0 || rest[0] === "list") {
		return { kind: "execute", entry: wizardEntry, canonicalCommand: "/wizard list", mode: "root", useMock };
	}

	const wizardId = rest[0]!;

	if (rest.includes("--schema")) {
		return { kind: "execute", entry: wizardEntry, canonicalCommand: `/wizard ${wizardId} --schema`, mode: "root", useMock };
	}

	const answersIdx = rest.indexOf("--answers");
	if (answersIdx === -1) {
		return { kind: "error", message: "wizard subcommand requires --schema or --answers" };
	}

	const answersJson = rest[answersIdx + 1];
	if (!answersJson) {
		return { kind: "error", message: "--answers requires a JSON string argument" };
	}

	let answers: Record<string, string>;
	try {
		answers = JSON.parse(answersJson);
	} catch {
		return { kind: "error", message: `--answers: invalid JSON: ${answersJson}` };
	}

	const prefillTokens = Object.entries(answers)
		.map(([k, v]) => `${k}:${v}`)
		.join(" ");

	const canonicalCommand = `/wizard ${wizardId} --run${prefillTokens ? ` ${prefillTokens}` : ""}`;
	return { kind: "execute", entry: wizardEntry, canonicalCommand, mode: "root", useMock };
}
