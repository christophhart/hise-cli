// ── Embed runnability analyzer — fail-fast pre-flight for the web bundle.
//
// Walks a parsed script with mode-stack tracking and returns the first
// command that cannot run in the web-embed bundle. Pure registry lookup +
// static blocklist — no Session, no datasets, no HTTP. Cheap enough to
// call per code snippet on a docs page to decide whether to show "Run".

import type { CommandRegistry } from "../commands/registry.js";
import type { ModeId } from "../modes/mode.js";
import { SLASH_MODE_IDS } from "../modes/mode.js";
import type { ParsedScript, ScriptLine } from "./types.js";

export interface EmbedRunnability {
	runnable: boolean;
	/** First blocked line (fail-fast). Absent when runnable. */
	blocked?: {
		line: number;
		content: string;
		reason: string;
	};
}

/**
 * Per-mode block predicates for mode-context input (no slash) and one-shot
 * mode entry args (e.g. `/hise launch`). Return reason if blocked, null
 * otherwise. Kept as a static map so the analyzer needs no live Mode
 * instance — the website calls this without spinning up a session.
 */
export const MODE_EMBED_BLOCKLIST: Partial<
	Record<ModeId, (input: string) => string | null>
> = {
	hise(input) {
		const cmd = input.trim().split(/\s+/)[0]?.toLowerCase();
		if (cmd === "launch") {
			return "Launching HISE needs the local CLI.";
		}
		return null;
	},
};

/**
 * Analyse a parsed script for web-embed runnability. Fail-fast — returns
 * on the first command that cannot run in the embed bundle. Lighter than
 * `validateScript` (no Chevrotain, no semantic checks) so docs pages can
 * call it for every snippet to decide whether to show a "Run" button.
 */
export function analyzeScriptForEmbed(
	script: ParsedScript,
	registry: CommandRegistry,
): EmbedRunnability {
	let currentMode: ModeId = "root";
	const stack: ModeId[] = ["root"];

	for (const line of script.lines) {
		if (line.kind === "slash") {
			const { name, args } = extractSlashName(line.content);

			if (name === "exit") {
				if (stack.length > 1) {
					stack.pop();
					currentMode = stack[stack.length - 1]!;
				}
				continue;
			}

			const entry = registry.get(name);
			if (entry?.embedBlockedReason) {
				return blockedAt(line, entry.embedBlockedReason);
			}

			if (SLASH_MODE_IDS.has(name)) {
				const modeId = (name === "export" ? "compile" : name) as ModeId;
				if (args) {
					const reason = MODE_EMBED_BLOCKLIST[modeId]?.(args);
					if (reason) return blockedAt(line, reason);
				} else {
					stack.push(modeId);
					currentMode = modeId;
				}
			}
			continue;
		}

		if (currentMode !== "root") {
			const reason = MODE_EMBED_BLOCKLIST[currentMode]?.(line.content);
			if (reason) return blockedAt(line, reason);
		}
	}

	return { runnable: true };
}

function blockedAt(line: ScriptLine, reason: string): EmbedRunnability {
	return {
		runnable: false,
		blocked: { line: line.lineNumber, content: line.content, reason },
	};
}

function extractSlashName(content: string): { name: string; args: string } {
	const withoutSlash = content.slice(1);
	const dotIdx = withoutSlash.indexOf(".");
	const spaceIdx = withoutSlash.indexOf(" ");

	let nameEnd: number;
	if (dotIdx !== -1 && (spaceIdx === -1 || dotIdx < spaceIdx)) {
		nameEnd = dotIdx;
	} else if (spaceIdx !== -1) {
		nameEnd = spaceIdx;
	} else {
		nameEnd = withoutSlash.length;
	}

	const name = withoutSlash.slice(0, nameEnd);
	const args = withoutSlash.slice(nameEnd).trim();
	return { name, args };
}
