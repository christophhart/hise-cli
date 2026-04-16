// ── DSP local validation against scriptnodeList.json ─────────────────
//
// Cheap, client-side checks against the scriptnode metadata dataset
// before we bother HISE. Catches typos in factory paths and parameter
// names, and range violations for numeric values.

import { closest } from "fastest-levenshtein";
import type { ScriptnodeList, ScriptnodeDefinition } from "../data.js";
import type {
	AddCommand,
	SetCommand,
	CreateParameterCommand,
} from "./dsp-parser.js";

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
 * Validate `set <nodeId>.<parameterId> <value>` using the factory
 * metadata for the node's type. The caller resolves nodeId → factoryPath
 * by looking up the raw tree and passes it in.
 */
export function validateSetCommand(
	cmd: SetCommand,
	factoryPath: string | null,
	list: ScriptnodeList,
): ValidationResult {
	if (!factoryPath) {
		// Tree not loaded or node not found — skip validation.
		return { valid: true, errors: [] };
	}
	const def = findScriptnode(factoryPath, list);
	if (!def) return { valid: true, errors: [] };

	const param = def.parameters.find((p) => p.id === cmd.parameterId);
	if (!param) {
		const paramNames = def.parameters.map((p) => p.id);
		const suggestion = paramNames.length > 0 ? closest(cmd.parameterId, paramNames) : undefined;
		let msg = `Unknown parameter "${cmd.parameterId}" on ${factoryPath}.`;
		if (suggestion) msg += ` Did you mean "${suggestion}"?`;
		return { valid: false, errors: [msg] };
	}

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
	return { valid: true, errors: [] };
}
