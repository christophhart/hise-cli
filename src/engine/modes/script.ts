// ── Script mode — HiseScript REPL via POST /api/repl ────────────────

import type { HiseResponse } from "../hise.js";
import { isErrorResponse, isSuccessResponse } from "../hise.js";
import type { CommandResult } from "../result.js";
import { codeResult, errorResult, textResult } from "../result.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";

export class ScriptMode implements Mode {
	readonly id: Mode["id"] = "script";
	readonly name = "Script";
	readonly accent = MODE_ACCENTS.script;
	readonly prompt: string;
	readonly processorId: string;
	private readonly completionEngine: CompletionEngine | null;

	constructor(processorId = "Interface", completionEngine?: CompletionEngine) {
		this.processorId = processorId;
		this.completionEngine = completionEngine ?? null;
		this.prompt =
			processorId === "Interface"
				? "[script] > "
				: `[script:${processorId}] > `;
	}

	async parse(
		input: string,
		session: SessionContext,
	): Promise<CommandResult> {
		if (!session.connection) {
			return errorResult(
				"No HISE connection. Connect to HISE before using script mode.",
			);
		}

		const response = await session.connection.post("/api/repl", {
			expression: input,
			moduleId: this.processorId,
		});

		return formatReplResponse(response, input);
	}

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) {
			return { items: [], from: 0, to: input.length };
		}

		// Find the last token boundary for completion context.
		// In script mode, we complete the last expression segment
		// (handles "var x = Synth.add" → complete from "Synth.add").
		const token = extractLastToken(input);
		if (!token.text) {
			return { items: [], from: token.from, to: input.length };
		}

		const result = this.completionEngine.completeScript(token.text);
		// Adjust offsets relative to full input
		return {
			items: result.items,
			from: token.from + result.from,
			to: input.length,
		};
	}
}

// ── Token extraction for completion ─────────────────────────────────

/** Extract the last identifier-like token (with dots) from script input. */
export function extractLastToken(input: string): { text: string; from: number } {
	// Walk backwards from end to find the start of the current token.
	// A token is a contiguous run of [A-Za-z0-9_.] characters.
	let i = input.length - 1;
	while (i >= 0 && /[A-Za-z0-9_.]/.test(input[i])) {
		i--;
	}
	const from = i + 1;
	return { text: input.slice(from), from };
}

// ── Response formatting (pure function, testable) ───────────────────

export function formatReplResponse(
	response: HiseResponse,
	_input: string,
): CommandResult {
	if (isErrorResponse(response)) {
		return errorResult(response.message);
	}

	if (!isSuccessResponse(response)) {
		return errorResult("Unexpected response from HISE");
	}

	// Check for script errors in the response
	if (response.errors.length > 0) {
		const errorMessages = response.errors
			.map((e) => {
				const stack =
					e.callstack.length > 0
						? `\n  ${e.callstack.join("\n  ")}`
						: "";
				return `${e.errorMessage}${stack}`;
			})
			.join("\n");
		return errorResult(errorMessages);
	}

	// Build result from logs and value
	const parts: string[] = [];

	// Console output (logs)
	if (response.logs.length > 0) {
		parts.push(response.logs.join("\n"));
	}

	// Evaluation result — the value field contains the actual result
	// (not the result field, which is a fixed status string like "REPL Evaluation OK")
	if (response.value !== undefined) {
		const formatted = formatValue(response.value);
		parts.push(formatted);
	}

	if (parts.length === 0) {
		return textResult("(no output)");
	}

	return textResult(parts.join("\n"));
}

function formatValue(value: unknown): string {
	if (value === undefined || value === null) {
		return "undefined";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number") {
		return String(value);
	}
	if (typeof value === "boolean") {
		return String(value);
	}
	if (typeof value === "object") {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
	return String(value);
}
