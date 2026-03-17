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
	colour?: string,
): TreeNode {
	return {
		label,
		id: label,
		nodeKind: "chain",
		chainConstrainer: constrainer,
		children,
		colour,
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

// Chain colours — known constants for FX and MIDI, data-driven for modulation.
// Gain/Pitch have explicit colours. Sub-chains (AttackTimeModulation, LFO
// Intensity, etc.) have no colour — they inherit from their parent chain
// via propagateChainColors() in builder.ts.
const GAIN_COLOUR = "#be952c";
const PITCH_COLOUR = "#7559a4";
const FX_COLOUR = "#3a6666";
// const MIDI_COLOUR = "#C65638"; // not used in dummy tree (no MIDI chains)

export const DUMMY_MODULE_TREE: TreeNode = synth("Master", "SynthChain", [
	chain("Gain Modulation", "TimeVariantModulator", [
		mod("CC1", "MidiController"),
	], GAIN_COLOUR),
	chain("FX Chain", "MasterEffect", [
		mod("Output", "SimpleGain"),
		mod("Hall", "SimpleReverb"),
	], FX_COLOUR),
	synth("Oscillators", "SynthGroup", [
		chain("Gain Modulation", "*", [
			mod("Velocity", "Velocity"),
			mod("Volume Env", "AHDSR", [
				chain("AttackTimeModulation", "VoiceStartModulator", [
					mod("KeyNumber", "KeyNumber"),
				]),
			]),
		], GAIN_COLOUR),
		chain("Pitch Modulation", "*", [
			mod("Vibrato", "LFO", [
				chain("LFO Intensity Mod", "*"),
				chain("LFO Frequency Mod", "*"),
			]),
		], PITCH_COLOUR),
		chain("Detune Modulation", "*"),
		chain("Spread Modulation", "*"),
		chain("FX Chain", "*", [
			mod("LP", "PolyphonicFilter", [
				chain("Frequency Modulation", "*"),
				chain("Gain Modulation", "*"),
				chain("Bipolar Freq Modulation", "*"),
				chain("Q Modulation", "*"),
			]),
		], FX_COLOUR),
		synth("Osc 1", "SineSynth", [
			chain("Gain Modulation", "*", undefined, GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("FX Chain", "VoiceEffect", undefined, FX_COLOUR),
		]),
		synth("Osc 2", "SineSynth", [
			chain("Gain Modulation", "*", undefined, GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("FX Chain", "VoiceEffect", undefined, FX_COLOUR),
		]),
	]),
	synth("Piano", "StreamingSampler", [
		chain("Gain Modulation", "*", [
			mod("Velocity", "Velocity"),
			mod("Piano Env", "AHDSR"),
		], GAIN_COLOUR),
		chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
		chain("Sample Start", "*"),
		chain("Group Fade", "*"),
		chain("FX Chain", "*", [
			mod("Room", "Convolution"),
		], FX_COLOUR),
	]),
]);
