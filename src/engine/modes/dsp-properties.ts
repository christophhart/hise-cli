// ── Scriptnode property catalog ──────────────────────────────────────
//
// Names of NodeBase-level properties that live outside the per-factory
// `parameters` array. Universal ones apply to every scriptnode; container
// ones are additionally valid when `hasChildren:true`. Factory-specific
// properties come from the definition's `properties` map in the dataset.

export const UNIVERSAL_NODE_PROPERTIES = [
	"Folded",
	"Comment",
	"NodeColour",
	"Name",
	"Bypassed",
] as const;

export const CONTAINER_NODE_PROPERTIES = [
	"ShowParameters",
	"IsVertical",
] as const;

/** All property names valid for a given scriptnode definition. */
export function nodePropertyNames(def: {
	hasChildren: boolean;
	properties: Record<string, unknown>;
}): string[] {
	const names: string[] = [
		...UNIVERSAL_NODE_PROPERTIES,
		...Object.keys(def.properties),
	];
	if (def.hasChildren) names.push(...CONTAINER_NODE_PROPERTIES);
	return names;
}
