// Pure logic for the uninstall flow. All I/O happens in the runtime layer.
//
// classifyFileForUninstall: decides whether a file step's target should be
// deleted or skipped (modified-by-user) per spec §9 and §4.1 (legacy compat).
//
// reverseSteps: returns the steps in reverse order (the runtime walks them
// this way to undo).

import type { FileStep, InstallStep } from "../../mock/contracts/assets/installLog.js";
import { isTextExtension } from "./textExtensions.js";

export type FileUninstallAction = "delete" | "skip";

export function classifyFileForUninstall(
	step: FileStep,
	currentDiskHash: bigint | null,
): FileUninstallAction {
	// Spec §9 + §4.1.
	// File is text-classified TODAY iff its extension is in the current whitelist.
	const isTextNow = isTextExtension(step.target);

	// Legacy compat: if the file has no recorded Hash but its extension is
	// now in the wider text-classified set, treat it as binary semantics.
	if (!step.hasHashField || !isTextNow) return "delete";

	// Currently text and a hash was recorded -> compare.
	if (step.hash === null) {
		// hasHashField true but null hash should not happen for valid post-fix
		// logs; treat as binary fallthrough (delete) rather than throwing.
		return "delete";
	}
	if (currentDiskHash === null) {
		// File missing from disk (already deleted by user). Treat as deleted.
		return "delete";
	}
	return currentDiskHash === step.hash ? "delete" : "skip";
}

export function reverseSteps(steps: InstallStep[]): InstallStep[] {
	return [...steps].reverse();
}
