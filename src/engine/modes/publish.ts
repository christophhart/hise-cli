// ── /publish mode — installer build & sign ─────────────────────────
//
// Thin wrapper around the `build_installer` wizard. Adds two preflight
// verbs (`check system`, `check binaries`) and a `build` verb that
// dispatches to `/wizard run build_installer with K=V, ...` via
// `session.handleInput()`. Mirrors the `/project export` →
// `/wizard run plugin_export` pattern from project.ts.

import type { CommandResult } from "../result.js";
import { errorResult, markdownResult } from "../result.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import { parsePayloadList } from "./publish-parse.js";

const PUBLISH_VERBS = new Map<string, string>([
	["check", "check system | check binaries <Csv>"],
	["build", "build [with K=V, K2=V2] — runs build_installer wizard"],
	["help", "Show /publish commands"],
]);

const VERB_LIST = Array.from(PUBLISH_VERBS.keys());

export class PublishMode implements Mode {
	readonly id: Mode["id"] = "publish";
	readonly name = "Publish";
	readonly accent = MODE_ACCENTS.publish;
	readonly prompt = "[publish] > ";

	complete(input: string, _cursor: number): CompletionResult {
		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const lastSpace = input.lastIndexOf(" ");
		const from = lastSpace === -1 ? leadingSpaces : lastSpace + 1;

		// Verb-only completion at the head of the line. Sub-verbs land in PR5.
		if (lastSpace === -1) {
			const items = VERB_LIST
				.filter((v) => v.startsWith(trimmed.toLowerCase()))
				.map((v) => ({ label: v, detail: PUBLISH_VERBS.get(v) }));
			return { items, from, to: input.length, label: "Publish commands" };
		}
		return { items: [], from, to: input.length };
	}

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		const trimmed = input.trim();
		if (!trimmed) return helpResult();

		const spaceIndex = trimmed.indexOf(" ");
		const verb = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
		const rest = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

		if (verb === "help") return helpResult();
		if (!PUBLISH_VERBS.has(verb)) {
			return errorResult(
				`Unknown /publish command: "${verb}". Type \`help\` for the list.`,
			);
		}

		switch (verb) {
			case "check":
				return this.handleCheck(rest);
			case "build":
				return this.handleBuild(rest, session);
		}
		return errorResult(`Unhandled verb: ${verb}`);
	}

	private async handleCheck(rest: string): Promise<CommandResult> {
		const tokens = rest.split(/\s+/).filter((t) => t.length > 0);
		const sub = tokens[0]?.toLowerCase();
		if (!sub) {
			return errorResult("check requires a target: system | binaries <Csv>");
		}
		switch (sub) {
			case "system":
				// Full impl lands in PR5 (init handler reuse). Skeleton stub for now.
				return markdownResult(
					"## /publish check system\n\n_Preflight checks land in a follow-up PR. " +
						"Run `/wizard build_installer` to trigger the init handler manually._",
				);
			case "binaries": {
				const csv = tokens.slice(1).join(" ");
				if (!csv) {
					return errorResult(
						"check binaries requires a CSV list: VST3,AU,AAX,Standalone",
					);
				}
				const parsed = parsePayloadList(csv);
				if (!parsed.ok) return errorResult(parsed.error);
				// Filesystem probing lands in PR5 — for now echo the parsed list.
				return markdownResult(
					"## /publish check binaries\n\n" +
						`Targets requested: \`${parsed.targets.join(", ")}\`\n\n` +
						"_Filesystem discovery lands in a follow-up PR._",
				);
			}
			default:
				return errorResult(
					`Unknown check target: "${sub}". Use \`check system\` or \`check binaries <Csv>\`.`,
				);
		}
	}

	private async handleBuild(
		rest: string,
		session: SessionContext,
	): Promise<CommandResult> {
		if (!session.handleInput) {
			return errorResult(
				"This host does not support slash-command dispatch — cannot launch wizard.",
			);
		}
		// Forward verbatim. parseWithClause() in slash.ts handles the trailing
		// "with K=V, K2=V2" form. `rest` may already start with "with ..." or
		// be empty (no overrides).
		const suffix = rest.length > 0 ? ` ${rest}` : "";
		return session.handleInput(`/wizard run build_installer${suffix}`);
	}
}

function helpResult(): CommandResult {
	const lines = [
		"## /publish commands",
		"",
		"| Command | Syntax |",
		"|---------|--------|",
	];
	for (const [verb, desc] of PUBLISH_VERBS) {
		lines.push(`| \`${verb}\` | ${desc} |`);
	}
	return markdownResult(lines.join("\n"));
}
