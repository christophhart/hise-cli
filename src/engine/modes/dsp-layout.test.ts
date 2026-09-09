import { describe, expect, it } from "vitest";
import type { RawDspNode } from "../../mock/contracts/dsp.js";
import {
	autoCableWeight,
	collectCablePressures,
	collectLayoutCandidates,
	compactDspLayout,
	compareLayoutScores,
	layoutImpact,
	layoutScore,
	orientationMetrics,
	selectImpactCandidates,
	selectWeightedLayout,
	visibleCableStats,
} from "./dsp-layout.js";

function node(
	id: string,
	width: number,
	height: number,
	vertical: boolean | undefined,
	children: RawDspNode[] = [],
): RawDspNode {
	return {
		nodeId: id,
		factoryPath: children.length > 0 ? "container.chain" : "core.gain",
		bypassed: false,
		bounds: { x: 0, y: 0, width, height },
		parameters: [],
		properties: vertical === undefined ? [] : [{ propertyId: "IsVertical", value: vertical }],
		children,
	};
}

describe("DSP layout helpers", () => {
	it("distills bounds, orientation, and hierarchy", () => {
		const root = node("root", 500, 300, true, [node("gain", 128, 100, undefined)]);
		expect(compactDspLayout(root)).toEqual({
			id: "root",
			bounds: [0, 0, 500, 300],
			vertical: true,
			children: [{ id: "gain", bounds: [0, 0, 128, 100], vertical: undefined, children: undefined }],
		});
	});

	it("collects only nodes with bounds and a boolean IsVertical value", () => {
		const root = node("root", 500, 300, true, [node("nested", 50, 400, false)]);
		const candidates = collectLayoutCandidates(root);
		expect(candidates.map((candidate) => [candidate.id, candidate.vertical, candidate.depth]))
			.toEqual([["root", true, 0], ["nested", false, 1]]);
		expect(candidates[1]!.localExtremeness).toBeGreaterThan(candidates[0]!.localExtremeness);
	});

	it("interpolates from geometry-only to cable-only scoring", () => {
		const compact = {
			id: "compact", bounds: { x: 0, y: 0, width: 100, height: 100 }, verticality: 1, cableClarity: 0,
		};
		const clear = {
			id: "clear", bounds: { x: 0, y: 0, width: 200, height: 100 }, verticality: 1, cableClarity: 1,
		};
		expect(selectWeightedLayout([compact, clear], 0.1, 0).id).toBe("compact");
		expect(selectWeightedLayout([compact, clear], 0.1, 1).id).toBe("clear");
	});

	it("excludes folded cable endpoints from automatic density", () => {
		const root = node("root", 500, 500, true, [
			node("visible", 100, 100, undefined),
			node("folded", 100, 24, undefined),
			node("target", 100, 100, undefined),
		]);
		root.children[1]!.properties = [{ propertyId: "Folded", value: "1" }];
		root.connections = [
			{ source: "visible", sourceOutput: 0, target: "folded", parameter: "Value" },
			{ source: "visible", sourceOutput: 0, target: "target", parameter: "Value" },
		];
		const stats = visibleCableStats(root);
		expect(stats).toEqual({ visibleNodes: 4, visibleConnections: 1 });
		expect(autoCableWeight(stats)).toBe(0.2);
	});

	it("separates horizontal boundary pressure from vertical cross-child pressure", () => {
		const pmas = [node("pma", 100, 100, undefined), node("pma2", 100, 100, undefined), node("pma1", 100, 100, undefined)];
		const clears = [node("clear", 100, 100, undefined), node("clear2", 100, 100, undefined), node("clear1", 100, 100, undefined)];
		const root = node("root", 500, 500, true, [
			node("chain", 400, 200, false, pmas),
			node("chain1", 400, 200, false, clears),
		]);
		root.connections = pmas.map((source, index) => ({
			source: source.nodeId, sourceOutput: 0, target: clears[index]!.nodeId, parameter: "Value",
		}));
		const pressures = collectCablePressures(root);
		expect(pressures.get("chain")).toEqual({ horizontal: 7, vertical: 0 });
		expect(pressures.get("chain1")).toEqual({ horizontal: 7, vertical: 0 });
		expect(pressures.get("root")).toEqual({ horizontal: 0, vertical: 5 });
		const candidates = collectLayoutCandidates(root);
		expect(orientationMetrics(new Set(), candidates, pressures)).toEqual({ verticality: 1 / 3, cableClarity: 1 });
	});

	it("scores area first and ranks measured impact before inherited size", () => {
		expect(compareLayoutScores(layoutScore({ x: 0, y: 0, width: 100, height: 100 }), layoutScore({ x: 0, y: 0, width: 200, height: 100 }))).toBeLessThan(0);
		expect(layoutImpact(
			{ x: 0, y: 0, width: 1000, height: 1000 },
			{ x: 0, y: 0, width: 800, height: 1000 },
		)).toBeGreaterThan(0);

		const candidates = collectLayoutCandidates(node("parent", 1000, 1000, true, [node("child", 50, 800, true)]));
		const selected = selectImpactCandidates([
			{ ...candidates[0]!, impact: 0.01 },
			{ ...candidates[1]!, impact: 0.25 },
		], 1);
		expect(selected[0]!.id).toBe("child");
	});
});
