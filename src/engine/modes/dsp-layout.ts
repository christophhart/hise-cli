import type { RawDspBounds, RawDspConnection, RawDspNode } from "../../mock/contracts/dsp.js";

export type CompactBounds = [x: number, y: number, width: number, height: number];

export interface CompactDspLayoutNode {
	id: string;
	bounds: CompactBounds;
	vertical?: boolean;
	children?: CompactDspLayoutNode[];
}

export interface LayoutCandidate {
	id: string;
	vertical: boolean;
	bounds: RawDspBounds;
	depth: number;
	localExtremeness: number;
}

export type LayoutScore = [area: number, longestSide: number, perimeter: number];

export function compactDspLayout(root: RawDspNode): CompactDspLayoutNode {
	if (!root.bounds) throw new Error(`DSP layout node "${root.nodeId}" is missing bounds`);
	const children = root.children.map(compactDspLayout);
	const vertical = readIsVertical(root);
	return {
		id: root.nodeId,
		bounds: boundsTuple(root.bounds),
		vertical: vertical ?? undefined,
		children: children.length > 0 ? children : undefined,
	};
}

export function collectLayoutCandidates(root: RawDspNode): LayoutCandidate[] {
	const candidates: LayoutCandidate[] = [];
	const visit = (node: RawDspNode, depth: number): void => {
		const vertical = readIsVertical(node);
		if (vertical !== null && node.bounds) {
			candidates.push({
				id: node.nodeId,
				vertical,
				bounds: node.bounds,
				depth,
				localExtremeness: aspectExtremeness(node.bounds),
			});
		}
		for (const child of node.children) visit(child, depth + 1);
	};
	visit(root, 0);
	return candidates;
}

export function layoutScore(bounds: RawDspBounds): LayoutScore {
	return [
		bounds.width * bounds.height,
		Math.max(bounds.width, bounds.height),
		bounds.width + bounds.height,
	];
}

export function compareLayoutScores(a: readonly number[], b: readonly number[]): number {
	for (let i = 0; i < a.length; i++) {
		if (a[i]! < b[i]!) return -1;
		if (a[i]! > b[i]!) return 1;
	}
	return 0;
}

export function layoutImpact(baseline: RawDspBounds, candidate: RawDspBounds): number {
	const baselineArea = Math.max(1, baseline.width * baseline.height);
	const candidateArea = candidate.width * candidate.height;
	const areaSensitivity = Math.abs(candidateArea - baselineArea) / baselineArea;
	const baselineAspect = safeAspect(baseline);
	const candidateAspect = safeAspect(candidate);
	const shapeSensitivity = Math.abs(Math.log(candidateAspect / baselineAspect));
	return areaSensitivity + 0.1 * shapeSensitivity;
}

export interface CablePressure {
	horizontal: number;
	vertical: number;
}

export function selectWeightedLayout<T extends {
	bounds: RawDspBounds;
	verticality: number;
	cableClarity: number;
}>(options: readonly T[], verticalThreshold: number, cableWeight: number): T {
	if (options.length === 0) throw new Error("Cannot select a layout from no options");
	const geometryScores = options.map((option) => {
		const area = option.bounds.width * option.bounds.height;
		return area * (1 + verticalThreshold * (1 - option.verticality));
	});
	const minGeometry = Math.min(...geometryScores);
	const maxGeometry = Math.max(...geometryScores);
	const geometryRange = maxGeometry - minGeometry;
	let winner = options[0]!;
	let winnerScore = Number.POSITIVE_INFINITY;
	for (let i = 0; i < options.length; i++) {
		const option = options[i]!;
		const geometryLoss = geometryRange === 0 ? 0 : (geometryScores[i]! - minGeometry) / geometryRange;
		const cableLoss = 1 - option.cableClarity;
		const score = (1 - cableWeight) * geometryLoss + cableWeight * cableLoss;
		if (score < winnerScore
			|| (score === winnerScore
				&& compareLayoutScores(layoutScore(option.bounds), layoutScore(winner.bounds)) < 0)) {
			winner = option;
			winnerScore = score;
		}
	}
	return winner;
}

export interface VisibleCableStats {
	visibleNodes: number;
	visibleConnections: number;
}

export function visibleCableStats(root: RawDspNode): VisibleCableStats {
	const graph = collectVisibleCableGraph(root);
	return { visibleNodes: graph.visibleNodeIds.size, visibleConnections: graph.connections.length };
}

export function autoCableWeight(stats: VisibleCableStats): number {
	const total = stats.visibleConnections + stats.visibleNodes;
	return total === 0 ? 0 : stats.visibleConnections / total;
}

export function collectCablePressures(root: RawDspNode): Map<string, CablePressure> {
	const connections = collectVisibleCableGraph(root).connections;
	const pressures = new Map<string, CablePressure>();
	const visit = (node: RawDspNode): void => {
		if (node.children.length >= 2) {
			const branches = new Map<string, string>();
			for (const child of node.children) {
				const addBranch = (descendant: RawDspNode): void => {
					branches.set(descendant.nodeId, child.nodeId);
					for (const nested of descendant.children) addBranch(nested);
				};
				addBranch(child);
			}
			let boundaryTotal = 0;
			let crossChildTotal = 0;
			const boundaryBranches = new Set<string>();
			const crossChildBranches = new Set<string>();
			for (const connection of connections) {
				const sourceBranch = branches.get(connection.source);
				const targetBranch = branches.get(connection.target);
				if (sourceBranch && targetBranch && sourceBranch !== targetBranch) {
					crossChildTotal++;
					crossChildBranches.add(sourceBranch);
					crossChildBranches.add(targetBranch);
				}
				if (sourceBranch && !targetBranch && connection.target !== node.nodeId) {
					boundaryTotal++;
					boundaryBranches.add(sourceBranch);
				}
				if (targetBranch && !sourceBranch && connection.source !== node.nodeId) {
					boundaryTotal++;
					boundaryBranches.add(targetBranch);
				}
			}
			const horizontal = boundaryTotal >= 3 && boundaryBranches.size >= 2
				? boundaryTotal + 2 * (boundaryBranches.size - 1)
				: 0;
			const vertical = crossChildTotal > 0
				? crossChildTotal + 2 * (crossChildBranches.size - 1)
				: 0;
			if (horizontal > 0 || vertical > 0) pressures.set(node.nodeId, { horizontal, vertical });
		}
		for (const child of node.children) visit(child);
	};
	visit(root);
	return pressures;
}

export function orientationMetrics(
	toggledIds: ReadonlySet<string>,
	candidates: readonly LayoutCandidate[],
	cablePressures: ReadonlyMap<string, CablePressure>,
): { verticality: number; cableClarity: number } {
	let verticalCount = 0;
	let totalPressure = 0;
	let satisfiedPressure = 0;
	for (const candidate of candidates) {
		const vertical = toggledIds.has(candidate.id) ? !candidate.vertical : candidate.vertical;
		if (vertical) verticalCount++;
		const pressure = cablePressures.get(candidate.id) ?? { horizontal: 0, vertical: 0 };
		totalPressure += pressure.horizontal + pressure.vertical;
		satisfiedPressure += vertical ? pressure.vertical : pressure.horizontal;
	}
	return {
		verticality: candidates.length === 0 ? 1 : verticalCount / candidates.length,
		cableClarity: totalPressure === 0 ? 1 : satisfiedPressure / totalPressure,
	};
}

export function selectImpactCandidates<T extends LayoutCandidate & { impact: number }>(
	candidates: T[],
	limit = 5,
): T[] {
	return [...candidates]
		.sort((a, b) => b.impact - a.impact
			|| b.localExtremeness - a.localExtremeness
			|| b.depth - a.depth
			|| a.id.localeCompare(b.id))
		.slice(0, limit);
}

export function orientationKey(toggledIds: ReadonlySet<string>, selected: readonly LayoutCandidate[]): string {
	return selected.map((candidate) => toggledIds.has(candidate.id) ? "1" : "0").join("");
}

export function boundsTuple(bounds: RawDspBounds): CompactBounds {
	return [bounds.x, bounds.y, bounds.width, bounds.height];
}

function collectVisibleCableGraph(root: RawDspNode): {
	visibleNodeIds: Set<string>;
	connections: RawDspConnection[];
} {
	const visibleNodeIds = new Set<string>();
	const cableEndpointIds = new Set<string>();
	const allConnections: RawDspConnection[] = [];
	const visit = (node: RawDspNode, ancestorFolded: boolean): void => {
		const folded = readBooleanProperty(node, "Folded") === true;
		if (!ancestorFolded) visibleNodeIds.add(node.nodeId);
		if (!ancestorFolded && !folded) cableEndpointIds.add(node.nodeId);
		allConnections.push(...(node.connections ?? []));
		for (const child of node.children) visit(child, ancestorFolded || folded);
	};
	visit(root, false);
	return {
		visibleNodeIds,
		connections: allConnections.filter((connection) =>
			cableEndpointIds.has(connection.source) && cableEndpointIds.has(connection.target)),
	};
}

function readBooleanProperty(node: RawDspNode, propertyId: string): boolean | null {
	const property = node.properties?.find((entry) => entry.propertyId.toLowerCase() === propertyId.toLowerCase());
	if (!property) return null;
	if (typeof property.value === "boolean") return property.value;
	if (typeof property.value === "number") return property.value !== 0;
	const normalized = property.value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1") return true;
	if (normalized === "false" || normalized === "0") return false;
	return null;
}

function readIsVertical(node: RawDspNode): boolean | null {
	return readBooleanProperty(node, "IsVertical");
}

function aspectExtremeness(bounds: RawDspBounds): number {
	return Math.abs(Math.log(safeAspect(bounds)));
}

function safeAspect(bounds: RawDspBounds): number {
	return Math.max(1, bounds.width) / Math.max(1, bounds.height);
}
