// ── Type coercion for HISE REST API values ──────────────────────────
//
// JUCE::var may serialize booleans as true/false, "true"/"false", or 0/1
// depending on the property type and how it was set. These helpers
// normalize to native JS types.

/** Coerce a value that may be boolean, string "true"/"false", or number 0/1 to boolean. */
export function toBool(value: unknown): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") return value.toLowerCase() !== "false" && value !== "0" && value !== "";
	return Boolean(value);
}
