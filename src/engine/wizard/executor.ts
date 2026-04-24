// ── Wizard executor — shared one-shot execution for TUI and CLI ─────
//
// Dispatches tasks by type: "http" → HISE REST API, "internal" → registered TS handler.
// Also handles pre-form initialization via the same type pattern.

import type { HiseConnection } from "../hise.js";
import { isEnvelopeResponse, isErrorResponse } from "../hise.js";
import type { WizardHandlerRegistry } from "./handler-registry.js";
import type {
	WizardDefinition,
	WizardTask,
	WizardAnswers,
	WizardProgress,
	WizardExecResult,
} from "./types.js";
import { validateAnswers } from "./validator.js";

// ── Abort signal for init handlers ──────────────────────────────────

/** Thrown from an init handler to halt the wizard before the form opens.
 *  Callers catch this and show `message` to the user instead of rendering
 *  the form — e.g. when prerequisites aren't met and the wizard cannot
 *  usefully proceed. */
export class WizardInitAbortError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WizardInitAbortError";
	}
}

// ── Type guards for response dispatch ────────────────────────────────

interface AsyncJobResult {
	readonly jobId: string;
	readonly async: true;
}

function isAsyncJobResult(r: unknown): r is AsyncJobResult {
	return (
		typeof r === "object" &&
		r !== null &&
		"async" in r &&
		(r as Record<string, unknown>).async === true &&
		typeof (r as Record<string, unknown>).jobId === "string"
	);
}

function isPrepareResult(r: unknown): r is Record<string, unknown> {
	return typeof r === "object" && r !== null && !Array.isArray(r);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Dependencies injected into the executor. */
export interface WizardExecutorDeps {
	readonly connection: HiseConnection | null;
	readonly handlerRegistry: WizardHandlerRegistry | null;
}

/** Per-run options for {@link WizardExecutor.execute}. */
export interface WizardExecuteOptions {
	readonly signal?: AbortSignal;
	/** Skip tasks with index < startIndex. Used by `/resume` to restart
	 *  from the task that previously failed. Defaults to 0. */
	readonly startIndex?: number;
}

/** Extra fields returned when execution halts mid-sequence. */
export interface WizardExecFailure extends WizardExecResult {
	/** Index of the task that failed — pass as `startIndex` to resume. */
	readonly nextTaskIndex?: number;
}

export class WizardExecutor {
	constructor(private readonly deps: WizardExecutorDeps) {}

	/**
	 * Run the wizard's init function (if any) to fetch default values.
	 * Returns a Record to merge into globalDefaults before form display.
	 *
	 * Init handlers can throw {@link WizardInitAbortError} to halt the wizard
	 * before the form renders — callers should catch this and surface the
	 * message to the user instead of opening the form. Any other error from
	 * the handler is swallowed (treated as "no defaults").
	 */
	async initialize(def: WizardDefinition): Promise<Record<string, string>> {
		if (!def.init) return {};

		if (def.init.type === "http") {
			if (!this.deps.connection) return {};
			try {
				const response = await this.deps.connection.get(
					`/api/wizard/initialise?id=${encodeURIComponent(def.id)}`,
				);
				if (isEnvelopeResponse(response) && response.success && response.result) {
					return typeof response.result === "object"
						? (response.result as Record<string, string>)
						: {};
				}
			} catch {
				// Init failure is non-fatal — return empty defaults
			}
			return {};
		}

		// type === "internal"
		const handler = this.deps.handlerRegistry?.getInit(def.init.function);
		if (!handler) return {};
		try {
			return await handler(def.id);
		} catch (err) {
			// Abort is a signal, not a silent failure — propagate so the TUI
			// can close the wizard and show the user the reason.
			if (err instanceof WizardInitAbortError) throw err;
			return {};
		}
	}

	/**
	 * Execute wizard tasks sequentially after validation. A failing task
	 * halts the sequence and returns `nextTaskIndex` so `/resume` can
	 * restart at the same task after the user fixes the underlying issue.
	 *
	 * @param options.startIndex - skip tasks with index < startIndex (resume)
	 * @param options.signal - abort signal for cancellation
	 */
	async execute(
		def: WizardDefinition,
		answers: WizardAnswers,
		onProgress?: (p: WizardProgress) => void,
		options?: WizardExecuteOptions,
	): Promise<WizardExecFailure> {
		const signal = options?.signal;
		const startIndex = Math.max(0, options?.startIndex ?? 0);

		const validation = validateAnswers(def, answers);
		if (!validation.valid) {
			const messages = validation.errors.map((e) => e.message).join("; ");
			return { success: false, message: `Validation failed: ${messages}` };
		}

		if (def.tasks.length === 0) {
			return { success: true, message: `${def.header} completed.` };
		}

		const resuming = startIndex > 0 && startIndex < def.tasks.length;
		onProgress?.({
			phase: "Starting",
			percent: 0,
			message: resuming
				? `Resuming ${def.header} at task ${startIndex + 1}/${def.tasks.length}...`
				: `Executing ${def.header}...`,
		});
		const allLogs: string[] = [];
		let taskData: Record<string, string> = {};

		for (let i = startIndex; i < def.tasks.length; i++) {
			if (signal?.aborted) {
				return {
					success: false,
					message: "Cancelled.",
					logs: allLogs.length > 0 ? allLogs : undefined,
					nextTaskIndex: i,
				};
			}

			const task = def.tasks[i]!;
			const basePercent = Math.round((i / def.tasks.length) * 100);
			const taskRange = 100 / def.tasks.length;

			// Emit phase-start with task label as heading
			onProgress?.({
				phase: task.id,
				percent: basePercent,
				message: task.label ? `__heading__${task.label}` : undefined,
			});

			const taskProgress = (p: WizardProgress): void => {
				const scaledPercent =
					p.percent !== undefined ? Math.round(basePercent + (p.percent / 100) * taskRange) : undefined;
				onProgress?.({ ...p, percent: scaledPercent });
			};

			const result =
				task.type === "http"
					? await this.executeHttpTask(def, task, answers, taskProgress, signal)
					: await this.executeInternalTask(task, answers, taskProgress, signal, taskData);

			if (result.logs) allLogs.push(...result.logs);
			if (result.data) taskData = { ...taskData, ...result.data };
			if (!result.success) {
				return {
					...result,
					logs: allLogs.length > 0 ? allLogs : undefined,
					nextTaskIndex: i,
				};
			}
		}

		onProgress?.({ phase: "Complete", percent: 100 });
		return {
			success: true,
			message: `✓ ${def.header} completed successfully.`,
			postActions: def.postActions.length > 0 ? def.postActions : undefined,
			logs: allLogs.length > 0 ? allLogs : undefined,
		};
	}

	private async executeHttpTask(
		def: WizardDefinition,
		task: WizardTask,
		answers: WizardAnswers,
		onProgress: (p: WizardProgress) => void,
		signal?: AbortSignal,
	): Promise<WizardExecResult> {
		if (!this.deps.connection) {
			return { success: false, message: `No HISE connection for http task "${task.id}".` };
		}

		onProgress({ phase: task.id, message: `Executing ${task.id}...` });

		try {
			const response = await this.deps.connection.post("/api/wizard/execute", {
				wizardId: def.id,
				answers,
				tasks: [task.function],
			});

			if (isErrorResponse(response)) {
				return { success: false, message: response.message };
			}

			if (isEnvelopeResponse(response) && response.success) {
				// Async job id — top-level in new API (string or number), or legacy inside result
				const rawJobId = response.jobId !== undefined ? response.jobId
					: isAsyncJobResult(response.result) ? response.result.jobId
					: null;
				const jobId = rawJobId !== null && rawJobId !== undefined ? String(rawJobId) : null;

				// Poll while server reports the job is still running. If the
				// job already finished synchronously the initial response
				// carries the final result + logs — fall through.
				if (jobId !== null && response.finished !== true) {
					return this.pollJobStatus(jobId, task, onProgress, signal);
				}

				// Prepare-only — forward result fields as inter-task data
				if (isPrepareResult(response.result)) {
					const data: Record<string, string> = {};
					for (const [k, v] of Object.entries(response.result)) {
						if (typeof v === "string") data[k] = v;
					}
					return {
						success: true,
						message: `${task.id} completed.`,
						logs: response.logs.length > 0 ? response.logs : undefined,
						data,
					};
				}

				return {
					success: true,
					message: response.result ? String(response.result) : `${task.id} completed.`,
					logs: response.logs.length > 0 ? response.logs : undefined,
				};
			}

			if (isEnvelopeResponse(response)) {
				const errorMsg =
					response.errors.length > 0
						? response.errors.map((e: { errorMessage: string }) => e.errorMessage).join("\n")
						: "Unknown error";
				return {
					success: false,
					message: errorMsg,
					logs: response.logs.length > 0 ? response.logs : undefined,
				};
			}

			return { success: false, message: "Unexpected response format" };
		} catch (err) {
			return {
				success: false,
				message: `Task "${task.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	private async pollJobStatus(
		jobId: string,
		task: WizardTask,
		onProgress: (p: WizardProgress) => void,
		signal?: AbortSignal,
	): Promise<WizardExecResult> {
		if (!this.deps.connection) {
			return { success: false, message: "No HISE connection for job polling." };
		}

		const endpoint = `/api/wizard/status?jobId=${encodeURIComponent(jobId)}`;
		let seenLogs = 0;

		for (;;) {
			await delay(500);

			if (signal?.aborted) {
				return { success: false, message: "Cancelled." };
			}

			try {
				const response = await this.deps.connection.get(endpoint);

				if (isErrorResponse(response)) {
					return { success: false, message: response.message };
				}

				if (!isEnvelopeResponse(response)) {
					return { success: false, message: "Unexpected status response format" };
				}

				// New API: finished/progress are top-level fields
				const finished = response.finished as boolean | undefined;
				const progress = response.progress as number | undefined;
				const message = response.message as string | undefined
					// Legacy: fields inside result
					?? (response.result as Record<string, unknown> | null)?.message as string | undefined;

				// Stream newly-appended log lines so the TUI can render them
				// one-by-one in its dim output channel.
				const logs = Array.isArray(response.logs) ? response.logs : [];
				if (logs.length > seenLogs) {
					for (let i = seenLogs; i < logs.length; i++) {
						onProgress({ phase: task.id, message: logs[i] });
					}
					seenLogs = logs.length;
				}

				if (progress !== undefined || message) {
					onProgress({
						phase: task.id,
						percent: progress !== undefined ? Math.round(progress * 100) : undefined,
						message,
					});
				}

				if (finished ?? (response.result as Record<string, unknown> | null)?.finished) {
					const data: Record<string, string> = {};
					if (isPrepareResult(response.result)) {
						for (const [k, v] of Object.entries(response.result)) {
							if (typeof v === "string") data[k] = v;
						}
					}
					if (response.success) {
						return {
							success: true,
							message: message ?? `${task.id} completed.`,
							logs: logs.length > 0 ? logs : undefined,
							data: Object.keys(data).length > 0 ? data : undefined,
						};
					}
					const errorMsg =
						response.errors.length > 0
							? response.errors.map((e) => e.errorMessage).join("\n")
							: message ?? "Job failed";
					return {
						success: false,
						message: errorMsg,
						logs: logs.length > 0 ? logs : undefined,
					};
				}
			} catch (err) {
				return {
					success: false,
					message: `Polling "${task.id}" failed: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}
	}

	private async executeInternalTask(
		task: WizardTask,
		answers: WizardAnswers,
		onProgress: (p: WizardProgress) => void,
		signal?: AbortSignal,
		context?: Record<string, string>,
	): Promise<WizardExecResult> {
		const handler = this.deps.handlerRegistry?.getTask(task.function);
		if (!handler) {
			return { success: false, message: `No handler registered for internal task "${task.function}".` };
		}

		try {
			return await handler(answers, onProgress, signal, context);
		} catch (err) {
			return {
				success: false,
				message: `Task "${task.function}" failed: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}
}
