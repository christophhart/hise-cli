# DESIGN.md - hise-cli REPL Architecture v2

> Comprehensive design document for the hise-cli modal REPL system.
> Covers architecture, mode grammars, protocol specification, and design rationale.
>
> Implementation tracked in [Milestone: REPL Architecture v2](https://github.com/christoph-hart/hise-cli/milestone/1)

---

## Vision

hise-cli is a modal REPL and command-line interface for
[HISE](https://hise.dev), an open-source framework for building audio
plugins. It serves two audiences through two frontends sharing one engine:

- **Humans** use the TUI (terminal UI) - an interactive Ink/React app with
  colored output, progress bars, tab completion, and keyboard navigation.
- **LLMs and automation tools** use the CLI - non-interactive, argument-based
  invocation with structured JSON output.

The app is a **smart client**: it parses commands, renders output, provides
tab completion, and performs type-level validation locally using shipped JSON
datasets (`moduleList.json`, `scripting_api.json`). HISE handles execution,
instance-level validation, and runtime state. The CLI never replicates
HISE's execution logic, but it can catch type errors, invalid parameter
names, out-of-range values, and wrong chain/module combinations instantly
without a round-trip to HISE.

---

## Architecture

### Three-Layer Design

```
src/
  engine/          Shared core - zero UI dependencies
    commands/      Command registry, dispatcher, parsers
    modes/         Mode definitions (builder, script, dsp, sampler, ...)
    completion/    Tab completion engine
    plan/          Plan mode state + script generation
    validation/    Local type-level validation (moduleList.json)
    wizard/        Wizard framework
      definitions/ Wizard definitions (setup, broadcaster, export, ...)
      phases/      Shared pipeline phases (compile, verify, git-ops, ...)
      types.ts     WizardDefinition, WizardStep, etc.
      runner.ts    WizardRunner (TUI step-by-step)
      executor.ts  WizardExecutor (CLI single-shot)
      pipeline.ts  PipelineExecutor (phase sequencing, abort, retry)
      registry.ts  WizardRegistry
    result.ts      CommandResult types
    session.ts     Mode stack, history, session state
    hise.ts        HiseConnection interface + HTTP implementation
    data/          Static JSON datasets (module types, API methods, nodes)

  tui/             TUI frontend - Ink/React
    app.tsx        Main TUI app
    components/    Output, Input (with completion popup), Progress, Header
    hooks/         React hooks wrapping engine

  cli/             CLI frontend - pure Node.js
    index.ts       Argument parsing, dispatch, JSON output
```

The engine has **no dependency** on Ink, React, or any terminal UI library.

### Data Flow

```
                    +-------------------------------+
  TUI (human)       |         Command Engine        |       HISE
  -------------     |                               |     ---------
  Ink/React    ---> |  parse --> validate --> send   | --> HTTP REST API
  keyboard input    |  (local)   (local+HISE)       |     localhost:1900
  colored output <--|  format <-- result <-- recv    | <-- JSON responses
                    |                               |
  CLI (LLM)         |  Modes, completion, plan,     |     SSE endpoint
  -------------     |  module tree tracking         |     (push events)
  args + flags ---> |                               |
  JSON output  <--  +-------------------------------+
```

### Smart Client Responsibility Split

| Concern                           | Owner     | How                                              |
|-----------------------------------|-----------|--------------------------------------------------|
| Parsing commands                  | CLI       | Mode-specific grammar parsers                    |
| Tab completion                    | CLI       | Static JSON datasets shipped with the app        |
| Type-level validation             | CLI       | `moduleList.json` - type exists, chain accepts type, parameter name valid, value in range |
| Instance-level validation         | CLI+HISE  | CLI tracks module tree after initial fetch from `GET /api/builder/tree`; HISE confirms on execution |
| Module tree tracking              | CLI+HISE  | Fetched once on builder mode entry, updated locally as commands execute |
| Plan step reference tracking      | CLI       | Simple string bookkeeping (not tree logic)        |
| Generating HiseScript             | CLI       | Template-based, using `builderPath` from JSON     |
| Executing operations              | HISE      | Builder, DspNetwork, Sampler APIs                |
| Dynamic module parameters         | HISE      | 12 modules with runtime-defined params (ScriptProcessor, HardcodedSynth, etc.) |
| Live monitoring                   | HISE      | SSE push events for progress, console, metrics   |

---

## Communication with HISE

### Transport: HTTP REST API + Server-Sent Events

The CLI communicates with HISE via its existing **HTTP REST API** on
`localhost:1900`, powered by cpp-httplib (vendored header-only library).
This API is already used by the HISE MCP server and provides a
self-documenting discovery endpoint at `GET /`.

**Request/response** uses standard HTTP: `GET` for reads, `POST` for
mutations, JSON bodies, `{success, result, logs, errors}` response format.

**Push events** use a **Server-Sent Events** (SSE) endpoint at
`GET /api/events`. This provides streaming data for long-running operations
(monolith compression progress, compile status, render progress) and live
monitoring (CPU, MIDI activity). The SSE connection is **modal** - while
streaming, other requests are blocked, which is correct behavior since these
operations are inherently exclusive.

cpp-httplib already supports SSE natively via
`Response::set_chunked_content_provider()` with `text/event-stream` content
type. The HISE `RestServer` wrapper needs a streaming route handler path
alongside its existing one-shot response path.

**Multiple simultaneous clients** (e.g., MCP server + CLI) are supported
naturally by HTTP. Each request is independent. The SSE endpoint serves one
client at a time (modal).

### Named Pipe: Retired

The original REPL used JUCE `NamedPipe` for communication. This has been
retired in favor of HTTP. The C++ REPL server code (`ReplServer.h/.cpp`) is
removed by reverting commit `28267c18a877fcf848f496b24b663941d183b240`.
The Node.js pipe client (`pipe.ts`, `usePipe.ts`) is removed from hise-cli.

Rationale: The REST API already exists and is battle-tested, HTTP gives free
request-response correlation and standard tooling, SSE covers push use cases,
and HTTP naturally supports multiple simultaneous clients.

### Transport Abstraction

The engine layer talks to HISE through a `HiseConnection` interface:

```ts
interface HiseConnection {
  request(endpoint: string, params?: object): Promise<HiseResponse>;
  destroy(): void;
}
```

The default (and only) implementation is `HttpHiseConnection` using `fetch()`.

### Existing Endpoints Used by TUI

| CLI mode      | Existing endpoint               | Use case                   |
|---------------|---------------------------------|----------------------------|
| Script mode   | `POST /api/repl`                | Evaluate HiseScript expression |
| Script mode   | `POST /api/recompile`           | Recompile after file edits |
| Inspect mode  | `GET /api/status`               | Project + processor info   |
| Inspect mode  | `GET /api/list_components`      | Component tree             |
| Inspect mode  | `GET /api/screenshot`           | Visual verification        |
| Inspect mode  | `POST /api/profile`             | Performance profiling      |
| Project mode  | `GET /api/status`               | Project info               |
| Project mode  | `POST /api/parse_css`           | CSS diagnostics            |
| Any mode      | `POST /api/shutdown`            | Quit HISE                  |

Note: The TUI does **not** use `POST /api/set_script` or
`GET /api/get_script`. Script mode evaluates expressions via `/api/repl`.
External file edits are handled by the user's editor, then `/api/recompile`
is called to apply changes. The `set_script`/`get_script` endpoints are for
the MCP server / AI agent workflow (programmatic script editing).

### New Endpoints

New endpoints follow the same conventions as the existing API.
Categories: `builder`, `sampler`, `dsp`, `workspace`, `inspect`, `compile`,
`project`, `settings`, `packages`, `tools`, `meta`.

The `validate` flag on builder and dsp endpoints enables dry-run validation
through the same code path (same pattern as `compile: false` on `set_script`).

Full endpoint specification: [REST_API_ENHANCEMENT.md](REST_API_ENHANCEMENT.md)
and [Issue #12](https://github.com/christoph-hart/hise-cli/issues/12)

### REST API Spec Drift

The spec at `guidelines/api/rest-api.md` has drifted from the implementation.
Key discrepancies (the implementation is the source of truth):

| Endpoint | Spec says | Code actually does |
|----------|-----------|--------------------|
| `GET /api/get_script` | Returns `{script, callback}` strings | Returns `{callbacks: {name: code}}` object |
| `POST /api/set_script` | Accepts `{script, callback}` | Accepts `{callbacks: {name: code}}` |
| `POST /api/recompile` | No `profile` param | Has `profile` + `durationMs` params |
| `GET /api/list_components` | No `laf` field | Includes `laf` info per component |

Five undocumented endpoints exist in code: `/api/repl`, `/api/profile`,
`/api/simulate_interactions`, `/api/parse_css`, `/api/shutdown`.

The CLI is coded against the **actual implementation**, not the spec doc.

---

## Modal REPL

### Why Modes

A flat subcommand tree (`hise builder add ...`, `hise sampler select ...`)
works for single CLI invocations but is verbose for interactive use. Modes
let the user enter a domain context where the grammar simplifies:

```
> /builder
[builder] > add AHDSR to Sampler1.gain    # no "builder" prefix needed
[builder] > show tree
[builder] > /exit
>
```

Each mode defines its own parser, so the input language adapts to the domain.
The builder uses natural-language verbs (`add X to Y`). The script mode passes
everything as HiseScript. The sampler mode has selection-based workflows.

### Entering Modes

| Command                    | Effect                                            |
|----------------------------|---------------------------------------------------|
| `/builder`                 | Enter builder mode (module tree)                  |
| `/script [processor]`      | Enter script mode (defaults to Interface)         |
| `/workspace <module>`      | Switch HISE workspace + enter contextual mode     |
| `/compile`                 | Enter compile mode                                |
| `/project`                 | Enter project mode                                |
| `/import`                  | Enter import mode                                 |
| `/inspect`                 | Enter inspect mode                                |

`/workspace` is the **primary navigation command** - it tells HISE to switch
its IDE view to the appropriate workspace (Scripting, Sampler, or Scriptnode)
and puts the CLI into the matching mode. The mode is inferred from the module
type:

| Module type                          | HISE workspace | CLI mode             |
|--------------------------------------|---------------|----------------------|
| ScriptProcessor                      | Scripting     | `[script:Name]`      |
| StreamingSampler                     | Sampler       | `[sampler:Name]`     |
| HardcodedSynth / ScriptFX with DSP  | Scriptnode    | `[dsp:NetworkName]`  |

DSP mode is **only** reachable via `/workspace` - there is no `/dsp` command
because a network context is always required.

### Slash Commands

Slash commands are always available in every mode. They are never forwarded to
HISE, never recorded in plan mode.

| Command              | Action                                              |
|----------------------|-----------------------------------------------------|
| `/help [topic]`      | Context-sensitive help                              |
| `/exit`              | Leave current mode (pop one level)                  |
| `/modes`             | Open command palette (same as Ctrl+Space)           |
| `/builder`           | Enter builder mode                                  |
| `/script [proc]`     | Enter script mode                                   |
| `/workspace <mod>`   | Switch HISE workspace + enter mode                  |
| `/compile`           | Enter compile mode                                  |
| `/project`           | Enter project mode                                  |
| `/import`            | Enter import mode                                   |
| `/inspect`           | Enter inspect mode                                  |
| `/wizard [id]`       | Open wizard (or list available wizards)              |
| `/clear`             | Clear output                                        |
| `/history`           | Show command history                                |
| `/export [path]`     | Export plan as HiseScript (in plan submode)          |

### Input Routing

```
Input starts with "/"  -->  Slash command dispatcher
Anything else          -->  Current mode's parser
```

### Mode Stack

Modes can nest (builder -> builder:plan). `/exit` pops one level. Ctrl+C
always exits entirely.

### Command Palette (Ctrl+Space)

A filterable overlay showing all available modes and commands. Arrow keys to
navigate, Enter to execute, Escape to dismiss, type to filter. Equivalent
slash command: `/modes`.

---

## Mode Grammars

### Builder Mode

Wraps the HISE Builder scripting API for constructing the module tree.

```
# Adding
add <type> [as "<name>"] [to <parent>.<chain>]

  add StreamingSampler as "Sampler 1"
  add AHDSR to Sampler1.gain
  add LFO as "LFO2" to Sine.pitch

# Cloning (hybrid syntax)
clone <source> x<count> [as "<template {n}>"]
clone <source> as "<template {start..end}>"

  clone Sampler1 x4
  clone Sampler1 x4 as "Sampler {n}"
  clone Sampler1 as "Sampler {2..10}"

# Removing
remove <name>
clear
clear <target>.<chain>

# Moving
move <name> to <parent>.<chain> [at <index>]

# Parameters
set <target> <param> [to] <value> [<param2> [to] <value2> ...]

# Scripting
connect <target> to script "<path>"

# Inspection
show tree | show <target> | show types [synth|mod|fx|midi]

# Selection context
select <target>

# Bypass
bypass <name> | enable <name>

# Session
flush
```

**Dot notation**: `Sampler1.gain` means the gain chain of Sampler1. Chains:
`direct`, `gain`, `pitch`, `fx`, `midi`.

**Clone range inference**: No trailing-number guessing. Count (`x4`) or
brace expansion (`{2..10}`) is always explicit. `{n}` is a 1-indexed template
placeholder.

#### Builder Mode Validation

The builder mode uses a **hybrid validation model**:

**Local validation** (instant, no HISE round-trip):
- Module type exists (79 types in `moduleList.json`)
- Module subtype can go in the target chain (constrainer matching)
- Parameter name is valid for the module type
- Parameter value is in range (min/max/stepSize)
- ComboBox values match the `items` list
- Parent module has the specified chain type
- Builder API path lookup (`builderPath` field)

**Instance validation** (needs live module tree):
- Module instance name exists (tracked locally after initial fetch)
- Module instance name uniqueness
- Dynamic module parameters (12 modules with `metadataType: "dynamic"`)

On entering builder mode, the CLI calls `GET /api/builder/tree` once to
get the current module tree. From then on, it tracks the tree locally as
commands are executed, allowing instance-level validation without further
round-trips. The tree can be re-synced if the user edits in the HISE IDE.

#### Module Data (`moduleList.json`)

79 modules with rich metadata:

| Field | Purpose |
|-------|---------|
| `id` | Short type name used in commands (e.g., `"AHDSR"`) |
| `type` / `subtype` | Classification: `SoundGenerator`, `Effect`, `MidiProcessor`, `Modulator` with subtypes like `EnvelopeModulator`, `MasterEffect`, `VoiceStartModulator` |
| `builderPath` | Builder API constant (e.g., `"b.Modulators.AHDSR"`) |
| `hasChildren` | Can contain child SoundGenerators |
| `hasFX` / `fx_constrainer` | Has FX chain + which effect subtypes are allowed |
| `parameters[]` | Full parameter definitions with `range`, `type`, `items`, `mode`, `unit` |
| `modulation[]` | Modulation chain definitions with `chainIndex`, `constrainer`, `modulationMode` |

Standard chain mapping for SoundGenerators:
`midi`=0, `gain`=1, `pitch`=2, `fx`=3 (implicit from structure).

Constrainer syntax: `"*"` (any), `"VoiceStartModulator"` (exact subtype),
`"MasterEffect|!RouteEffect|!SlotFX"` (subtype + exclusion list).

### Plan Submode

Enter with `plan` from builder mode. Commands are validated locally first
(type-level), then by HISE (via the `validate` flag on the API) and recorded.
Strict validation: invalid commands are rejected immediately.

```
[builder] > plan
[builder:plan] > add StreamingSampler as "Sampler 1"
  ok [1] add StreamingSampler as "Sampler 1"
[builder:plan] > /execute          # run the plan
[builder:plan] > /export plan.js   # generate HiseScript
[builder:plan] > /show             # display the plan
[builder:plan] > /remove 2         # edit the plan
[builder:plan] > /discard          # discard and return to live mode
```

**HISE-side validation**: each command is sent through the same API with
`validate: true`. HISE maintains a stateful plan session (virtual tree) so
step N+1 can reference modules from step N.

**CLI-side reference tracking**: the CLI tracks which plan steps introduce
which names (simple string bookkeeping). When a step is removed, dependent
steps are flagged - no HISE roundtrip needed for that.

**CLI-side script generation**: the CLI generates HiseScript from validated
plan steps using the `builderPath` field from `moduleList.json` to map short
type names to full builder constants (`SimpleGain` -> `b.Effects.SimpleGain`).
Clone steps emit for-loops.

### DSP (Scriptnode) Mode

Entered via `/workspace` targeting a module with a DspNetwork. Wraps the
DspNetwork and Node scripting APIs.

```
add <factory.node> [as "<name>"] to <parent>
remove <name>
move <name> to <parent> [at <index>]
connect <source>[.<output>] to <target>.<parameter>
disconnect <source> from <target>.<parameter>
set <node> <property> [to] <value>
bypass <node> | enable <node>
show graph | show <node> | show factories | show <factory>
undo | clear
```

12 node factories, 194 nodes (see `data/scriptnodeList.json`): container,
core, math, envelope, routing, analyse, fx, control, dynamics, filters,
jdsp, template.

### Script Mode

HiseScript REPL. Defaults to Interface processor. Everything typed is sent
to HISE's expression evaluator via `POST /api/repl`.

```
[script:Interface] > Engine.getSampleRate()
44100.0
[script:Interface] > Console.print("hello")
hello
```

- **Multi-line**: unclosed brackets continue on next line
- **Last result**: `_` stores the last evaluated result
- **`/api Namespace.method`**: inline API reference from static data

Uses `POST /api/repl` (not `set_script`). For external file edits, the user
edits in their editor and calls `/recompile` from the TUI.

### Sampler Mode

Entered via `/workspace` targeting a StreamingSampler. Selection-based
workflow that syncs with the HISE sample map editor UI.

```
# Sample maps
maps | load <map> | save [<name>] | clear | info

# Import
import <path|glob> | automap <path|glob> | import sfz <path>

# Selection (syncs to HISE UI)
select all | select "<regex>" | select where <prop> <op> <value>
select add "<regex>" | select subtract "<regex>"

# Editing (on selection)
set <property> [to] <value> | set <property> [to] <value> for all

# Operations
show | show all | count | duplicate | delete | replace <sample> with <path>

# Batch
monolith [<map>] | monolith all | validate

# Mic positions
mics | purge <name> | unpurge <name>
```

#### Complex Group Management (first-class)

The complex group manager replaces the simple RR group axis with a 64-bit
bitmask supporting arbitrary organizational layers (RR, crossfade, keyswitch,
legato, custom).

```
# Layer management
groups                                    # show all layers
groups add <type> <name> [--bits N] [--cached] [--ignore]
groups remove <name>

  Layer types: rr, xfade, keyswitch, legato, custom

# Assigning samples to groups
assign <layer> <group>                    # for selected samples
assign <layer> ignore                     # set ignore flag

# Filtering (controls playback)
filter <layer> <group>
filter <layer> off

# Per-group audio
volume <layer> <group> <dB>
delay <layer> <group> <samples>
fadein <layer> <group> <ms> [<dB>]
fadeout <layer> <group> <ms>
```

### Inspect Mode

Runtime introspection. One-shot snapshots + SSE subscriptions for live
monitoring.

```
cpu | memory | voices | modules | <name> | connections | routing | midi
latency
```

Live monitoring (cpu, midi) uses `GET /api/events` (SSE). While a live
monitoring session is active, the SSE connection is modal - no other requests
are processed. This is acceptable because monitoring is an explicit user
action.

### Project Mode

Project inspection, settings, and **package management** (HISE Asset Manager).

```
# Assets
info | samples | scripts | images | networks | presets
settings [<key>] [<value>] | validate

# Packages
packages | packages available | packages search <query> | packages outdated
install <pkg> [<version>] | update <pkg> | update all
uninstall <pkg> | cleanup <pkg>
versions <pkg> | revert <pkg> to <version>
packages add local <path> | packages remove local <path>
packages init | packages test
```

### Compile Mode

```
vst3|au|standalone|aax [debug|release] | dsp-dll | all [debug|release]
status | cancel | log | clean
export samples | export resources
```

### Import Mode

```
samples|images <path|glob> | filmstrip <path> [--frames N]
impulse|midi|sfz|presets <path>
monolith <map> | wavetable <path>
```

---

## Static Data

Three JSON datasets ship with the CLI in `data/` and serve triple duty: tab
completion, local validation, and inline help.

### `data/moduleList.json` (provided)

79 modules, 15 categories. Covers all HISE module types with:
- Type metadata (`id`, `type`, `subtype`, `builderPath`, `category`)
- Structure (`hasChildren`, `hasFX`, `fx_constrainer`, `constrainer`)
- Parameters with full range/type/items data
- Modulation chains with constrainer and mode info

See "Builder Mode Validation" section for details.

### `data/scriptnodeList.json` (provided)

194 nodes, 12 factories (`container`, `control`, `core`, `math`, `envelope`,
`routing`, `analyse`, `fx`, `dynamics`, `filters`, `jdsp`, `template`).
Same structure as `moduleList.json`:
- Node metadata (`id`, `description`, `type` polyphonic/monophonic)
- Structure (`hasChildren`, `hasFX`, `fx_constrainer`, `constrainer`)
- Parameters with full range/type/items data (79 ComboBox params decoded)
- Modulation outputs with constrainer type (`Normalised`/`Unnormalised`)
- Properties (`Mode`, `Connection`, `Code`, `NumParameters`, `LocalId`, etc.)
- Interfaces (`TableProcessor`, `SliderPackProcessor`, `AudioSampleProcessor`,
  `DisplayBufferSource`)

### `data/scripting_api.json` (provided, 26% enriched)

89 classes, 1,789 methods. Covers the full HiseScript API:
- Base data on all classes: `name`, `description`, `category`, `methods[]`
- Each method: `name`, `returnType`, `description`, `parameters[]` (name+type)
- Enriched classes (23/89) add: `commonMistakes`, `llmRef`, `obtainedVia`,
  and per-method `callScope`, `crossReferences`, `pitfalls`, `examples`

Key classes per mode:

| CLI Mode  | Key classes |
|-----------|-------------|
| Builder   | `Builder` (8), `Synth` (59) |
| Script    | All 89 - this is the REPL |
| Sampler   | `Sampler` (57), `Sample` (11), `ComplexGroupManager` (16) |
| DSP       | `DspNetwork` (12), `Node` (15), `Connection` (6), `Parameter` (8) |
| Inspect   | `Engine` (147) |
| Project   | `Settings` (36), `ExpansionHandler` (18) |

### Future datasets (not yet provided)

| Dataset | Purpose |
|---------|---------|
| Sample property indexes | Sampler mode select/set |

These can be fetched at runtime from `GET /api/meta/*` endpoints or provided
as additional JSON files.

---

## Wizard Framework

Wizards are declarative multi-step guided workflows for complex operations that
require multiple coordinated inputs — broadcaster configuration, asset payload
creation, monolith encoding, project scaffolding, etc. HISE already has C++
multipage dialogs for many of these tasks; the wizard framework provides a
better UX in the TUI and a structured single-shot interface for the CLI.

### Dual Interface — Same Definition

A wizard definition lives in the engine layer and serves both frontends:

| Aspect           | TUI (human)                          | CLI (LLM / automation)                |
|------------------|--------------------------------------|---------------------------------------|
| Invocation       | `/wizard broadcaster`                | `hise-cli wizard broadcaster --answers '{...}'` |
| Interaction      | Step-by-step overlay, one page at a time | Single-shot: all answers supplied upfront |
| Validation       | Per-step, inline error display       | All-at-once, returns error array      |
| Dynamic data     | Resolved lazily per step             | Resolved during validation            |
| Output           | Preview → accept/copy/reject         | JSON result with generated content    |
| Schema discovery | The wizard guides you                | `--schema` dumps definition as JSON   |

This is a key architectural benefit: complex multi-parameter operations (like
monolith encoding with sample map selection, format options, and target paths)
get a single unified interface rather than requiring the LLM to know the raw
REST API endpoints, their parameter formats, and their sequencing.

### Engine Types (`src/engine/wizard/`)

```ts
interface WizardDefinition {
  id: string;                    // e.g. "broadcaster"
  name: string;                  // "Broadcaster Wizard"
  description: string;
  modes: string[];               // which modes can invoke this (empty = global only)
  standalone?: boolean;          // runs without REPL session or HISE connection
  steps: WizardStep[];
  output: WizardOutput;
}

type WizardStep =
  | SelectStep
  | MultiSelectStep
  | TextStep
  | ToggleStep
  | FormStep
  | RepeatGroup
  | PreviewStep
  | PipelineStep;

// --- Step types ---

interface SelectStep {
  type: "select";
  id: string;
  title: string;
  description?: string;
  options?: SelectOption[];           // static options
  resolve?: ResolverFn;              // or dynamic options from HISE
  showIf?: (answers: Answers) => boolean;
}

interface MultiSelectStep {
  type: "multi-select";
  id: string;
  title: string;
  description?: string;
  options?: SelectOption[];
  resolve?: ResolverFn;
  showIf?: (answers: Answers) => boolean;
}

interface TextStep {
  type: "text";
  id: string;
  title: string;
  description?: string;
  placeholder?: string;
  validate?: (value: string) => string | null;  // sync format check
  validateAsync?: ValidateAsyncFn;              // async instance-level check
  showIf?: (answers: Answers) => boolean;
}

interface ToggleStep {
  type: "toggle";
  id: string;
  title: string;
  description?: string;
  default?: boolean;
  showIf?: (answers: Answers) => boolean;
}

interface FormStep {
  type: "form";
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  validateAsync?: ValidateAsyncFn;              // step-level async validation
  showIf?: (answers: Answers) => boolean;
}

interface RepeatGroup {
  type: "repeat";
  id: string;
  title: string;
  addLabel?: string;                  // "Add another listener?"
  maxCount?: number;
  steps: WizardStep[];                // nested steps to repeat
  showIf?: (answers: Answers) => boolean;
}

interface PreviewStep {
  type: "preview";
  id: string;
  title: string;
  generate: (answers: Answers) => PreviewResult;
}

interface PipelineStep {
  type: "pipeline";
  id: string;
  title: string;
  phases: PipelinePhase[];
  showIf?: (answers: Answers) => boolean;
}

interface PipelinePhase {
  id: string;
  name: string;
  shouldSkip?: (answers: Answers) => boolean;
  execute: (answers: Answers, callbacks: PipelineCallbacks) => Promise<PhaseResult>;
}

interface PipelineCallbacks {
  onLog: (line: string) => void;
  onProgress: (fraction: number) => void;
  signal: AbortSignal;
}

interface PhaseResult {
  success: boolean;
  error?: string;
  duration: number;
}

// --- Supporting types ---

interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

type FormField = {
  id: string;
  label: string;
  required?: boolean;
  description?: string;
  showIf?: (answers: Answers) => boolean;
} & (
  | { type: "text"; placeholder?: string; validate?: (v: string) => string | null; validateAsync?: ValidateAsyncFn }
  | { type: "select"; options?: SelectOption[]; resolve?: ResolverFn }
  | { type: "toggle"; default?: boolean }
  | { type: "display"; resolve: (answers: Answers, hise?: HiseConnection) => Promise<string> }
);

interface PreviewResult {
  content: string;
  language?: string;               // for syntax highlighting ("hisescript", "json")
  actions: ("accept" | "reject" | "copy")[];
}

type WizardOutput =
  | { type: "clipboard"; generate: (answers: Answers) => string }
  | { type: "apply"; execute: (answers: Answers, hise: HiseConnection) => Promise<CommandResult> }
  | { type: "preview-then-decide" };  // uses the PreviewStep's actions

type Answers = Record<string, unknown>;
type ResolverFn = (answers: Answers, hise?: HiseConnection) => Promise<SelectOption[]>;
type ValidateAsyncFn = (value: unknown, answers: Answers, hise?: HiseConnection) => Promise<string | null>;
```

**FormStep** renders multiple fields on a single page. This matches the
existing HISE wizard layout where one page often has 2–5 related inputs
(e.g., the broadcaster's ComplexData branch needs DataType, EventType,
ModuleIDs, SlotIndex, and Metadata on one page).

**RepeatGroup** clones its inner steps for each iteration, appending `_0`,
`_1`, etc. to field IDs in the answers map. After completing the group's
steps, a "Add another?" prompt appears. `maxCount` caps repetitions.

**PipelineStep** executes a sequence of phases with streaming log output,
progress tracking, and abort capability. Used for heavyweight operations:
compiling HISE from source (setup wizard), building plugins (export wizard),
compiling DLL networks, removing installations. On failure, the wizard stays
on the pipeline step — the user can retry from the failed phase or go back
to the previous configuration step. Back navigation from a pipeline step
returns to the last configuration step, not mid-pipeline.

In CLI mode, pipeline phases run non-interactively. Progress and logs are
emitted as structured JSON lines (`{phase, status, log?, progress?}`). On
failure, the result includes the failed phase ID and error message.

**FormField `display` type** is a read-only computed text shown in a form
step. The `resolve` function runs when the step is entered and its result is
shown as non-editable context. Used for: output file path preview (export
wizard), detected network/file lists (compile-networks wizard), platform
detection results (setup wizard).

### Step Validation

Each step supports two levels of validation that run when the user presses
Enter to advance:

```ts
// Sync — format checks (on TextStep and FormField type:"text")
validate?: (value: string) => string | null;

// Async — instance-level checks, may round-trip to HISE
validateAsync?: (value: unknown, answers: Answers, hise?: HiseConnection) => Promise<string | null>;
```

**Validation lifecycle (TUI):**

1. User presses Enter to advance
2. All sync `validate` functions run on the current step's fields
3. If any sync error → stop, show errors inline, jump cursor to first error field
4. If all sync pass → run all `validateAsync` functions (parallel where independent)
5. If any async error → stop, show errors inline, jump cursor to first error field
6. If all pass → advance to next step

During async validation the UI blocks briefly (no spinner). If validation
takes >2 seconds, a `Validating...` hint appears in the footer.

**Error display:** errors appear below the failing field in
`HISE_ERROR_COLOUR`. In form steps with multiple failing fields, all error
messages are shown simultaneously and the cursor jumps to the first error
field. Errors persist until the next Enter press — they are not cleared on
keystroke.

**Validation lifecycle (CLI):** `WizardExecutor.validate()` runs all sync
and async validators at once. Returns `{ field: string; message: string }[]`
for all failures.

**Example — broadcaster component ID validation:**

```ts
{
  type: "text",
  id: "componentIds",
  label: "Component IDs",
  placeholder: "Enter component IDs...",
  required: true,
  validate: (v) => v.trim() === "" ? "Required" : null,
  validateAsync: async (v, _answers, hise) => {
    const ids = String(v).split(",").map(s => s.trim());
    const components = await hise?.request("GET", "/api/list_components");
    const known = new Set(components?.map((c: any) => c.id));
    const unknown = ids.filter(id => !known.has(id));
    return unknown.length > 0
      ? `Unknown component(s): ${unknown.join(", ")}`
      : null;
  },
}
```

### State Machines

Two entry points into the same definition:

**WizardRunner** (TUI path — step-by-step):

```ts
class WizardRunner {
  definition: WizardDefinition;
  answers: Answers;
  currentStepIndex: number;
  repeatCounts: Record<string, number>;

  visibleSteps(): WizardStep[];       // filters by showIf, expands repeats
  currentStep(): WizardStep;
  advance(answer: unknown): void;     // validate, store, move forward
  back(): void;                       // restore previous, move back
  canGoBack(): boolean;
  isComplete(): boolean;
  generateOutput(): Promise<string | CommandResult>;
}
```

Answers are preserved when navigating back. Changing an answer that affects
`showIf` conditions does not reset later answers — they are re-evaluated on
each advance, and hidden steps retain their stored values silently.

**WizardExecutor** (CLI path — single-shot):

```ts
class WizardExecutor {
  definition: WizardDefinition;

  execute(answers: Answers, hise?: HiseConnection): Promise<{
    result: string | CommandResult;
    errors?: { field: string; message: string }[];
  }>;

  validate(answers: Answers): ValidationResult;

  schema(): WizardSchema;             // JSON-serializable definition for --schema
}
```

The `validate` method evaluates `showIf` predicates to determine which fields
are required given the supplied answers, checks required fields, validates
values against options/validators, and resolves dynamic options to validate
against them. The `schema` method returns a JSON-serializable representation
of the wizard definition (steps, options, types, descriptions) that LLMs can
use to discover what parameters are needed.

### Registration & Invocation

Wizards are registered in a `WizardRegistry` (engine layer):

| Invocation | Syntax | Effect |
|------------|--------|--------|
| Global     | `/wizard <id>` | Opens wizard from any mode or root |
| Global     | `/wizard` (no args) | Selection list of available wizards, filtered by current mode |
| Mode-specific | `wizard <id>` (no slash) | Available when current mode is in the wizard's `modes[]` |
| CLI        | `hise-cli wizard <id> --answers '<json>'` | Single-shot execution |
| CLI        | `hise-cli wizard <id> --schema` | Dump wizard parameter schema as JSON |
| CLI        | `hise-cli wizard list` | List available wizards |
| Alias      | `hise-cli setup` | Shorthand for `hise-cli wizard setup` (also: `update`, `migrate`, `nuke`) |

Tab completion works on wizard IDs in both `/wizard` and mode-specific `wizard`
contexts. The `--schema` flag is particularly valuable for LLMs — they can
query the wizard's parameter schema, see all options and help text, and
construct the right answers without step-by-step interaction.

### Lifecycle

**TUI:**
1. User invokes wizard → engine creates `WizardRunner` → TUI opens overlay
2. Each step: engine resolves options if needed → TUI renders step → user
   answers → engine validates and advances
3. On complete: engine generates output → TUI shows preview or executes action
4. On cancel (`Escape` from step 1): engine discards runner → TUI closes overlay

**CLI:**
1. Tool invokes `hise-cli wizard <id> --answers '{...}'`
2. Engine creates `WizardExecutor`, validates all answers at once
3. If valid: resolves dynamic data, generates output, returns JSON result
4. If invalid: returns error array with field-level messages

### Standalone Mode

Wizards with `standalone: true` run without a REPL session or HISE
connection. This covers operations that must work before HISE exists (setup),
on installations that may be broken (update, migrate), or that destroy
installations (nuke). In standalone mode:

- The wizard overlay renders at the same 60×20 fixed size, centered on a
  plain `backgrounds.standard` fill (no REPL content behind it)
- The entry point is `hise-cli wizard <id>` or a subcommand alias
  (e.g., `hise-cli setup` → `hise-cli wizard setup`)
- Resolver functions receive no `HiseConnection` — they use local
  filesystem scanning, GitHub API calls, or static data instead

### Shared Pipeline Phases

Pipeline phases are composable building blocks in `src/engine/wizard/phases/`.
Multiple wizard definitions reuse the same phase implementations:

```
src/engine/wizard/phases/
  compile.ts      # Projucer resave + MSBuild/xcodebuild/make
  verify.ts       # Binary existence + size + build flag check
  sdk-check.ts    # Verify SDKs are extracted
  git-ops.ts      # Clone, fetch, checkout, submodule update
  cleanup.ts      # Directory removal, PATH cleanup, settings removal
```

| Phase          | Used by                            |
|----------------|------------------------------------|
| `compile`      | setup, update, export, compile-networks |
| `verify`       | setup, update, export              |
| `sdk-check`    | setup, export, compile-networks    |
| `git-ops`      | setup, update, migrate             |
| `cleanup`      | nuke                               |

The `compile` phase encapsulates the entire platform-aware C++ compilation
pipeline from the current `src/setup/phases.ts` — Projucer project resave,
MSBuild (Windows) / xcodebuild (macOS) / make (Linux) invocation, build
configuration selection. The same logic that builds HISE from source also
builds plugins and DLL networks. Only the build target and configuration
parameters differ, and those come from the wizard's answers.

### Subcommand Aliases & Entry Point

Lifecycle subcommands are aliases for wizard invocations:

| Subcommand         | Equivalent                     |
|--------------------|--------------------------------|
| `hise-cli setup`   | `hise-cli wizard setup`        |
| `hise-cli update`  | `hise-cli wizard update`       |
| `hise-cli migrate` | `hise-cli wizard migrate`      |
| `hise-cli nuke`    | `hise-cli wizard nuke`         |

When `hise-cli` runs with **no arguments**:

1. Probe `localhost:1900` for a running HISE instance
2. If reachable → launch the REPL
3. If not → show a selection menu of standalone wizards (setup, update,
   migrate, nuke) plus "Launch REPL anyway"

This replaces the current custom menu in `src/menu/App.tsx`.

### Planned Wizards

Eight wizard definitions are planned. Four are standalone lifecycle wizards
(no HISE connection required), four operate on a running HISE project.

#### Standalone Lifecycle Wizards

**Setup** (`id: "setup"`, standalone, replaces `src/setup/`):

| Step | Type     | Content |
|------|----------|---------|
| 1    | form     | Platform detection results (display fields: OS, arch, git, compiler, Faust, IPP — auto-populated by resolvers) |
| 2    | form     | Prerequisites (showIf: missing required prereqs). Actionable remediation list with URLs and commands |
| 3    | form     | Configuration: install path (text), include Faust (toggle), include IPP (toggle, showIf: Windows) |
| 4    | pipeline | Build: 9 phases — git clone, build deps, Faust install, SDK extraction, compile, add to PATH, verify, test. Each phase has `shouldSkip` |
| 5    | preview  | Completion: success/failure summary, install path, build time, next steps, log file path |

Output: `preview-then-decide` (accept exits, reject goes back to config).

**Update** (`id: "update"`, standalone):

| Step | Type     | Content |
|------|----------|---------|
| 1    | select   | Detected HISE installations (resolver: scan `DEFAULT_INSTALL_PATHS` + PATH) |
| 2    | form     | Update options: target commit (text, default: latest CI passing), update Faust (toggle) |
| 3    | pipeline | Phases: git fetch, checkout target, submodule update, optional Faust update, recompile (shared `compile` phase), verify (shared `verify` phase) |
| 4    | preview  | Completion summary |

Output: `preview-then-decide`.

**Migrate** (`id: "migrate"`, standalone):

| Step | Type     | Content |
|------|----------|---------|
| 1    | text     | Path to existing ZIP-based HISE installation (validateAsync: check directory exists and contains HISE) |
| 2    | form     | Options: keep backup (toggle, default: true), target commit (text, default: latest CI passing) |
| 3    | pipeline | Phases: backup existing, init git repo, add remote, fetch, checkout target, submodule init, verify |
| 4    | preview  | Completion summary |

Output: `preview-then-decide`.

**Nuke** (`id: "nuke"`, standalone):

| Step | Type         | Content |
|------|--------------|---------|
| 1    | multi-select | Detected HISE installations to remove (resolver: scan filesystem + PATH) |
| 2    | form         | Cleanup options: remove settings files (toggle), remove PATH entries (toggle) |
| 3    | preview      | Confirm: show exactly what will be deleted. Explicit accept required. |
| 4    | pipeline     | Phases: remove selected directories (shared `cleanup` phase), clean PATH entries, remove settings files |

Output: `preview-then-decide`.

#### HISE-Connected Wizards

**Broadcaster** (`id: "broadcaster"`, modes: `["script"]`):

| Step | Type   | Content |
|------|--------|---------|
| 1    | form   | Broadcaster ID (text, validateAsync: valid identifier + unique), comment (text), tags (text), colour (text) |
| 2    | select | Attach type: None, ComplexData, ComponentProperties, ComponentValue, ComponentVisibility, ContextMenu, EqEvents, ModuleParameters, MouseEvents, ProcessingSpecs, RadioGroup, RoutingMatrix |
| 3    | form   | Source configuration (showIf per attach type — 12 conditional forms with fields like moduleIds, componentIds, propertyType, slotIndex. Dynamic fields use validateAsync to check IDs against HISE) |
| 4    | select | Target type: None, Callback, Callback (Delayed), ComponentProperty, ComponentRefresh, ComponentValue, ModuleParameter |
| 5    | form   | Target configuration (showIf per target type — 7 conditional forms) |
| 6    | preview | Generated HiseScript code with syntax highlighting |

Output: `preview-then-decide` (accept copies to clipboard).
Source: `data/wizards/broadcaster.json`.

**Install Package** (`id: "install-package"`, modes: `["project"]`):

| Step | Type   | Content |
|------|--------|---------|
| 1    | form   | Load existing settings (toggle), info text (text, multiline) |
| 2    | form   | Wildcards: include patterns (text), exclude patterns (text) |
| 3    | multi-select | File type filter (showIf: use filter toggle): Scripts, AdditionalSourceCode, Samples, Images, AudioFiles, SampleMaps, MidiFiles, DspNetworks |
| 4    | multi-select | Preprocessors (showIf: use preprocessors toggle): resolved from `project_info.xml` |
| 5    | form   | Clipboard content (showIf: use clipboard toggle): text to copy after install |
| 6    | preview | Generated `install_package.json` content |

Output: `apply` (writes `install_package.json` to project root).
Source: `data/wizards/install_package_maker.json`.

**Plugin Export** (`id: "export"`, modes: `["compile"]`):

| Step | Type     | Content |
|------|----------|---------|
| 1    | form     | Export target (select: Plugin/Standalone), project type (select: Instrument/FX/MIDI), plugin type (select: VST/AU/AAX/All). Display field: computed output file path |
| 2    | pipeline | Compilation: SDK check (shared), Projucer resave + compile (shared `compile` phase), verify (shared `verify` phase) |
| 3    | preview  | Completion: binary path, size, build time |

Output: `preview-then-decide` (accept shows file location).
Source: `data/wizards/plugin_export.json`.

**Compile Networks** (`id: "compile-networks"`, modes: `["dsp"]`):

| Step | Type     | Content |
|------|----------|---------|
| 1    | form     | Display fields: detected networks, C++ files, Faust files (resolved from project). Toggles: replace script FX modules, open DLL project in IDE |
| 2    | form     | C++ node properties (showIf: has C++ nodes, foldable equivalent): IsPolyphonic (multi-select of node names), AllowPolyphonic (multi-select of node names). Items resolved dynamically. |
| 3    | pipeline | Compilation: SDK check (shared), DLL compile (shared `compile` phase with DLL target) |

Output: `apply` (DLL written to project, optionally opens IDE).
Source: `data/wizards/compile_networks.json`.

### Source Data

Wizard definitions are hand-written TypeScript in
`src/engine/wizard/definitions/`. The existing C++ multipage dialog JSON
files in `data/wizards/` serve as design reference material — they contain
page layouts, component types, option lists, help text, and branching logic
from the HISE desktop dialogs. These are not parsed at runtime. See
[docs/WIZARD_CONVERSION.md](docs/WIZARD_CONVERSION.md) for the conversion
process from C++ dialog JSON to TypeScript `WizardDefinition`.

Currently available source JSONs: `broadcaster.json`, `new_project.json`,
`install_package_maker.json`, `plugin_export.json`, `compile_networks.json`.

---

## Key Design Decisions

### 1. Smart client - local type validation + HISE instance validation

**Decision**: The CLI validates type-level constraints locally using
`moduleList.json` (module type exists, chain accepts subtype, parameter
name valid, value in range). Instance-level constraints (does "Sampler1"
exist in the live tree?) are tracked locally after an initial fetch from
`GET /api/builder/tree` on mode entry.

**Rationale**: The module list JSON is rich enough (79 modules with full
parameter definitions, modulation chain constrainers, FX chain rules) to
catch the vast majority of user errors instantly. Only 12 modules have
dynamic parameters that the JSON cannot describe. This gives instant
feedback for typos and structural mistakes without waiting for HISE, while
HISE remains the authority for execution.

**Previous decision**: The original design called for a pure "thin client"
where all validation was done by HISE. Analysis of `moduleList.json` showed
this was unnecessarily conservative.

### 2. HISE-side validation with `--validate` flag

**Decision**: The same API endpoints accept a `validate: true` flag that runs
the command through the normal code path but stops before executing.

**Alternative rejected**: Separate `builder.validate.add` endpoints would
double the API surface. The validate flag keeps it at one endpoint per
operation.

### 3. CLI-side script generation

**Decision**: The CLI generates HiseScript from validated plan steps using
the `builderPath` field from `moduleList.json`.

**Alternative rejected**: HISE-side code generation would require building a
string-based code generator in statically compiled C++, which is the wrong
tool for template-based string manipulation. TypeScript with template literals
is far more natural for this.

### 4. Static autocomplete + validation data

**Decision**: Module types, API methods, and node factories ship as static
JSON files with the CLI. These serve both tab completion and validation.

**Alternative rejected**: Querying HISE at runtime for completions adds latency
on every Tab press and requires a live connection. Static data works offline,
is instant, and covers 99% of cases. The `meta.*` REST endpoints exist for
runtime refresh if the static data is stale.

### 5. Dot notation for parent.chain

**Decision**: `Sampler1.gain` uses dots to separate parent from chain.

**Alternative rejected**: Slash (`Sampler1/gain`) was considered but conflicts
with filesystem paths used elsewhere (script connections, sample imports).
Dots mirror HiseScript conventions and read naturally as "property of."

### 6. Hybrid clone syntax - no trailing number inference

**Decision**: Clone count is always explicit (`x4`) or uses brace expansion
(`{2..10}`). No automatic trailing-number detection.

**Rationale**: Trailing number extraction is fragile. `"My Sampler V2"`,
`"Bass_12_Layer"`, `"Pad 1A"` - all break trailing-number inference in
different ways. Explicit count/range is unambiguous.

### 7. Workspace = HISE IDE workspaces

**Decision**: `/workspace` refers to HISE's three IDE workspaces (Scripting,
Sampler, Scriptnode), not project directories.

**Rationale**: The original brainstorm confused "workspace" with "project
directory management." In HISE, workspaces are IDE views. `/workspace
MySampler` switches the HISE IDE to the Sampler workspace AND enters the
CLI's sampler mode - one command does both.

### 8. HTTP + SSE over named pipe

**Decision**: Use HISE's existing HTTP REST API (`localhost:1900`) for
request/response and Server-Sent Events for push. The named pipe REPL
server is retired.

**Rationale**: The REST API is battle-tested (MCP server uses it daily),
HTTP naturally supports multiple simultaneous clients (MCP + CLI), and
SSE covers push use cases (progress, monitoring) without a custom protocol.
cpp-httplib already supports SSE natively. The SSE endpoint is modal
(blocks other requests while streaming), which is correct for the
long-running operations it serves (compression, export, render).

**Multi-client requirement**: The typical workflow has a terminal with
Claude Code / opencode (using the MCP server via HTTP) and a second terminal
with hise-cli (also using HTTP). Both connect simultaneously. Named pipes
(JUCE `NamedPipe` is single-client) cannot support this without complex
multiplexing.

**Alternative rejected**: Named pipe as sole transport - cannot handle
multiple simultaneous clients. Named pipe as sidecar for push events -
adds complexity with two transports to maintain.

### 9. Tests as API contract

**Decision**: MockHiseConnection-based tests serve as the living specification
for HISE's C++ REST endpoints.

**Rationale**: The mock responses document exactly what request format HISE
needs to accept and what response format it should return. When implementing
the C++ side, match the test expectations. This eliminates the need for a
separate protocol specification document that can drift from reality.

### 10. Dual frontends from day one

**Decision**: The engine is UI-agnostic from the start, with both TUI and CLI
frontends.

**Rationale**: Designing for LLM access after the fact would require
retrofitting structured output, non-interactive invocation, and JSON
formatting onto a TUI-only codebase. Building both from the start means every
command naturally has both a human-readable and machine-readable representation.

### 11. REPL via /api/repl, not /api/set_script

**Decision**: The TUI's script mode uses `POST /api/repl` for expression
evaluation, not `POST /api/set_script`.

**Rationale**: The script mode is a REPL - evaluate an expression, see the
result. `set_script` wholesale replaces callback code, which is the MCP
server's job (AI agents editing scripts programmatically). The TUI never
needs to replace script content. For external file changes, the user edits
in their editor and calls `POST /api/recompile` from the TUI.

### 12. Wizards as unified interface for complex operations

**Decision**: Complex multi-parameter operations (broadcaster setup, monolith
encoding, asset payload creation, project scaffolding, plugin export, HISE
installation) are modeled as declarative wizard definitions in the engine
layer, with the TUI rendering them as interactive step-by-step overlays and
the CLI exposing them as single-shot parameterized commands. This includes
the setup/update/migrate/nuke lifecycle, which becomes standalone wizards
replacing the current dedicated TUI flows.

**Rationale**: HISE already has C++ multipage dialogs for many of these tasks,
but their UX is poor. More importantly, the raw REST API endpoints for these
operations require the caller to know endpoint URLs, parameter formats, valid
option sets, and sequencing. A wizard definition captures all of this in one
place — the TUI gets a guided experience, the CLI gets a self-documenting
command with built-in validation, and LLMs get a `--schema` flag to discover
parameters. One definition serves three audiences.

The `pipeline` step type enables code reuse across wizards that share
heavyweight operations. The same `compile` phase (Projucer resave +
MSBuild/xcodebuild/make) is used by the setup wizard (building HISE), the
export wizard (building plugins), and the compile-networks wizard (building
DLLs). Battle-tested platform-specific compilation logic from `src/setup/`
becomes a shared building block rather than being locked inside one flow.

**Alternative rejected**: Separate TUI overlays and CLI commands per operation.
This duplicates validation logic, option definitions, and help text across two
codepaths. The wizard framework ensures a single source of truth.

---

## Implementation Phases

Critical path: **1 -> 2 -> 3 -> 4 -> 5**. Phase 12 (HISE C++ side) is
independent work that can proceed in parallel.

| Phase | Issue | Title                                              |
|-------|-------|----------------------------------------------------|
| 1     | [#1](https://github.com/christoph-hart/hise-cli/issues/1)   | Command Engine Core + TDD setup          |
| 2     | [#2](https://github.com/christoph-hart/hise-cli/issues/2)   | Mode System + Slash Commands             |
| 3     | [#3](https://github.com/christoph-hart/hise-cli/issues/3)   | Tab Completion Engine                    |
| 4     | [#5](https://github.com/christoph-hart/hise-cli/issues/5)   | Builder Mode                             |
| 5     | [#4](https://github.com/christoph-hart/hise-cli/issues/4)   | Plan Submode + Script Generation         |
| 6     | [#6](https://github.com/christoph-hart/hise-cli/issues/6)   | DSP (Scriptnode) Mode                    |
| 7     | [#8](https://github.com/christoph-hart/hise-cli/issues/8)   | Script Mode                              |
| 8     | [#7](https://github.com/christoph-hart/hise-cli/issues/7)   | Inspect Mode                             |
| 9     | [#9](https://github.com/christoph-hart/hise-cli/issues/9)   | Project, Compile, Import Modes           |
| 10    | [#11](https://github.com/christoph-hart/hise-cli/issues/11) | Workspace Navigation + Sampler Mode      |
| 11    | [#10](https://github.com/christoph-hart/hise-cli/issues/10) | Command Palette (Ctrl+Space)             |
| 12    | [#12](https://github.com/christoph-hart/hise-cli/issues/12) | HISE REST API Extensions + SSE (C++ side) |
| 13    | [#15](https://github.com/christoph-hart/hise-cli/issues/15) | Wizard Framework + Wizard Definitions                        |
| -     | [#13](https://github.com/christoph-hart/hise-cli/issues/13) | Future: Wave Editing + Sample Analysis   |
