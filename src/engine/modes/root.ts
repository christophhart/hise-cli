// ── Root mode — default when no mode is active ──────────────────────

import type { CommandResult } from "../result.js";
import { errorResult } from "../result.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";

export class RootMode implements Mode {
	readonly id = "root" as const;
	readonly name = "Root";
	readonly accent = MODE_ACCENTS.root;
	readonly prompt = "> ";

	async parse(_input: string, _session: SessionContext): Promise<CommandResult> {
		// Root mode rejects all non-slash input. Slash commands are
		// intercepted by Session.handleInput before reaching mode.parse().
		return errorResult(
			"No mode active. Type /help for available commands.",
		);
	}

	complete(_input: string, _cursor: number): CompletionResult {
		// Slash command completions are handled by the command registry,
		// not by root mode. Return empty results.
		return { items: [], from: 0, to: 0 };
	}
}
