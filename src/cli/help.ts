import type { CommandEntry } from "../engine/commands/registry.js";

export function renderCliHelp(_commands: CommandEntry[], scope?: string): string {
	if (scope) {
		const section = SCOPED_HELP[scope];
		if (section) return section;
		return `Unknown help topic: "${scope}". Available: ${Object.keys(SCOPED_HELP).join(", ")}`;
	}
	return GLOBAL_HELP;
}

// ── Global help (overview only) ─────────────────────────────────────

const GLOBAL_HELP = `hise-cli — automation frontend for HISE audio plugin framework

USAGE
  hise-cli                                  Open the interactive TUI
  hise-cli repl [--mock] [--no-animation]   Open TUI with options
  hise-cli -<mode> "<command>"              One-shot mode command (JSON output)
  hise-cli wizard <subcommand>              Wizard operations (JSON output)
  hise-cli --help                           Show this help
  hise-cli -<mode> --help                   Show mode-specific help

OUTPUT FORMAT
  All one-shot commands emit JSON to stdout:
    { "ok": true|false, "result": ..., "logs": [...], "errors": [...] }
  Exit code: 0 on success, 1 on error.

MODES
  -builder "<command>"     Module tree editor       (--help for syntax)
  -ui "<command>"          UI component editor      (--help for syntax)
  -script "<expression>"   HiseScript REPL          (--help for syntax)
  -inspect "<command>"     Runtime monitor           (--help for syntax)
  -undo "<command>"        Undo history & plan groups (--help for syntax)

  wizard <subcommand>      Guided workflows          (--help for syntax)

OPTIONS
  --help             Show this help (or mode help with -<mode> --help)
  --mock             Use mock HISE connection (for testing without HISE)
  --target:<path>    Set context path for mode commands

HISE CONNECTION
  Connects to HISE at http://127.0.0.1:1900 (REST API must be enabled).
  Use --mock to test without a running HISE instance.

ENVIRONMENT VARIABLES
  HISE_RENDERER=ink|rezi   Force a specific TUI renderer
  FORCE_COLOR=0|1|2|3      Override terminal color detection
  NO_COLOR=1               Disable all color output`;

// ── Per-mode scoped help ────────────────────────────────────────────

const SCOPED_HELP: Record<string, string> = {
	builder: `hise-cli -builder — module tree editor

SYNTAX
  hise-cli -builder "<command>"
  hise-cli -builder --target:<path> "<command>"

MODULE TREE CONCEPTS
  HISE organises audio processing as a tree of modules. Every project has
  a root SoundGenerator (typically "Master Chain") with child modules
  nested inside typed slots called chains:

    children   Sound generators and containers (the main signal path)
    fx         Effect processors (filters, reverbs, delays)
    midi       MIDI processors (arpeggiators, scripts, transposes)
    gain       Gain modulators (LFOs, envelopes on volume)
    pitch      Pitch modulators (vibrato, glide)

  Each module type can only be added to a compatible chain. The builder
  validates this locally using constrainer rules from the module database.
  Use "show types" to discover available types and "show tree" to see
  the current hierarchy.

  A fresh project typically has: Master Chain (SynthGroup) → children
  contains one or more sound generators, each with their own fx/midi/gain
  chains.

COMMANDS
  add <type> [as "<name>"] [to <parent>[.<chain>]]
    Add a module. <type> is a module type name (tab-completable).
    Without "to", adds to the current context (cd target or root).
    Chain is auto-resolved from the module category:
      SoundGenerator types  → parent.children
      Effect types          → parent.fx
      MidiProcessor types   → parent.midi
      Modulator types       → requires explicit .chain (e.g. .gain, .pitch)
    Modules are appended to the end of the chain. Reordering is not
    supported — remove and re-add to change position.
    Name collisions are auto-suffixed (e.g. "LFO", "LFO2", "LFO3").
    Without "to" and no cd context, adds to the root container.
    All add/remove/set/clone operations are undoable (see -undo --help).

  remove <target>
    Remove a module and all its children from the tree.

  clone <target> [x<count>]
    Duplicate a module (with all children and parameters).
    x<count> creates multiple copies: clone LFO x3

  rename <target> to "<name>"
    Change a module's display name.

  set <target>.<param> [to] <value>
    Set a parameter. <target> is the module instance name (unique
    across the tree — no path needed, just the ID).
    <param> is the parameter name (both tab-completable).
    "to" is optional: "set Master.Volume -6" works.

  bypass <target> / enable <target>
    Toggle a module's bypass state.

  load "<source>" into <target>
    Load a preset, sample map, or other data file into a module.
    <source> is a quoted file path or resource identifier.

  show tree
    Print the full module tree with types, IDs, and chain structure.

  show types [<filter>]
    List all available module types. Optional filter matches by prefix
    (e.g. "show types Envelope" shows all envelope types).

  show <target>
    Show a module's parameters with current values and ranges.

  reset
    Wipe the entire module tree and clear undo history.
    This is irreversible — use with caution.

  cd <path> / ls / pwd
    Navigate the tree. "cd Master Chain" sets context so subsequent
    commands target that module. "ls" lists children. "pwd" shows
    the current path. Use "/exit" to return to root.

COMMA CHAINING
  Multiple commands in one call, separated by commas:
    add LFO to Master.gain, set LFO.Frequency to 2.0
  Target inheritance: "set Master.Volume to -6, Pan to 10" reuses Master.

CONTEXT TARGET
  --target sets an implicit parent without entering the mode:
    hise-cli -builder --target:Master "add LFO to gain"

NAMING
  add SimpleGain as "MyGain" to Master Chain
  Without "as", the module gets the type ID as its instance name.

MOCK MODE
  --mock simulates a full module tree (SynthGroup with 23 modules).
  add/remove/set/clone modify the simulated tree and return diffs.
  Use "show tree" with --mock to see the simulated hierarchy.

UNDO
  All tree mutations (add, remove, set, clone, rename, bypass) are
  undoable via the undo mode. See: hise-cli -undo --help
  Plan groups batch multiple operations into a single undo step.

RESPONSE FORMAT
  Successful mutations return a diff summary: { ok: true, result: "+ModuleId" }
  for add, "-ModuleId" for remove, "*ModuleId.Param" for set.
  Use "show tree" or "show <target>" after mutations to inspect the result.

ERROR HANDLING
  Invalid type names, nonexistent targets, and chain constraint violations
  return JSON with ok:false and an error message.
  If HISE is not running (and --mock is not set), returns a connection error.

MODULE TYPE IDS
  The add command uses type IDs as returned by "show types". IDs are
  single tokens (e.g. SimpleGain, AHDSR, LFO, SineSynth).
  "show types" returns columns: Module (ID), Type (category), Subtype,
  Category (tags). The Type column tells you the chain mapping:
    SoundGenerator → children, Effect → fx, MidiProcessor → midi,
    Modulator → explicit chain required.

  Common types (partial — run "show types" for the full list):
  SoundGenerators: SineSynth, WaveSynth, Noise, StreamingSampler,
    SynthGroup, GlobalModulatorContainer, SilentSynth
  Effects: SimpleGain, SimpleReverb, HardcodedMasterFX, PolyphonicFilter,
    Convolution, StereoFX, Dynamics, Saturator, Delay, ShapeFX
  MidiProcessors: ScriptProcessor, Transposer, Arpeggiator, MidiPlayer
  Modulators: LFO, AHDSR, Velocity, TableEnvelope, Constant, Random,
    SimpleEnvelope, MidiController, KeyNumber

CHAIN TYPES (exhaustive list)
  children   Main signal path (sound generators, containers)
  fx         Effect processors
  midi       MIDI processors
  gain       Gain/volume modulators
  pitch      Pitch modulators
  These are the only chain types. No custom chains exist.

RECOMMENDED WORKFLOW (complex module trees)
  Use undo plan groups to batch operations into a single undoable unit:
    1. hise-cli -undo 'plan "Add synth layer"'
    2. hise-cli -builder "add SineSynth as \"Lead\" to Master Chain"
    3. hise-cli -builder "add SimpleGain to Lead"
    4. hise-cli -builder "add AHDSR to Lead.gain"
    5. hise-cli -builder "set Lead.Volume to -6"
    6. hise-cli -builder "show tree"
    7. hise-cli -undo "apply"            (or "discard" to rollback all)

  This ensures the entire module group is added or reverted atomically.
  Always verify with "show tree" before applying.

EXAMPLES
  hise-cli -builder "show tree"
  hise-cli -builder "show types"
  hise-cli -builder "show types Envelope"
  hise-cli -builder "add SimpleGain as \"MyGain\" to Master Chain"
  hise-cli -builder "add AHDSR to MyGain.gain"
  hise-cli -builder "set Master Chain.Volume to -6"
  hise-cli -builder "clone MyGain x2"
  hise-cli -builder "remove MyGain"
  hise-cli -builder "show Master Chain"
  hise-cli -builder --target:Master "add LFO to gain, set LFO.Frequency to 4.0"
  hise-cli -builder "reset"`,

	script: `hise-cli -script — HiseScript REPL

SYNTAX
  hise-cli -script "<expression>"

Evaluates any HiseScript expression against the running HISE instance.
Output includes return value, type, console logs, and errors.

COMPLETION (TUI)
  Tab completes API namespaces and methods:
  Engine., Synth., Console., Content., Math., Array., String.

EXAMPLES
  hise-cli -script "Engine.getSampleRate()"
  hise-cli -script "Console.print(123)"
  hise-cli -script "Synth.addNoteOn(1, 64, 127, 0)"
  hise-cli -script "Content.getComponent('Knob1').getValue()"`,

	inspect: `hise-cli -inspect — runtime monitor

SYNTAX
  hise-cli -inspect "<command>"

COMMANDS
  version    HISE server version and compile timeout
  project    Current project paths and script processors

EXAMPLES
  hise-cli -inspect "version"
  hise-cli -inspect "project"`,

	ui: `hise-cli -ui — UI component editor

SYNTAX
  hise-cli -ui "<command>"
  hise-cli -ui --target:<component> "<command>"

COMMANDS
  add <type> ["name"] [at x y w h]    Add a component
  remove <target>                      Remove a component
  set <target>.<prop> [to] <value>     Set a property
  move <target> to <parent> [at N]      Reparent a component (N = z-order index)
  rename <target> to "<name>"          Rename a component
  show <target>                        Show all properties

COMPONENT TYPES
  ScriptButton, ScriptSlider, ScriptPanel, ScriptComboBox, ScriptLabel,
  ScriptImage, ScriptTable, ScriptSliderPack, ScriptAudioWaveform,
  ScriptFloatingTile, ScriptDynamicContainer, ScriptedViewport,
  ScriptMultipageDialog, ScriptWebView

COMMA CHAINING
  Multiple commands in one call, separated by commas.
  Verb inheritance: add ScriptButton "A", ScriptSlider "B"
  Set target inheritance: set Knob.x 100, y 200, width 128

EXAMPLES
  hise-cli -ui "add ScriptButton \\"PlayButton\\" at 100 200 128 32"
  hise-cli -ui "set PlayButton.visible false"
  hise-cli -ui "move PlayButton to MainPanel"
  hise-cli -ui "move PlayButton to MainPanel at 0"
  hise-cli -ui "rename PlayButton to \\"StartButton\\""
  hise-cli -ui "add ScriptPanel \\"Header\\", add ScriptButton \\"Logo\\" at 10 5 40 40"
  hise-cli -ui --target:MainPanel "add ScriptSlider \\"VolumeKnob\\" at 20 40 128 48"
  hise-cli -ui "show PlayButton"`,

	undo: `hise-cli -undo — undo history and plan groups

SYNTAX
  hise-cli -undo "<command>"

COMMANDS
  back             Undo last action
  forward          Redo last undone action
  clear            Clear undo history
  plan "<name>"    Start a named plan group (batches operations)
  apply            Apply the current plan group
  discard          Discard the current plan group
  diff             Show diff of current plan group
  history          Show undo history

Plan groups batch multiple builder operations into a single undoable unit.

EXAMPLES
  hise-cli -undo "back"
  hise-cli -undo "history"
  hise-cli -undo 'plan "My Refactor"'`,

	wizard: `hise-cli wizard — guided multi-step workflows

SYNTAX
  hise-cli wizard list                            List available wizards
  hise-cli wizard <id> --schema                   Show field schema (JSON)
  hise-cli wizard <id> --answers '{"k":"v"}'      Execute with answers

AVAILABLE WIZARDS
  setup                Install and build HISE from source
  new_project          Create a new HISE project folder
  plugin_export        Compile project as VST/AU/AAX or standalone
  compile_networks     Compile scriptnode C++ networks into DLL
  recompile            Recompile scripts and clear caches
  audio_export         Render audio output to WAV file
  install_package_maker  Create installer payload for distribution

WORKFLOW
  1. Call --schema to get field definitions and types
  2. Build an answers JSON object with field IDs as keys
  3. Call --answers to execute the wizard

EXAMPLES
  hise-cli wizard list
  hise-cli wizard new_project --schema
  hise-cli wizard new_project --answers '{"ProjectName":"MyPlugin","DefaultProjectFolder":"/path","Template":"0"}'
  hise-cli wizard recompile --answers '{"clearGlobals":"1","clearFonts":"0","clearAudioFiles":"0","clearImages":"0"}'`,
};
