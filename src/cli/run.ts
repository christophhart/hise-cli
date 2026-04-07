import { randomUUID } from "node:crypto";
import type { DataLoader } from "../engine/data.js";
import { HttpHiseConnection, type HiseConnection } from "../engine/hise.js";
import type { CommandEntry } from "../engine/commands/registry.js";
import { parseCliArgs } from "./args.js";
import { ObserverClient } from "./observer.js";
import { CapturingHiseConnection } from "./capture.js";
import { serializeCliOutput, type CliOutputPayload } from "./output.js";
import { createSession, loadSessionDatasets } from "../session-bootstrap.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import type { WizardHandlerRegistry } from "../engine/wizard/handler-registry.js";

export interface CliCommandOptions {
	connectionOverride?: HiseConnection;
	handlerRegistry?: WizardHandlerRegistry;
}

export async function executeCliCommand(
	argv: string[],
	commands: CommandEntry[],
	dataLoader: DataLoader,
	connectionOrOptions?: HiseConnection | CliCommandOptions,
): Promise<{ kind: "tui"; args: string[] } | { kind: "help"; scope?: string } | { kind: "error"; message: string } | { kind: "json"; payload: CliOutputPayload }> {
	// Backward compat: accept either a connection directly or an options object
	const opts: CliCommandOptions = connectionOrOptions && "probe" in connectionOrOptions
		? { connectionOverride: connectionOrOptions }
		: (connectionOrOptions as CliCommandOptions) ?? {};

	const parsed = parseCliArgs(argv, commands);
	if (parsed.kind !== "execute") return parsed;

	const mockRuntime = !opts.connectionOverride && parsed.useMock ? createDefaultMockRuntime() : null;
	const connection = new CapturingHiseConnection(
		opts.connectionOverride ?? mockRuntime?.connection ?? new HttpHiseConnection(),
	);
	let datasets: import("../session-bootstrap.js").SessionDatasets = {};
	const { session, completionEngine } = createSession({
		connection,
		getModuleList: () => datasets.moduleList,
		getComponentProperties: () => datasets.componentProperties,
		handlerRegistry: opts.handlerRegistry,
	});
	datasets = await loadSessionDatasets(dataLoader, completionEngine, session);
	for (const mode of session.modeStack) {
		if (datasets.moduleList && "setModuleList" in mode && typeof mode.setModuleList === "function") {
			mode.setModuleList(datasets.moduleList);
		}
	}

	const observer = new ObserverClient();
	const commandId = randomUUID();
	await observer.emit({
		id: commandId,
		type: "command.start",
		source: "llm",
		command: parsed.canonicalCommand,
		mode: parsed.mode,
		timestamp: Date.now(),
	});

	try {
		const result = await session.handleInput(parsed.canonicalCommand);
		const payload = serializeCliOutput(parsed.mode, result, connection.getLastReplResponse());

		await observer.emit({
			id: commandId,
			type: "command.end",
			source: "llm",
			ok: result.type !== "error",
			result,
			timestamp: Date.now(),
		});

		return { kind: "json", payload };
	} finally {
		connection.destroy();
	}
}
