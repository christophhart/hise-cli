// ── DSP local validation against scriptnodeList.json ─────────────────
//
// Cheap, client-side checks against the scriptnode metadata dataset
// before we bother HISE. Catches typos in factory paths and parameter
// names, and range violations for numeric values.

import { closest } from "fastest-levenshtein";
import type { ScriptnodeList, ScriptnodeDefinition } from "../data.js";
import type { RawDspNode } from "../../mock/contracts/dsp.js";
import type {
	AddCommand,
	SetCommand,
	CreateParameterCommand,
} from "./dsp-parser.js";
import {
	nodePropertyNames,
	ROOT_NETWORK_PROPERTIES,
	ROOT_NETWORK_PROPERTY_NAMES,
} from "./dsp-properties.js";

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	suggestions?: string[];
}

/** Look up a scriptnode definition by its full "factory.nodeId" key. */
export function findScriptnode(
	factoryPath: string,
	list: ScriptnodeList,
): ScriptnodeDefinition | undefined {
	return list[factoryPath];
}

/**
 * Validate `add <factory.node>` — factory path must exist in the dataset.
 * Offers a Levenshtein suggestion for typos.
 */
export function validateAddCommand(
	cmd: AddCommand,
	list: ScriptnodeList,
): ValidationResult {
	const errors: string[] = [];
	const suggestions: string[] = [];

	if (findScriptnode(cmd.factoryPath, list)) {
		return { valid: true, errors: [] };
	}

	const allPaths = Object.keys(list);
	const suggestion = allPaths.length > 0 ? closest(cmd.factoryPath, allPaths) : undefined;
	errors.push(`Unknown factory path "${cmd.factoryPath}".`);
	if (suggestion && suggestion !== cmd.factoryPath) {
		suggestions.push(suggestion);
		errors[0] += ` Did you mean "${suggestion}"?`;
	}
	return { valid: false, errors, suggestions };
}

/**
 * Validate `set <nodeId>.<parameterId> ...` for all three variants:
 * value-write, full range-write, and single-field range-write. Network-level
 * root properties are recognized when `cmd.nodeId === rootNodeId`.
 *
 * `factoryPath` is the resolved factory for the target node (caller looks up
 * via the raw tree). `rawTree` is the cached tree root — needed for
 * single-field range-write merges. `rootNodeId` is the network's root node id.
 */
export function validateSetCommand(
	cmd: SetCommand,
	factoryPath: string | null,
	list: ScriptnodeList,
	rawTree: RawDspNode | null = null,
	rootNodeId: string | null = null,
): ValidationResult {
	// Network-level root property write
	if (rootNodeId && cmd.nodeId === rootNodeId) {
		const propDef = ROOT_NETWORK_PROPERTIES[cmd.parameterId];
		if (propDef) {
			return validateRootProperty(cmd, propDef);
		}
		// Fall through if it's also a real parameter on the root node — in
		// practice the root is a chain container, so fallthrough is fine.
	}

	if (!factoryPath) {
		return { valid: true, errors: [] };
	}
	const def = findScriptnode(factoryPath, list);
	if (!def) return { valid: true, errors: [] };

	const param = def.parameters.find((p) => p.id === cmd.parameterId);
	if (!param) {
		const propertyNames = nodePropertyNames(def);
		if (propertyNames.includes(cmd.parameterId)) {
			return { valid: true, errors: [] };
		}
		// Surface root-level network props in the suggestion pool when
		// applicable so typos like `set root.AllowPolyphnic` get hinted.
		const isRoot = rootNodeId && cmd.nodeId === rootNodeId;
		const allNames = [
			...def.parameters.map((p) => p.id),
			...propertyNames,
			...(isRoot ? ROOT_NETWORK_PROPERTY_NAMES : []),
		];
		const suggestion = allNames.length > 0 ? closest(cmd.parameterId, allNames) : undefined;
		let msg = `Unknown parameter "${cmd.parameterId}" on ${factoryPath}.`;
		if (suggestion) msg += ` Did you mean "${suggestion}"?`;
		return { valid: false, errors: [msg] };
	}

	// Single-field range-write — backend merges server-side. Validate only
	// the named field's local constraint; cross-field rules (min<max,
	// mid-in-range) are deferred to backend since we don't know the other
	// field's value at command time.
	if (cmd.rangeField) {
		const v = cmd.value as number;
		if (cmd.rangeField === "stepSize" && v < 0) {
			return { valid: false, errors: [`range: stepSize must be >= 0 (got ${v}).`] };
		}
		if (cmd.rangeField === "skewFactor" && v <= 0) {
			return { valid: false, errors: [`range: skewFactor must be > 0 (got ${v}).`] };
		}
		return { valid: true, errors: [] };
	}

	// Full range-write
	const isRangeWrite = cmd.min !== undefined
		|| cmd.max !== undefined
		|| cmd.stepSize !== undefined
		|| cmd.middlePosition !== undefined
		|| cmd.skewFactor !== undefined;
	if (isRangeWrite) {
		return validateRange(cmd.min, cmd.max, cmd.stepSize, cmd.middlePosition, cmd.skewFactor);
	}

	// Value-write — bounds-check numeric values against the parameter's
	// declared range.
	if (typeof cmd.value === "number") {
		if (cmd.value < param.range.min || cmd.value > param.range.max) {
			return {
				valid: false,
				errors: [
					`Value ${cmd.value} out of range for ${cmd.nodeId}.${cmd.parameterId} (${param.range.min}-${param.range.max}).`,
				],
			};
		}
	}
	return { valid: true, errors: [] };
}

function validateRange(
	min: number | undefined,
	max: number | undefined,
	stepSize: number | undefined,
	middlePosition: number | undefined,
	skewFactor: number | undefined,
): ValidationResult {
	const errors: string[] = [];
	if (min !== undefined && max !== undefined && min >= max) {
		errors.push(`range: min (${min}) must be less than max (${max}).`);
	}
	if (stepSize !== undefined && stepSize < 0) {
		errors.push(`range: stepSize must be >= 0 (got ${stepSize}).`);
	}
	if (middlePosition !== undefined && skewFactor !== undefined) {
		errors.push("range: middlePosition (mid) and skewFactor (skew) are mutually exclusive.");
	}
	if (skewFactor !== undefined && skewFactor <= 0) {
		errors.push(`range: skewFactor must be > 0 (got ${skewFactor}).`);
	}
	if (middlePosition !== undefined && min !== undefined && max !== undefined) {
		if (middlePosition <= min || middlePosition >= max) {
			errors.push(`range: middlePosition (${middlePosition}) must lie strictly between min (${min}) and max (${max}).`);
		}
	}
	return errors.length === 0 ? { valid: true, errors: [] } : { valid: false, errors };
}

function validateRootProperty(
	cmd: SetCommand,
	def: import("./dsp-properties.js").RootNetworkPropertyDef,
): ValidationResult {
	if (cmd.rangeField || cmd.min !== undefined) {
		return {
			valid: false,
			errors: [`Network property "${cmd.parameterId}" does not support range-write.`],
		};
	}
	const v = cmd.value;
	if (def.kind === "bool") {
		if (typeof v === "boolean") return { valid: true, errors: [] };
		if (typeof v === "string") {
			const lower = v.toLowerCase();
			if (lower === "true" || lower === "false") return { valid: true, errors: [] };
		}
		if (typeof v === "number" && (v === 0 || v === 1)) return { valid: true, errors: [] };
		return {
			valid: false,
			errors: [`Network property "${cmd.parameterId}" expects a boolean (true/false), got ${JSON.stringify(v)}.`],
		};
	}
	// int
	let n: number | null = null;
	if (typeof v === "number") n = v;
	else if (typeof v === "string" && /^-?\d+$/.test(v)) n = parseInt(v, 10);
	if (n === null || !Number.isInteger(n)) {
		return {
			valid: false,
			errors: [`Network property "${cmd.parameterId}" expects an integer, got ${JSON.stringify(v)}.`],
		};
	}
	if (def.powerOfTwo) {
		const ok = (def.allowZero && n === 0) || (n > 0 && (n & (n - 1)) === 0);
		if (!ok) {
			return {
				valid: false,
				errors: [`Network property "${cmd.parameterId}" expects a power-of-two${def.allowZero ? " (or 0)" : ""}, got ${n}.`],
			};
		}
	}
	return { valid: true, errors: [] };
}

/**
 * Validate `create_parameter <container>.<name>` — target must be a
 * container node (hasChildren:true in the dataset).
 */
export function validateCreateParameterCommand(
	cmd: CreateParameterCommand,
	factoryPath: string | null,
	list: ScriptnodeList,
): ValidationResult {
	if (!factoryPath) return { valid: true, errors: [] };
	const def = findScriptnode(factoryPath, list);
	if (!def) return { valid: true, errors: [] };
	if (!def.hasChildren) {
		return {
			valid: false,
			errors: [
				`Cannot create parameter on ${cmd.nodeId}: ${factoryPath} is not a container node.`,
			],
		};
	}
	if (cmd.min !== undefined && cmd.max !== undefined && cmd.min >= cmd.max) {
		return {
			valid: false,
			errors: [`create_parameter: min (${cmd.min}) must be less than max (${cmd.max}).`],
		};
	}
	if (cmd.middlePosition !== undefined && cmd.skewFactor !== undefined) {
		return {
			valid: false,
			errors: ["create_parameter: middlePosition (mid) and skewFactor (skew) are mutually exclusive."],
		};
	}
	if (cmd.skewFactor !== undefined && cmd.skewFactor <= 0) {
		return {
			valid: false,
			errors: [`create_parameter: skewFactor must be > 0 (got ${cmd.skewFactor}).`],
		};
	}
	if (
		cmd.middlePosition !== undefined
		&& cmd.min !== undefined
		&& cmd.max !== undefined
		&& (cmd.middlePosition <= cmd.min || cmd.middlePosition >= cmd.max)
	) {
		return {
			valid: false,
			errors: [`create_parameter: middlePosition (${cmd.middlePosition}) must lie strictly between min (${cmd.min}) and max (${cmd.max}).`],
		};
	}
	return { valid: true, errors: [] };
}
