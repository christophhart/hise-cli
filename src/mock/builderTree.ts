// Mock builder tree - Hybrid Keys HISE project captured from live API.
//
// Structure follows the rules documented in docs/MODULE_TREE.md:
// - Chains are first-class navigable nodes (nodeKind: "chain")
// - Modulators go inside modulation chains, not directly under synths
// - Constrainer patterns control what subtypes a chain accepts
// - SynthGroup's child_fx_constrainer overrides child FX chains
//
// A few nodes have diff annotations for visual testing of the sidebar.

import type { TreeNode } from "../engine/result.js";

type DiffStatus = "added" | "removed" | "modified";

function chain(
	label: string,
	constrainer: string,
	children?: TreeNode[],
	colour?: string,
	diff?: DiffStatus,
): TreeNode {
	return {
		label,
		id: label,
		nodeKind: "chain",
		chainConstrainer: constrainer,
		children,
		colour,
		diff,
	};
}

function mod(
	label: string,
	type: string,
	children?: TreeNode[],
	diff?: DiffStatus,
): TreeNode {
	return {
		label,
		id: label,
		type,
		nodeKind: "module",
		children,
		diff,
	};
}

function synth(
	label: string,
	type: string,
	children?: TreeNode[],
	diff?: DiffStatus,
): TreeNode {
	return {
		label,
		id: label,
		type,
		nodeKind: "module",
		children,
		diff,
	};
}

// Chain colours from the live Hybrid Keys API response.
const GAIN_COLOUR = "#BE952C";
const PITCH_COLOUR = "#7559A4";
const FX_COLOUR = "#3A6666";
const MIDI_COLOUR = "#C65638";
const SAMPLE_START_COLOUR = "#5E8127";
const GROUP_FADE_COLOUR = "#884B29";
const DETUNE_COLOUR = "#880022";
const SPREAD_COLOUR = "#22AA88";
const TABLE_INDEX_COLOUR = "#4D54B3";

export const MOCK_BUILDER_TREE: TreeNode = synth("Master Chain", "SynthChain", [
	chain("MIDI Processor Chain", "MidiProcessor", [
		mod("Interface", "ScriptProcessor"),
	], MIDI_COLOUR),
	chain("Gain Modulation", "TimeVariantModulator", undefined, GAIN_COLOUR),
	chain("Pitch Modulation", "*", undefined, "#808080"),
	chain("FX Chain", "MasterEffect|MonophonicEffect|PolyphonicFilter", [
		mod("EQ", "CurveEq"),
		mod("Master Reverb", "SimpleReverb"),
		mod("Limiter", "SimpleGain", [
			chain("Gain Modulation", "*", undefined, FX_COLOUR),
			chain("Delay Modulation", "*", undefined, FX_COLOUR),
			chain("Width Modulation", "*", undefined, FX_COLOUR),
			chain("Pan Modulation", "*", undefined, FX_COLOUR),
		]),
	], FX_COLOUR),
	synth("Sampler Layer", "SynthChain", [
		chain("Gain Modulation", "TimeVariantModulator", undefined, GAIN_COLOUR),
		chain("Pitch Modulation", "*", undefined, "#808080"),
		chain("FX Chain", "MasterEffect|MonophonicEffect|PolyphonicFilter", [
			mod("Layer Reverb", "SimpleReverb"),
		], FX_COLOUR),
		synth("Piano", "StreamingSampler", [
			chain("Gain Modulation", "*", [
				mod("Layer Envelope", "AHDSR", [
					chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
					chain("AttackLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
					chain("DecayTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
					chain("SustainLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
					chain("ReleaseTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				]),
			], GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("Sample Start", "VoiceStartModulator", undefined, SAMPLE_START_COLOUR),
			chain("Group Fade", "*", undefined, GROUP_FADE_COLOUR),
			chain("FX Chain", "*"),
		]),
		synth("Piano Release", "StreamingSampler", [
			chain("MIDI Processor Chain", "MidiProcessor", [
				mod("Release Trigger", "ReleaseTrigger"),
			], MIDI_COLOUR),
			chain("Gain Modulation", "*", [
				mod("DefaultEnvelope", "SimpleEnvelope", [
					chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				]),
			], GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("Sample Start", "VoiceStartModulator", undefined, SAMPLE_START_COLOUR),
			chain("Group Fade", "*", undefined, GROUP_FADE_COLOUR),
			chain("FX Chain", "*"),
		]),
	]),
	synth("Synth Layer", "SynthGroup", [
		chain("Gain Modulation", "*", [
			mod("Synth Envelope", "AHDSR", [
				chain("AttackTimeModulation", "VoiceStartModulator", [
					mod("Vel Attack", "Velocity"),
				], GAIN_COLOUR),
				chain("AttackLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("DecayTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("SustainLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("ReleaseTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
			]),
			mod("Vibrato", "LFO", [
				chain("LFO Intensity Mod", "*", undefined, GAIN_COLOUR),
				chain("LFO Frequency Mod", "*", undefined, GAIN_COLOUR),
			]),
		], GAIN_COLOUR),
		chain("Pitch Modulation", "*", [
			mod("Pitch LFO", "LFO", [
				chain("LFO Intensity Mod", "*", undefined, PITCH_COLOUR),
				chain("LFO Frequency Mod", "*", undefined, PITCH_COLOUR),
			]),
		], PITCH_COLOUR),
		chain("Detune Modulation", "*", undefined, DETUNE_COLOUR),
		chain("Spread Modulation", "*", undefined, SPREAD_COLOUR),
		chain("FX Chain", "*", [
			mod("Chorus", "Chorus", undefined, "added"),
		], FX_COLOUR),
		synth("Pad Osc 1", "WavetableSynth", [
			chain("Gain Modulation", "*", [
				mod("DefaultEnvelope2", "SimpleEnvelope", [
					chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				]),
			], GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("Table Index", "*", undefined, TABLE_INDEX_COLOUR),
			chain("Table Index Bipolar", "*", undefined, TABLE_INDEX_COLOUR),
			chain("FX Chain", "*"),
		]),
		synth("Pad Osc 2", "WavetableSynth", [
			chain("Gain Modulation", "*", [
				mod("DefaultEnvelope3", "SimpleEnvelope", [
					chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				]),
			], GAIN_COLOUR),
			chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
			chain("Table Index", "*", undefined, TABLE_INDEX_COLOUR),
			chain("Table Index Bipolar", "*", undefined, TABLE_INDEX_COLOUR),
			chain("FX Chain", "*"),
		], "modified"),
	]),
	synth("Sub Bass", "SineSynth", [
		chain("Gain Modulation", "*", [
			mod("DefaultEnvelope4", "SimpleEnvelope", [
				chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
			]),
			mod("Sub Envelope", "AHDSR", [
				chain("AttackTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("AttackLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("DecayTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("SustainLevelModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
				chain("ReleaseTimeModulation", "VoiceStartModulator", undefined, GAIN_COLOUR),
			]),
		], GAIN_COLOUR),
		chain("Pitch Modulation", "*", undefined, PITCH_COLOUR),
		chain("FX Chain", "*"),
	]),
]);
