// ── Wizard executor — shared one-shot execution for TUI and CLI ─────

import type { HiseConnection } from "../hise.js";
import { isEnvelopeResponse, isErrorResponse } from "../hise.js";
import type {
	WizardDefinition,
	WizardAnswers,
	WizardProgress,
	WizardExecResult,
} from "./types.js";
import { validateAnswers } from "./validator.js";

export class WizardExecutor {
	constructor(private readonly connection: HiseConnection) {}

	/**
	 * Execute a wizard with the given answers.
	 * Validates first, then POSTs to HISE for execution.
	 */
	async execute(
		def: WizardDefinition,
		answers: WizardAnswers,
		onProgress?: (p: WizardProgress) => void,
	): Promise<WizardExecResult> {
		// Validate answers
		const validation = validateAnswers(def, answers);
		if (!validation.valid) {
			const messages = validation.errors.map((e) => e.message).join("; ");
			return {
				success: false,
				message: `Validation failed: ${messages}`,
			};
		}

		onProgress?.({ phase: "Starting", percent: 0, message: `Executing ${def.header}...` });

		try {
			const response = await this.connection.post("/api/wizard/execute", {
				wizardId: def.id,
				answers,
				tasks: def.tasks.map((t) => t.function),
			});

			if (isErrorResponse(response)) {
				return {
					success: false,
					message: response.message,
				};
			}

			if (isEnvelopeResponse(response) && response.success) {
				return {
					success: true,
					message: response.result ? String(response.result) : `${def.header} completed successfully.`,
					postActions: def.postActions.length > 0 ? def.postActions : undefined,
					logs: response.logs.length > 0 ? response.logs : undefined,
				};
			}

			if (isEnvelopeResponse(response)) {
				const errorMsg = response.errors.length > 0
					? response.errors.map((e: { errorMessage: string }) => e.errorMessage).join("\n")
					: "Unknown error";
				return {
					success: false,
					message: errorMsg,
					logs: response.logs.length > 0 ? response.logs : undefined,
				};
			}

			return {
				success: false,
				message: "Unexpected response format",
			};
		} catch (err) {
			return {
				success: false,
				message: `Execution failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}
