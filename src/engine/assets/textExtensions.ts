// Text-classified file extensions per spec §4.1.
// Files with these extensions get their hash recorded for modification detection.
// Anything else is binary semantics (deleted unconditionally on uninstall).

export const TEXT_EXTENSIONS = new Set<string>([
	".h", ".cpp", ".dsp", ".js", ".xml",
	".css", ".glsl", ".md", ".json", ".txt",
	".hpp", ".c", ".hxx", ".cxx", ".inl",
]);

// Pre-fix HISE only hashed this narrower set. Used for legacy log compat:
// a file with NO Hash field whose extension is in TEXT_EXTENSIONS but NOT
// in this set was written by old HISE before extension list was widened.
// Such files are treated as binary semantics on uninstall.
export const LEGACY_TEXT_EXTENSIONS = new Set<string>([
	".h", ".cpp", ".dsp", ".js", ".xml",
]);

export const TEXT_FILE_SIZE_CAP = 500 * 1024; // 500 KiB

export function getExtension(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot < 0) return "";
	return filename.slice(dot).toLowerCase();
}

export function isTextExtension(filename: string): boolean {
	return TEXT_EXTENSIONS.has(getExtension(filename));
}
