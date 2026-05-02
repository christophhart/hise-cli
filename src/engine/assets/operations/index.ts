// Public surface for asset manager operations.
// Engine consumers (mode, CLI) import from here; tests import directly.

export { login, logout, readStoredToken, tokenFilePath } from "./auth.js";
export type { AuthLoginResult } from "./auth.js";

export {
	addLocalFolder,
	describeLocalFolder,
	localFoldersPath,
	readLocalFolders,
	removeLocalFolder,
	writeLocalFolders,
} from "./local.js";
export type { AddLocalResult, LocalFolderInfo, RemoveLocalResult } from "./local.js";

export { cleanup } from "./cleanup.js";
export type { CleanupResult } from "./cleanup.js";

export { uninstall } from "./uninstall.js";
export type { UninstallResult } from "./uninstall.js";

export { install } from "./install.js";
export type { InstallOptions, InstallPreview, InstallResult, InstallSource } from "./install.js";

export { listInstalled, listLocal, listStore } from "./list.js";
export type { InstalledEntrySummary, StoreEntry } from "./list.js";

export { info } from "./info.js";
export type { InstalledSummary, PackageInfo, PackageState } from "./info.js";

export {
	claimedPaths,
	installLogPath,
	readInstallLog,
	writeInstallLog,
	INSTALL_LOG_BASENAME,
} from "./log.js";

export { acquireLocal, acquireStore } from "./source.js";
export type { AcquiredSource } from "./source.js";
