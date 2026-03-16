// ── Dummy module tree — realistic HISE hierarchy for development ────
//
// Used by BuilderMode when no live HISE connection is available.
// Structure follows the rules documented in docs/MODULE_TREE.md:
// - Chains are first-class navigable nodes (nodeKind: "chain")
// - Modulators go inside modulation chains, not directly under synths
// - Constrainer patterns control what subtypes a chain accepts
// - SynthGroup's child_fx_constrainer overrides child FX chains

import type { TreeNode } from "../result.js";

function chain(
	label: string,
	constrainer: string,
	children?: TreeNode[],
): TreeNode {
	return {
		label,
		id: label,
		nodeKind: "chain",
		chainConstrainer: constrainer,
		children,
	};
}

function mod(
	label: string,
	type: string,
	children?: TreeNode[],
): TreeNode {
	return {
		label,
		id: label,
		type,
		nodeKind: "module",
		children,
	};
}

function synth(
	label: string,
	type: string,
	children?: TreeNode[],
): TreeNode {
	return {
		label,
		id: label,
		type,
		nodeKind: "module",
		children,
	};
}

export const DUMMY_MODULE_TREE: TreeNode = synth("Master", "SynthChain", [
	chain("Gain Modulation", "TimeVariantModulator", [
		mod("CC1", "MidiController"),
	]),
	chain("FX Chain", "MasterEffect", [
		mod("Output", "SimpleGain"),
		mod("Hall", "SimpleReverb"),
	]),
	synth("Oscillators", "SynthGroup", [
		chain("Gain Modulation", "*", [
			mod("Velocity", "Velocity"),
			mod("Volume Env", "AHDSR", [
				chain("AttackTimeModulation", "VoiceStartModulator", [
					mod("KeyNumber", "KeyNumber"),
				]),
			]),
		]),
		chain("Pitch Modulation", "*", [
			mod("Vibrato", "LFO", [
				chain("LFO Intensity Mod", "*"),
				chain("LFO Frequency Mod", "*"),
			]),
		]),
		chain("Detune Modulation", "*"),
		chain("Spread Modulation", "*"),
		chain("FX Chain", "*", [
			mod("LP", "PolyphonicFilter", [
				chain("Frequency Modulation", "*", [
					mod("Filter Env", "AHDSR"),
				]),
				chain("Gain Modulation", "*"),
				chain("Bipolar Freq Modulation", "*"),
				chain("Q Modulation", "*"),
			]),
		]),
		synth("Osc 1", "SineSynth", [
			chain("Gain Modulation", "*"),
			chain("Pitch Modulation", "*"),
			chain("FX Chain", "VoiceEffect"),
		]),
		synth("Osc 2", "SineSynth", [
			chain("Gain Modulation", "*"),
			chain("Pitch Modulation", "*"),
			chain("FX Chain", "VoiceEffect"),
		]),
	]),
	synth("Piano", "StreamingSampler", [
		chain("Gain Modulation", "*", [
			mod("Velocity", "Velocity"),
			mod("Piano Env", "AHDSR"),
		]),
		chain("Pitch Modulation", "*"),
		chain("Sample Start", "*"),
		chain("Group Fade", "*"),
		chain("FX Chain", "*", [
			mod("Room", "Convolution"),
		]),
	]),
]);
