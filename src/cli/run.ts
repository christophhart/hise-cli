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

export async function executeCliCommand(
	argv: string[],
	commands: CommandEntry[],
	dataLoader: DataLoader,
	connectionOverride?: HiseConnection,
): Promise<{ kind: "tui"; args: string[] } | { kind: "help" } | { kind: "error"; message: string } | { kind: "json"; payload: CliOutputPayload }> {
	const parsed = parseCliArgs(argv, commands);
	if (parsed.kind !== "execute") return parsed;

	const mockRuntime = !connectionOverride && parsed.useMock ? createDefaultMockRuntime() : null;
	const connection = new CapturingHiseConnection(
		connectionOverride ?? mockRuntime?.connection ?? new HttpHiseConnection(),
	);
	const { session, completionEngine } = createSession({
		connection,
		getModuleList: () => moduleList,
	});
	const moduleList = await loadSessionDatasets(dataLoader, completionEngine);
	for (const mode of session.modeStack) {
		if (moduleList && "setModuleList" in mode && typeof mode.setModuleList === "function") {
			mode.setModuleList(moduleList);
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
