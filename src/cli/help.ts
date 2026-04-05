import type { CommandEntry } from "../engine/commands/registry.js";

export function renderCliHelp(commands: CommandEntry[]): string {
	const modeCommands = commands.filter((c) => c.kind === "mode");
	const rootCommands = commands.filter((c) => c.kind !== "mode");

	const lines = [
		"HISE CLI",
		"",
		"One-shot automation frontend with compact JSON output.",
		"Run without arguments or use `repl` to open the TUI.",
		"",
		"Usage:",
		"  hise-cli repl",
		"  hise-cli -script \"Console.print(234)\"",
		"  hise-cli -builder --target:SineGenerator add LFO",
		"  hise-cli -modes",
		"",
		"Options:",
		"  --help           Show this CLI help",
		"  --mock           Use mock HISE connection for one-shot execution",
		"  --target:<path>  Dot-context target for mode commands",
		"",
		"Wizard commands:",
		"  wizard list                          List available wizards",
		"  wizard <id> --schema                 Show field schema as JSON",
		"  wizard <id> --answers '{\"k\":\"v\"}'   Execute wizard with JSON answers",
		"",
		"Mode commands:",
		...modeCommands.map((cmd) => `  -${cmd.name.padEnd(9)} ${cmd.description}`),
		"",
		"Root commands:",
		...rootCommands.map((cmd) => `  -${cmd.name.padEnd(9)} ${cmd.description}`),
		"",
		"Notes:",
		"  - One-shot mode commands require a command or expression tail.",
		"  - `-script` emits semantic REPL output (`logs`, `value`, `error`).",
		"  - Other commands emit `{ ok, result }` JSON to stdout.",
	];

	return lines.join("\n");
}
