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

// ── Network root properties ──────────────────────────────────────────
//
// Settable on the root DspNetwork node only via `set <root>.<prop> <v>`
// (forwarded as a `set` op to /api/dsp/apply, which handles the
// network-level write when nodeId === root).

export interface RootNetworkPropertyDef {
	kind: "bool" | "int";
	powerOfTwo?: boolean;
	allowZero?: boolean;
}

export const ROOT_NETWORK_PROPERTIES: Record<string, RootNetworkPropertyDef> = {
	AllowCompilation:     { kind: "bool" },
	AllowPolyphonic:      { kind: "bool" },
	HasTail:              { kind: "bool" },
	SuspendOnSilence:     { kind: "bool" },
	CompileChannelAmount: { kind: "int" },
	ModulationBlockSize:  { kind: "int", powerOfTwo: true, allowZero: true },
};

export const ROOT_NETWORK_PROPERTY_NAMES = Object.keys(ROOT_NETWORK_PROPERTIES);

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
