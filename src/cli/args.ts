import type { CommandEntry } from "../engine/commands/registry.js";

export type CliParseResult =
	| { kind: "tui"; args: string[] }
	| { kind: "help"; scope?: string }
	| { kind: "error"; message: string }
	| { kind: "diagnose"; filePath: string }
	| { kind: "run"; source: { type: "file"; path: string } | { type: "stdin" } | { type: "inline"; content: string }; dryRun: boolean; useMock: boolean; watch: boolean }
	| {
		kind: "execute";
		entry: CommandEntry;
		canonicalCommand: string;
		mode: string;
		useMock: boolean;
	};

const RESERVED_FLAGS = new Set(["--help", "-h", "--mock", "--dry-run", "--watch"]);

/**
 * Reverse MSYS/git-bash path mangling on inline script content.
 * Git-bash on Windows converts leading `/word` in arguments to
 * `C:/Program Files/Git/word`. This undoes that for each line.
 * E.g. "C:/Program Files/Git/script" → "/script"
 */
function demangleMsys(content: string): string {
	// Only applies on Windows with MSYS-style paths
	return content.replace(
		/^([A-Z]:\/(?:Program Files|msys64)\/Git\/)(\S+)/gm,
		(_match, _prefix, rest) => `/${rest}`,
	);
}

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

	// --run <file.hsc | - | --inline "script"> [--mock] [--dry-run]
	if (first === "--run" || first === "-run" || first === "run") {
		const rest = args.slice(1);
		const useMock = rest.includes("--mock");
		const dryRun = rest.includes("--dry-run");
		const watch = rest.includes("--watch");
		const inlineIdx = rest.indexOf("--inline");

		if (inlineIdx !== -1) {
			const content = rest[inlineIdx + 1];
			if (!content) {
				return { kind: "error", message: "--inline requires a script string argument" };
			}
			if (watch) {
				return { kind: "error", message: "--watch cannot be used with --inline" };
			}
			return { kind: "run", source: { type: "inline", content: demangleMsys(content) }, dryRun, useMock, watch: false };
		}

		const positional = rest.find((a) => !a.startsWith("--"));
		if (!positional) {
			return { kind: "error", message: "--run requires a file path, -, or --inline <script>" };
		}
		if (positional === "-") {
			if (watch) {
				return { kind: "error", message: "--watch cannot be used with stdin" };
			}
			return { kind: "run", source: { type: "stdin" }, dryRun, useMock, watch: false };
		}
		return { kind: "run", source: { type: "file", path: positional }, dryRun, useMock, watch };
	}

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
	// Find the first arg that matches a registered command flag.
	// Everything after it is treated as tail args (not as command flags),
	// so `-script --compile` doesn't clash with the /compile command.
	let commandFlag: string | undefined;
	let entry: CommandEntry | undefined;
	for (const arg of args) {
		if (RESERVED_FLAGS.has(arg)) continue;
		if (arg.startsWith("--target:")) continue;
		if (flagToEntry.has(arg)) {
			commandFlag = arg;
			entry = flagToEntry.get(arg)!;
			break;
		}
	}

	if (!commandFlag || !entry) {
		return { kind: "tui", args };
	}

	const useMock = args.includes("--mock");
	const targetArg = args.find((arg) => arg.startsWith("--target:"));
	const target = targetArg ? targetArg.slice("--target:".length) : "";

	if (target && entry.kind !== "mode") {
		return { kind: "error", message: `${commandFlag} does not support --target` };
	}

	const tailParts = args.filter((arg) => arg !== commandFlag && arg !== targetArg && arg !== "--mock");
	// Re-quote args that contain spaces (shell strips the user's quotes).
	// Normalize --subcommand to /subcommand for mode one-shots
	// (e.g. hise-cli -script --compile → /script /compile).
	const tail = tailParts.map((p) => {
		if (p.startsWith("--") && !p.includes("=") && entry.kind === "mode") {
			return "/" + p.slice(2);
		}
		return p.includes(" ") ? `"${p}"` : p;
	}).join(" ").trim();

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
