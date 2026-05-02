// ── Internal wizard handler registry ─────────────────────────────────
//
// Engine-layer registry for TypeScript handler functions invoked by
// wizards with type: "internal". Implementations registered from tui/ or cli/.

import type { WizardAnswers, WizardProgress, WizardExecResult } from "./types.js";

/** Signature for internal task handler functions. */
export type InternalTaskHandler = (
	answers: WizardAnswers,
	onProgress: (p: WizardProgress) => void,
	signal?: AbortSignal,
	context?: Record<string, string>,
) => Promise<WizardExecResult>;

/** Result returned by an init handler.
 *
 *  - The simple form is a flat map of field-id → default value.
 *  - The structured form additionally lets the handler inject dynamic
 *    `items` / `itemDescriptions` for multiselect or choice fields whose
 *    options can only be known at runtime (e.g. preprocessor macros pulled
 *    from a live HISE project). */
export type InitHandlerResult =
	| Record<string, string>
	| {
		defaults: Record<string, string>;
		items?: Record<string, string[]>;
		itemDescriptions?: Record<string, string[]>;
	};

/** Signature for internal init handler functions (pre-form default fetching). */
export type InternalInitHandler = (
	wizardId: string,
) => Promise<InitHandlerResult>;

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
