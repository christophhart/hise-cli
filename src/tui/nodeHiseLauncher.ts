// ── Node.js HiseLauncher — detached process spawning ────────────────

import { spawn } from "node:child_process";
import type { HiseLauncher } from "../engine/modes/hise.js";

export function createNodeHiseLauncher(): HiseLauncher {
	return {
		spawnDetached(command: string, args: string[]): Promise<void> {
			return new Promise((resolve, reject) => {
				try {
					// On Windows with shell: true, quote the command if it contains spaces
					const isWin = process.platform === "win32";
					const cmd = isWin && command.includes(" ") ? `"${command}"` : command;
					const proc = spawn(cmd, args, {
						detached: true,
						stdio: "ignore",
						shell: isWin,
					});
					proc.unref();

					let settled = false;
					proc.on("error", (err) => {
						if (!settled) {
							settled = true;
							reject(err);
						}
					});
					// If no error within 200ms, the process started successfully
					setTimeout(() => {
						if (!settled) {
							settled = true;
							resolve();
						}
					}, 200);
				} catch (err) {
					reject(err);
				}
			});
		},
	};
}
