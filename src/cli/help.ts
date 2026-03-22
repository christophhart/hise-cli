import type { CommandEntry } from "../engine/commands/registry.js";

export function renderCliHelp(commands: CommandEntry[]): string {
	const modeCommands = commands.filter((c) => c.kind === "mode");
	const rootCommands = commands.filter((c) => c.kind !== "mode");

	const lines = [
		"HISE CLI",
		"",
		"One-shot automation frontend with JSON output.",
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
		"Mode commands:",
		...modeCommands.map((cmd) => `  -${cmd.name.padEnd(9)} ${cmd.description}`),
		"",
		"Root commands:",
		...rootCommands.map((cmd) => `  -${cmd.name.padEnd(9)} ${cmd.description}`),
		"",
		"Notes:",
		"  - One-shot mode commands require a command or expression tail.",
		"  - Results are printed as JSON to stdout.",
	];

	return lines.join("\n");
}
