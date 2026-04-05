// ── Internal wizard handler registry ─────────────────────────────────
//
// Engine-layer registry for TypeScript handler functions invoked by
// wizards with type: "internal". Implementations registered from tui/ or cli/.

import type { WizardAnswers, WizardProgress, WizardExecResult } from "./types.js";

/** Signature for internal task handler functions. */
export type InternalTaskHandler = (
	answers: WizardAnswers,
	onProgress: (p: WizardProgress) => void,
) => Promise<WizardExecResult>;

/** Signature for internal init handler functions (pre-form default fetching). */
export type InternalInitHandler = (
	wizardId: string,
) => Promise<Record<string, string>>;

/**
 * Registry for internal wizard handler functions.
 * The engine defines the interface; implementations are registered from
 * the tui/ or cli/ layer at startup.
 */
export class WizardHandlerRegistry {
	private readonly taskHandlers = new Map<string, InternalTaskHandler>();
	private readonly initHandlers = new Map<string, InternalInitHandler>();

	registerTask(name: string, handler: InternalTaskHandler): void {
		this.taskHandlers.set(name, handler);
	}

	registerInit(name: string, handler: InternalInitHandler): void {
		this.initHandlers.set(name, handler);
	}

	getTask(name: string): InternalTaskHandler | undefined {
		return this.taskHandlers.get(name);
	}

	getInit(name: string): InternalInitHandler | undefined {
		return this.initHandlers.get(name);
	}
}
