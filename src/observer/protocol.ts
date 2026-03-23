import type { CommandResult } from "../engine/result.js";

export const OBSERVER_ROUTE = "/observer/events";

export interface ObserverEventBase {
	id: string;
	type: "command.start" | "command.progress" | "command.end";
	source: "llm";
	timestamp: number;
}

export type ObserverEvent =
	| (ObserverEventBase & { type: "command.start"; command: string; mode: string })
	| (ObserverEventBase & {
		type: "command.progress";
		phase?: string;
		percent?: number;
		message?: string;
	})
	| (ObserverEventBase & { type: "command.end"; ok: boolean; result: CommandResult });
