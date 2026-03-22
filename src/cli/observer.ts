import type { CommandResult } from "../engine/result.js";

const DEFAULT_URL = "http://127.0.0.1:1902/observer/events";

export interface ObserverEventBase {
	id: string;
	type: "command.start" | "command.progress" | "command.end";
	source: "llm";
	timestamp: number;
}

export type ObserverEvent =
	| (ObserverEventBase & { type: "command.start"; command: string; mode: string })
	| (ObserverEventBase & { type: "command.progress"; phase?: string; percent?: number; message?: string })
	| (ObserverEventBase & { type: "command.end"; ok: boolean; result: CommandResult });

export class ObserverClient {
	private readonly url: string;

	constructor(url = process.env.HISE_TUI_OBSERVER_URL || DEFAULT_URL) {
		this.url = url;
	}

	async emit(event: ObserverEvent): Promise<void> {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 500);
		try {
			await fetch(this.url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(event),
				signal: controller.signal,
			});
		} catch {
			// Observer is strictly best-effort.
		} finally {
			clearTimeout(timeout);
		}
	}
}
