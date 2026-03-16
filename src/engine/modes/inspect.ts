// ── Inspect mode — runtime monitoring via GET /api/status ───────────

// Phase 1 stub: basic commands (cpu, voices, modules, memory) using
// the existing GET /api/status endpoint. Phase 7 will add live
// monitoring via polling or SSE when new endpoints are available.

import { isErrorResponse, isSuccessResponse } from "../hise.js";
import type { CommandResult, TreeNode } from "../result.js";
import {
	errorResult,
	tableResult,
	textResult,
	treeResult,
} from "../result.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";

const INSPECT_COMMANDS = new Map<string, string>([
	["cpu", "Show CPU usage and buffer info"],
	["voices", "Show active voice count"],
	["modules", "Show module tree"],
	["memory", "Show memory usage"],
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

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) {
			return { items: [], from: 0, to: input.length };
		}

		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const items = this.completionEngine.completeInspect(trimmed);
		return { items, from: leadingSpaces, to: input.length, label: "Inspect commands" };
	}

	async parse(
		input: string,
		session: SessionContext,
	): Promise<CommandResult> {
		const trimmed = input.trim().toLowerCase();
		const parts = trimmed.split(/\s+/);
		const command = parts[0];

		if (!command || command === "help") {
			return tableResult(
				["Command", "Description"],
				[...INSPECT_COMMANDS.entries()].map(([cmd, desc]) => [
					cmd,
					desc,
				]),
			);
		}

		if (!INSPECT_COMMANDS.has(command)) {
			return errorResult(
				`Unknown inspect command: "${command}". Type "help" for available commands.`,
			);
		}

		if (!session.connection) {
			return errorResult(
				"No HISE connection. Connect to HISE before using inspect mode.",
			);
		}

		const response = await session.connection.get("/api/status");

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}

		if (!isSuccessResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}

		// The status data may be in response.value (object) or response.result
		// (string that could be JSON). Prefer value if present.
		let data: Record<string, unknown> = {};
		if (response.value && typeof response.value === "object") {
			data = response.value as Record<string, unknown>;
		} else if (typeof response.result === "string" && response.result !== "") {
			try {
				const parsed = JSON.parse(response.result);
				if (typeof parsed === "object" && parsed !== null) {
					data = parsed as Record<string, unknown>;
				}
			} catch {
				// result is not JSON — use empty data
			}
		}

		switch (command) {
			case "cpu":
				return formatCpu(data);
			case "voices":
				return formatVoices(data);
			case "modules":
				return formatModules(data);
			case "memory":
				return formatMemory(data);
			default:
				return errorResult(`Unhandled command: ${command}`);
		}
	}
}

// ── Response formatters (pure functions) ─────────────────────────────

export function formatCpu(data: Record<string, unknown>): CommandResult {
	const cpu = typeof data.cpuUsage === "number" ? data.cpuUsage : 0;
	const sampleRate =
		typeof data.sampleRate === "number" ? data.sampleRate : 0;
	const bufferSize =
		typeof data.bufferSize === "number" ? data.bufferSize : 0;

	return tableResult(
		["Metric", "Value"],
		[
			["CPU Usage", `${cpu.toFixed(1)}%`],
			["Sample Rate", `${sampleRate} Hz`],
			["Buffer Size", `${bufferSize} samples`],
		],
	);
}

export function formatVoices(
	data: Record<string, unknown>,
): CommandResult {
	const active =
		typeof data.activeVoices === "number" ? data.activeVoices : 0;
	const max = typeof data.maxVoices === "number" ? data.maxVoices : 256;

	return tableResult(
		["Metric", "Value"],
		[
			["Active Voices", `${active}`],
			["Max Voices", `${max}`],
			["Usage", `${((active / max) * 100).toFixed(1)}%`],
		],
	);
}

export function formatModules(
	data: Record<string, unknown>,
): CommandResult {
	// If there's a module tree in the response, render it
	const modules = data.modules as
		| Array<{ name: string; type: string; children?: unknown[] }>
		| undefined;

	if (!modules || !Array.isArray(modules)) {
		return textResult("Module tree not available in current status response.");
	}

	function buildTree(
		items: Array<{ name: string; type: string; children?: unknown[] }>,
	): TreeNode[] {
		return items.map((item) => ({
			label: item.name,
			type: item.type,
			children: item.children
				? buildTree(
						item.children as Array<{
							name: string;
							type: string;
							children?: unknown[];
						}>,
					)
				: undefined,
		}));
	}

	const root: TreeNode = {
		label: "Root",
		type: "Container",
		children: buildTree(modules),
	};

	return treeResult(root);
}

export function formatMemory(
	data: Record<string, unknown>,
): CommandResult {
	const heap =
		typeof data.heapSize === "number"
			? `${(data.heapSize / (1024 * 1024)).toFixed(1)} MB`
			: "N/A";
	const preload =
		typeof data.preloadSize === "number"
			? `${(data.preloadSize / (1024 * 1024)).toFixed(1)} MB`
			: "N/A";

	return tableResult(
		["Metric", "Value"],
		[
			["Heap Size", heap],
			["Preload Buffer", preload],
		],
	);
}
