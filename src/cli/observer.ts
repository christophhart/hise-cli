import { OBSERVER_ROUTE, type ObserverEvent } from "../observer/protocol.js";
import { DEFAULT_OBSERVER_PORT } from "../engine/constants.js";

const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_OBSERVER_PORT}${OBSERVER_ROUTE}`;

export type { ObserverEvent };

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
