// ── Cross-platform default-browser opener ───────────────────────────
//
// Best-effort: spawns the OS-specific opener and detaches. Failures
// are swallowed — the user can copy the URL from stdout.

import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
	const platform = process.platform;
	let cmd: string;
	let args: string[];

	if (platform === "darwin") {
		cmd = "open";
		args = [url];
	} else if (platform === "win32") {
		cmd = "cmd.exe";
		args = ["/c", "start", "", url];
	} else {
		cmd = "xdg-open";
		args = [url];
	}

	try {
		const child = spawn(cmd, args, {
			detached: true,
			stdio: "ignore",
		});
		child.on("error", () => undefined);
		child.unref();
	} catch {
		// silent — user already has the URL on stdout
	}
}
