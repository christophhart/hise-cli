// ── Inspect mode — runtime monitoring via GET /api/status ───────────

import { isErrorResponse, isSuccessResponse } from "../hise.js";
import type { CommandResult } from "../result.js";
import { errorResult, markdownResult } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeInspect } from "../highlight/inspect.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";
import { normalizeStatusPayload, type StatusPayload } from "../../mock/contracts/status.js";

const INSPECT_COMMANDS = new Map<string, string>([
	["version", "Show HISE server version information"],
	["project", "Show current project information"],
	["help", "Show inspect mode commands"],
]);

export class InspectMode implements Mode {
	readonly id: Mode["id"] = "inspect";
	readonly name = "Inspect";
	readonly accent = MODE_ACCENTS.inspect;
	readonly prompt = "[inspect] > ";
	private readonly completionEngine: CompletionEngine | null;

	constructor(completionEngine?: CompletionEngine) {
		this.completionEngine = completionEngine ?? null;
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeInspect(value);
	}

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) {
			return { items: [], from: 0, to: input.length };
		}

		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const items = this.completionEngine.completeInspect(trimmed);
		return { items, from: leadingSpaces, to: input.length, label: "Inspect commands" };
	}

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		const trimmed = input.trim().toLowerCase();
		const command = trimmed.split(/\s+/)[0];

		if (!command || command === "help") {
			const rows = [...INSPECT_COMMANDS.entries()].map(([cmd, desc]) => `| \`${cmd}\` | ${desc} |`);
			return markdownResult(`## Inspect Commands

| Command | Description |
|---------|-------------|
${rows.join("\n")}`);
		}

		if (!INSPECT_COMMANDS.has(command)) {
			return errorResult(`Unknown inspect command: "${command}". Type "help" for available commands.`);
		}

		if (!session.connection) {
			return errorResult("No HISE connection. Connect to HISE before using inspect mode.");
		}

		const response = await session.connection.get("/api/status");
		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isSuccessResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}

		let data: StatusPayload;
		try {
			data = extractStatusPayload(response);
		} catch (error) {
			return errorResult(String(error));
		}

		switch (command) {
			case "version":
				return formatVersion(data);
			case "project":
				return formatProject(data);
			default:
				return errorResult(`Unhandled command: ${command}`);
		}
	}
}

export function extractStatusPayload(response: Record<string, unknown>): StatusPayload {
	// New API: server, project, scriptProcessors are top-level fields
	if (response.server && response.project) {
		return normalizeStatusPayload(response);
	}
	// Legacy: payload inside value or result
	if (response.value && typeof response.value === "object") {
		return normalizeStatusPayload(response.value);
	}
	if (typeof response.result === "string" && response.result !== "") {
		return normalizeStatusPayload(JSON.parse(response.result) as unknown);
	}
	throw new Error("Status response payload missing");
}

export function formatVersion(data: Pick<StatusPayload, "server">): CommandResult {
	const sha = data.server.buildCommit ? data.server.buildCommit.slice(0, 7) : "N/A";
	const markdown = `## Server Version

| Field | Value |
|-------|-------|
| Version | ${data.server.version} |
| Compile Timeout | ${data.server.compileTimeout ?? "N/A"} |
| Build Commit | ${sha} |`;
	return markdownResult(markdown);
}

export function formatProject(data: Pick<StatusPayload, "project" | "scriptProcessors">): CommandResult {
	const processors = data.scriptProcessors.map((processor) => `- \`${processor.moduleId}\`${processor.isMainInterface ? " (main interface)" : ""}`).join("\n") || "- none";
	const markdown = `## Project

| Field | Value |
|-------|-------|
| Name | ${data.project.name} |
| Project Folder | ${data.project.projectFolder} |
| Scripts Folder | ${data.project.scriptsFolder} |

### Script Processors

${processors}`;
	return markdownResult(markdown);
}
