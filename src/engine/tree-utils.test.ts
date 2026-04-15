import { describe, it, expect } from "vitest";
import type { TreeNode } from "./result.js";
import { findNodeById, resolveNodeByPath } from "./tree-utils.js";

const tree: TreeNode = {
	label: "Master",
	id: "MasterContainer",
	children: [
		{
			label: "Sine",
			id: "SineSynth",
			children: [
				{ label: "FX Chain", id: "FX Chain", children: [] },
				{ label: "Gain", id: "SimpleGain", children: [] },
			],
		},
		{
			label: "Noise",
			id: "NoiseSynth",
			children: [],
		},
	],
};

describe("findNodeById", () => {
	it("finds root node by id", () => {
		expect(findNodeById(tree, "MasterContainer")?.id).toBe("MasterContainer");
	});

	it("finds deeply nested node", () => {
		expect(findNodeById(tree, "SimpleGain")?.label).toBe("Gain");
	});

	it("is case-insensitive", () => {
		expect(findNodeById(tree, "sinesynth")?.id).toBe("SineSynth");
	});

	it("returns null for non-existent id", () => {
		expect(findNodeById(tree, "Missing")).toBeNull();
	});

	it("returns null for null tree", () => {
		expect(findNodeById(null, "anything")).toBeNull();
	});
});

describe("resolveNodeByPath", () => {
	it("resolves empty path to root", () => {
		expect(resolveNodeByPath(tree, [])).toBe(tree);
	});

	it("resolves single-segment path", () => {
		expect(resolveNodeByPath(tree, ["SineSynth"])?.id).toBe("SineSynth");
	});

	it("resolves multi-segment path", () => {
		expect(resolveNodeByPath(tree, ["SineSynth", "SimpleGain"])?.label).toBe("Gain");
	});

	it("is case-insensitive", () => {
		expect(resolveNodeByPath(tree, ["sinesynth", "simplegain"])?.id).toBe("SimpleGain");
	});

	it("returns null for invalid path", () => {
		expect(resolveNodeByPath(tree, ["SineSynth", "Missing"])).toBeNull();
	});

	it("returns null for null tree", () => {
		expect(resolveNodeByPath(null, ["anything"])).toBeNull();
	});
});
