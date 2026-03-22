import type { CommandEntry } from "../engine/commands/registry.js";
import { supportsSurface } from "../engine/commands/registry.js";
import { SUPPORTED_MODE_IDS } from "../session-bootstrap.js";

export function listCliCommands(commands: CommandEntry[]): CommandEntry[] {
	return commands
		.filter((entry) => supportsSurface(entry, "cli"))
		.filter((entry) => entry.kind !== "mode" || SUPPORTED_MODE_IDS.includes(entry.name as (typeof SUPPORTED_MODE_IDS)[number]));
}
