// ── DSP command → HISE API operations mapping ────────────────────────
//
// Translates parsed DspCommand objects into the operation objects
// accepted by POST /api/dsp/apply. Field names mirror openapi.json
// exactly (factoryPath, nodeId, parameterId, source/target/parameter).

import type {
	DspCommand,
	AddCommand,
	RemoveCommand,
	MoveCommand,
	ConnectCommand,
	DisconnectCommand,
	SetCommand,
	BypassCommand,
	EnableCommand,
	CreateParameterCommand,
} from "./dsp-parser.js";
import type { RawDspNode } from "../../mock/contracts/dsp.js";
import { findDspNode } from "../../mock/contracts/dsp.js";
import type { ScriptnodeList } from "../data.js";
import { nodePropertyNames, ROOT_NETWORK_PROPERTY_NAMES } from "./dsp-properties.js";

export interface DspOp {
	op: string;
	[key: string]: unknown;
}

/**
 * Convert a parsed DSP command into apply-ready ops. Returns either
 * `{ ops }` (possibly an empty array for locally-handled commands) or
 * `{ error }` when translation fails (e.g. unresolvable parent).
 *
 * `rawTree` is the RawDspNode root, needed for parent fallback to the
 * current working path and validation.
 */
export function commandToDspOps(
	cmd: DspCommand,
	rawTree: RawDspNode | null,
	currentPath: string[],
): { ops: DspOp[] } | { error: string } {
	switch (cmd.type) {
		case "add": return translateAdd(cmd, rawTree, currentPath);
		case "remove": return translateRemove(cmd);
		case "move": return translateMove(cmd);
		case "connect": return translateConnect(cmd);
		case "disconnect": return translateDisconnect(cmd);
		case "set": return translateSet(cmd, rawTree);
		case "bypass": return translateBypass(cmd, true);
		case "enable": return translateBypass(cmd as BypassCommand | EnableCommand, false);
		case "create_parameter": return translateCreateParameter(cmd);
		case "reset":
			return { ops: [{ op: "clear" }] };
		case "show":
		case "use":
		case "init":
		case "save":
		case "get":
			return { ops: [] };
	}
}

function translateAdd(
	cmd: AddCommand,
	rawTree: RawDspNode | null,
	currentPath: string[],
): { ops: DspOp[] } | { error: string } {
	let parentId: string | null = null;
	if (cmd.parent) {
		parentId = cmd.parent;
	} else if (currentPath.length > 0) {
		parentId = currentPath[currentPath.length - 1]!;
	} else if (rawTree) {
		parentId = rawTree.nodeId;
	}
	if (!parentId) {
		return { error: "add: no parent resolvable (no tree, no `to`, no cd path)" };
	}
	const op: DspOp = {
		op: "add",
		factoryPath: cmd.factoryPath,
		parent: parentId,
	};
	if (cmd.alias) op.nodeId = cmd.alias;
	if (cmd.index !== undefined) op.index = cmd.index;
	return { ops: [op] };
}

function translateRemove(cmd: RemoveCommand): { ops: DspOp[] } {
	return { ops: [{ op: "remove", nodeId: cmd.nodeId }] };
}

function translateMove(cmd: MoveCommand): { ops: DspOp[] } {
	const op: DspOp = { op: "move", nodeId: cmd.nodeId, parent: cmd.parent };
	if (cmd.index !== undefined) op.index = cmd.index;
	return { ops: [op] };
}

function translateConnect(cmd: ConnectCommand): { ops: DspOp[] } {
	const op: DspOp = {
		op: "connect",
		source: cmd.source,
		target: cmd.target,
	};
	if (cmd.parameter !== undefined) op.parameter = cmd.parameter;
	if (cmd.sourceOutput !== undefined) op.sourceOutput = cmd.sourceOutput;
	if (cmd.matchRange) op.matchRange = true;
	return { ops: [op] };
}

function translateDisconnect(cmd: DisconnectCommand): { ops: DspOp[] } {
	return {
		ops: [{
			op: "disconnect",
			source: cmd.source,
			target: cmd.target,
			parameter: cmd.parameter,
		}],
	};
}

function translateSet(
	cmd: SetCommand,
	_rawTree: RawDspNode | null,
): { ops: DspOp[] } | { error: string } {
	// Single-field range-write: emit only the changed field. Backend
	// merges with the parameter's declared range server-side — partial
	// range-write is supported.
	if (cmd.rangeField) {
		const op: DspOp = {
			op: "set",
			nodeId: cmd.nodeId,
			parameterId: cmd.parameterId,
			[cmd.rangeField]: cmd.value,
		};
		return { ops: [op] };
	}

	// Full range-write: any of min/max/stepSize/middlePosition/skewFactor present.
	const isRangeWrite = cmd.min !== undefined
		|| cmd.max !== undefined
		|| cmd.stepSize !== undefined
		|| cmd.middlePosition !== undefined
		|| cmd.skewFactor !== undefined;
	if (isRangeWrite) {
		const op: DspOp = {
			op: "set",
			nodeId: cmd.nodeId,
			parameterId: cmd.parameterId,
		};
		if (cmd.min !== undefined) op.min = cmd.min;
		if (cmd.max !== undefined) op.max = cmd.max;
		if (cmd.stepSize !== undefined) op.stepSize = cmd.stepSize;
		if (cmd.middlePosition !== undefined) op.middlePosition = cmd.middlePosition;
		if (cmd.skewFactor !== undefined) op.skewFactor = cmd.skewFactor;
		return { ops: [op] };
	}

	// Value-write
	return {
		ops: [{
			op: "set",
			nodeId: cmd.nodeId,
			parameterId: cmd.parameterId,
			value: cmd.value,
		}],
	};
}

function translateBypass(
	cmd: BypassCommand | EnableCommand,
	bypassed: boolean,
): { ops: DspOp[] } {
	return {
		ops: [{ op: "bypass", nodeId: cmd.nodeId, bypassed }],
	};
}

function translateCreateParameter(cmd: CreateParameterCommand): { ops: DspOp[] } {
	const op: DspOp = {
		op: "create_parameter",
		nodeId: cmd.nodeId,
		parameterId: cmd.parameterId,
	};
	if (cmd.min !== undefined) op.min = cmd.min;
	if (cmd.max !== undefined) op.max = cmd.max;
	if (cmd.defaultValue !== undefined) op.defaultValue = cmd.defaultValue;
	if (cmd.stepSize !== undefined) op.stepSize = cmd.stepSize;
	if (cmd.middlePosition !== undefined) op.middlePosition = cmd.middlePosition;
	if (cmd.skewFactor !== undefined) op.skewFactor = cmd.skewFactor;
	return { ops: [op] };
}

// ── Raw-tree collection helpers (used by completion) ──────────────

export interface NodeInstance {
	nodeId: string;
	factoryPath: string;
}

/** Walk the raw tree and collect every node as `{nodeId, factoryPath}`. */
export function collectDspNodeIds(root: RawDspNode | null): NodeInstance[] {
	if (!root) return [];
	const result: NodeInstance[] = [];
	walk(root, result);
	return result;
}

function walk(node: RawDspNode, out: NodeInstance[]): void {
	out.push({ nodeId: node.nodeId, factoryPath: node.factoryPath });
	for (const c of node.children) walk(c, out);
}

/** Return the parameter IDs for a given nodeId using the raw tree. */
export function nodeParameters(root: RawDspNode | null, nodeId: string): string[] {
	const node = findDspNode(root, nodeId);
	if (!node) return [];
	return node.parameters.map((p) => p.parameterId);
}

/**
 * Return the union of parameter IDs and valid property names for a given
 * nodeId. Properties come from the scriptnode metadata (universal NodeBase
 * props + container-only props + factory-specific props from `def.properties`).
 * For the root network node, network-level properties (AllowCompilation,
 * AllowPolyphonic, ...) are appended.
 */
export function nodeParametersAndProperties(
	root: RawDspNode | null,
	list: ScriptnodeList,
	nodeId: string,
): string[] {
	const node = findDspNode(root, nodeId);
	if (!node) return [];
	const paramIds = node.parameters.map((p) => p.parameterId);
	const isRoot = root !== null && root.nodeId === nodeId;
	const rootProps = isRoot ? ROOT_NETWORK_PROPERTY_NAMES : [];
	const def = list[node.factoryPath];
	if (!def) return [...paramIds, ...rootProps];
	return [...paramIds, ...nodePropertyNames(def), ...rootProps];
}
