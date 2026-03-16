# Module Tree Structure

Reference for the HISE module hierarchy. Used by builder mode for
pre-validation, tree sidebar display, and CLI tree queries. All data
derived from `data/moduleList.json`.

## Module categories

| `type`         | `subtype`              | Count | Description                          |
|----------------|------------------------|-------|--------------------------------------|
| SoundGenerator | SoundGenerator         | 18    | Audio-producing (synths, containers) |
| Modulator      | VoiceStartModulator    | 9     | Fires once per note-on               |
| Modulator      | TimeVariantModulator   | 7     | Continuous monophonic signal          |
| Modulator      | EnvelopeModulator      | 11    | Per-voice time-varying               |
| Effect         | MasterEffect           | 18    | Monophonic, post-voice-summing       |
| Effect         | VoiceEffect            | 7     | Polyphonic, per-voice                |
| Effect         | MonophonicEffect       | 1     | HarmonicFilterMono only              |
| MidiProcessor  | MidiProcessor          | 11    | MIDI event processing                |

Source: `ModuleType` and `ModuleSubtype` unions in `src/engine/data.ts`.

## Container rules

Only 3 modules accept child sound generators (`hasChildren: true`):

| Module       | constrainer | Notes                                    |
|-------------|-------------|------------------------------------------|
| SynthChain  | `"*"`       | Accepts any sound generator              |
| SynthGroup  | `"!ModulatorSynthChain\|!GlobalModulatorContainer\|!ModulatorSynthGroup\|!MacroModulationSource"` | Excludes other containers |
| SlotFX      | `"*"`       | Special: holds a single swappable effect |

All other sound generators have `hasChildren: false` — they cannot
contain other sound generators.

## Chain structure

Every sound generator has internal chains. These are **first-class
navigable nodes** in the tree (you `cd` into a chain, then `add`
modules to it).

### Standard chains (most sound generators)

| chainIndex | Chain id            | modulationMode | constrainer | Notes        |
|-----------|---------------------|----------------|-------------|--------------|
| (0)       | MIDI Processor Chain | —              | —           | Implicit     |
| 1         | Gain Modulation      | `"gain"`       | `"*"`       | Volume mod   |
| 2         | Pitch Modulation     | `"pitch"`      | `"*"`       | Pitch mod    |
| —         | FX Chain             | —              | varies      | If hasFX     |

**SynthChain exception**: Gain Modulation constrainer = `"TimeVariantModulator"`
(only TimeVariantModulators, not envelopes or voice-start). Pitch Modulation
is `disabled: true`.

### Extra chains by module

| Module              | Extra chains                                        |
|--------------------|-----------------------------------------------------|
| StreamingSampler    | Sample Start (4), Group Fade (5)                    |
| WaveSynth           | Mix Modulation (4), Osc2 Pitch Modulation (5)       |
| WavetableSynth      | Table Index (4), Table Index Bipolar (5)             |
| SynthGroup          | Detune Modulation (4), Spread Modulation (5)         |
| MacroModulationSource | Macro 1–8 (4–11)                                  |
| GlobalModulatorContainer | Global Modulators (1, constrainer: `"!Global*Modulator"`) |

### Effect modulation chains

| Effect            | Chains                                               |
|-------------------|------------------------------------------------------|
| PolyphonicFilter  | Frequency Mod (0), Gain Mod (1), Bipolar Freq (2), Q Mod (3) |
| SimpleGain        | Gain Mod (0), Delay Mod (1), Width Mod (2), Pan Mod (3)      |
| StereoFX          | Pan Modulation (0)                                   |
| PhaseFX           | Phase Modulation (0)                                 |
| Saturator         | Saturation Modulation (0)                            |
| PolyshapeFX       | Drive Modulation (0)                                 |
| HarmonicFilter    | X-Fade Modulation (0)                                |
| SendFX            | Send Modulation (0)                                  |

### Modulator internal chains

Modulators can have their own sub-chains (modulation of modulation):

| Modulator       | Chains                                                    | Constrainer          |
|----------------|-----------------------------------------------------------|----------------------|
| LFO            | LFO Intensity Mod (0), LFO Frequency Mod (1)              | `"*"`                |
| AHDSR          | AttackTime (0), AttackLevel (1), DecayTime (2), SustainLevel (3), ReleaseTime (4) | `"VoiceStartModulator"` |
| FlexAHDSR      | Same as AHDSR                                              | `"VoiceStartModulator"` |
| SimpleEnvelope | AttackTimeModulation (0)                                   | `"VoiceStartModulator"` |
| TableEnvelope  | AttackTimeModulation (0), ReleaseTimeModulation (1)        | `"VoiceStartModulator"` |

## FX chain constraints

| Module context     | `fx_constrainer`  | Notes                              |
|-------------------|-------------------|------------------------------------|
| Most sound gens   | `"*"`             | Any effect                         |
| SynthChain        | `"MasterEffect"`  | Only master effects                |
| SendContainer     | `"MasterEffect"`  | Only master effects                |
| SynthGroup child  | `"VoiceEffect"`   | `child_fx_constrainer` overrides   |

The `child_fx_constrainer` on a container **overrides** the
`fx_constrainer` of sound generators inside it. So a SineSynth inside
a SynthGroup can only have VoiceEffect-subtype effects, even though
SineSynth's own `fx_constrainer` is `"*"`.

## Constrainer pattern language

The `constrainer` field uses a pipe-delimited pattern:

- `"*"` — accept anything of the appropriate type
- `"TypeName"` — accept only this subtype
- `"!TypeName"` — exclude this type
- `"TypeA|TypeB"` — accept TypeA or TypeB
- `"!TypeA|!TypeB"` — exclude TypeA and TypeB

## Canonical tree example

A realistic module tree with correct chain structure:

```
SynthChain "Master"
├─ [Gain Modulation]                    constrainer: TimeVariantModulator
│  └─ MidiController "CC1"
├─ [FX Chain]                           constrainer: MasterEffect
│  ├─ SimpleGain "Output"
│  └─ SimpleReverb "Hall"
├─ SynthGroup "Oscillators"
│  ├─ [Gain Modulation]                 constrainer: *
│  │  ├─ Velocity
│  │  └─ AHDSR "Volume Env"
│  │     └─ [AttackTimeModulation]      constrainer: VoiceStartModulator
│  │        └─ KeyNumber
│  ├─ [Pitch Modulation]               constrainer: *
│  │  └─ LFO "Vibrato"
│  │     ├─ [LFO Intensity Mod]        constrainer: *
│  │     └─ [LFO Frequency Mod]        constrainer: *
│  ├─ [FX Chain]                        constrainer: *
│  │  └─ PolyphonicFilter "LP"
│  │     └─ [Frequency Modulation]     constrainer: *
│  │        └─ AHDSR "Filter Env"
│  ├─ SineSynth "Osc 1"
│  │  ├─ [Gain Modulation]             constrainer: *
│  │  ├─ [Pitch Modulation]            constrainer: *
│  │  └─ [FX Chain]                    constrainer: VoiceEffect (child override)
│  └─ SineSynth "Osc 2"
│     ├─ [Gain Modulation]             constrainer: *
│     ├─ [Pitch Modulation]            constrainer: *
│     └─ [FX Chain]                    constrainer: VoiceEffect (child override)
└─ StreamingSampler "Piano"
   ├─ [Gain Modulation]                constrainer: *
   │  ├─ Velocity
   │  └─ AHDSR "Piano Env"
   ├─ [Pitch Modulation]               constrainer: *
   ├─ [Sample Start]                   constrainer: *
   ├─ [Group Fade]                     constrainer: *
   └─ [FX Chain]                       constrainer: *
      └─ Convolution "Room"
```
