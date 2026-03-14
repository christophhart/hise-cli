# DESIGN.md — hise-cli REPL Architecture v2

> Comprehensive design document for the hise-cli modal REPL system.
> Covers architecture, mode grammars, protocol specification, and design rationale.
>
> Implementation tracked in [Milestone: REPL Architecture v2](https://github.com/christoph-hart/hise-cli/milestone/1)

---

## Vision

hise-cli is a modal REPL and command-line interface for
[HISE](https://hise.dev), an open-source framework for building audio
plugins. It serves two audiences through two frontends sharing one engine:

- **Humans** use the TUI (terminal UI) — an interactive Ink/React app with
  colored output, progress bars, tab completion, and keyboard navigation.
- **LLMs and automation tools** use the CLI — non-interactive, argument-based
  invocation with structured JSON output.

The app is a **thin client**: it parses commands, renders output, and provides
tab completion from static datasets. HISE does the heavy lifting — validating
operations, executing commands, and managing state. The CLI never replicates
HISE's internal logic.

---

## Architecture

### Three-Layer Design

```
src/
  engine/          Shared core — zero UI dependencies
    commands/      Command registry, dispatcher, parsers
    modes/         Mode definitions (builder, script, dsp, sampler, ...)
    completion/    Tab completion engine
    plan/          Plan mode state + script generation
    result.ts      CommandResult types
    session.ts     Mode stack, history, session state
    hise.ts        HiseConnection interface + HTTP implementation
    data/          Static JSON datasets (module types, API methods, nodes)

  tui/             TUI frontend — Ink/React
    app.tsx        Main TUI app
    components/    Output, Input (with completion popup), Progress, Header
    hooks/         React hooks wrapping engine

  cli/             CLI frontend — pure Node.js
    index.ts       Argument parsing, dispatch, JSON output
```

The engine has **no dependency** on Ink, React, or any terminal UI library.

### Data Flow

```
                    ┌───────────────────────────────┐
  TUI (human)       │         Command Engine        │       HISE
  ─────────────     │                               │     ─────────
  Ink/React    ───> │  parse ──> dispatch ──> send  │ ──> HTTP REST API
  keyboard input    │                               │     localhost:1900
  colored output <──│  format <── result <── recv   │ <── JSON responses
                    │                               │
  CLI (LLM)         │  Modes, completion, plan      │
  ─────────────     │  state — all shared           │
  args + flags ───> │                               │
  JSON output  <──  └───────────────────────────────┘
```

### Thin Client Responsibility Split

| Concern                       | Owner | How                                        |
|-------------------------------|-------|--------------------------------------------|
| Parsing commands              | CLI   | Mode-specific grammar parsers              |
| Tab completion                | CLI   | Static JSON datasets shipped with the app  |
| Tracking plan step references | CLI   | Simple string bookkeeping (not tree logic)  |
| Generating HiseScript         | CLI   | Template-based, using static type mappings  |
| Validating operations         | HISE  | Same API with `validate: true` flag         |
| Executing operations          | HISE  | Builder, DspNetwork, Sampler APIs          |
| Determining module types      | HISE  | Responds with type info on queries          |
| Managing module tree state    | HISE  | Full ownership of runtime state             |

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

`/workspace` is the **primary navigation command** — it tells HISE to switch
its IDE view to the appropriate workspace (Scripting, Sampler, or Scriptnode)
and puts the CLI into the matching mode. The mode is inferred from the module
type:

| Module type                          | HISE workspace | CLI mode             |
|--------------------------------------|---------------|----------------------|
| ScriptProcessor                      | Scripting     | `[script:Name]`      |
| StreamingSampler                     | Sampler       | `[sampler:Name]`     |
| HardcodedSynth / ScriptFX with DSP  | Scriptnode    | `[dsp:NetworkName]`  |

DSP mode is **only** reachable via `/workspace` — there is no `/dsp` command
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

### Plan Submode

Enter with `plan` from builder mode. Commands are validated by HISE (via the
`validate` flag on the existing API) and recorded. Strict validation: invalid
commands are rejected immediately.

```
[builder] > plan
[builder:plan] > add StreamingSampler as "Sampler 1"
  ✓ [1] add StreamingSampler as "Sampler 1"
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
steps are flagged — no HISE roundtrip needed for that.

**CLI-side script generation**: the CLI generates HiseScript from validated
plan steps using the static dataset to map short type names to full builder
constants (`SimpleGain` -> `builder.Effects.SimpleGain`). Clone steps emit
for-loops.

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

12 node factories, ~177 nodes: container, core, math, envelope, routing,
analyse, fx, control, dynamics, filters, jdsp, template.

### Script Mode

HiseScript REPL. Defaults to Interface processor. Everything typed is sent
to HISE's script evaluator.

```
[script:Interface] > Engine.getSampleRate()
44100.0
[script:Interface] > Console.print("hello")
hello
```

- **Multi-line**: unclosed brackets continue on next line
- **Last result**: `_` stores the last evaluated result
- **`/api Namespace.method`**: inline API reference from static data

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

Runtime introspection. One-shot snapshots + subscriptions for live monitoring.

```
cpu | memory | voices | modules | <name> | connections | routing | midi
```

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
vst3|au|standalone|aax [debug|release] | dll | all [debug|release]
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

## Communication with HISE

The CLI communicates with HISE via its existing **HTTP REST API** on
`localhost:1900`. This API is already used by the HISE MCP server and other
consumers, has a proven threading model, and provides a self-documenting
discovery endpoint at `GET /`.

### Transport Abstraction

The engine layer talks to HISE through a `HiseConnection` interface:

```ts
interface HiseConnection {
  request(endpoint: string, params?: object): Promise<HiseResponse>;
  destroy(): void;
}
```

The default implementation uses HTTP (`HttpHiseConnection`). A named pipe
implementation (`PipeHiseConnection`) can be added later as a drop-in
replacement — same interface, different transport. The engine, modes, and
frontends never know which transport is in use.

```bash
hise-cli --port 1900           # default: HTTP on port 1900
hise-cli --pipe /tmp/hise      # future: named pipe transport
```

### Response Format

All responses follow the existing REST API convention:

```json
{
  "success": true,
  "result": { ... },
  "logs": ["console output"],
  "errors": [{"errorMessage": "...", "callstack": [...]}]
}
```

### Existing Endpoints Reused

Several CLI modes use existing REST API endpoints directly:

| CLI mode      | Existing endpoint                     | Use case                 |
|---------------|---------------------------------------|--------------------------|
| Script mode   | `POST /api/set_script`                | Evaluate HiseScript      |
| Script mode   | `GET /api/get_script`                 | Read current script      |
| Inspect mode  | `GET /api/status`                     | Project + processor info |
| Inspect mode  | `GET /api/list_components`            | Component tree           |
| Inspect mode  | `GET /api/screenshot`                 | Visual verification      |
| Project mode  | `GET /api/status`                     | Project info             |

### New Endpoints

New endpoints follow the same conventions as the existing API:
- `GET` for reads, `POST` for mutations
- Query params for GET, JSON body for POST
- `{success, result, logs, errors}` response format
- Self-documenting via `GET /` discovery

Categories: `builder`, `sampler`, `dsp`, `workspace`, `inspect`, `compile`,
`packages`, `meta`.

The `validate` flag on builder and dsp endpoints enables dry-run validation
through the same code path (same pattern as `compile: false` on `set_script`).
The `meta` endpoints provide ground-truth data dumps for bootstrapping CLI
autocomplete datasets.

Full endpoint specification: [REST_API_ENHANCEMENT.md](REST_API_ENHANCEMENT.md)
and [Issue #12](https://github.com/christoph-hart/hise-cli/issues/12)

### Live Monitoring (Future)

For continuous monitoring (CPU, MIDI, voices), the transport approach is TBD.
Options include polling, Server-Sent Events, or a dedicated pipe channel.
This will be decided when inspect mode is implemented.

---

## Key Design Decisions

### 1. Thin client — why not replicate HISE logic in CLI

**Decision**: The CLI never validates module types, chain constraints, or tree
structure. HISE does all validation.

**Rationale**: Replicating HISE's module tree logic in TypeScript would be
fragile (breaks when HISE adds modules or changes rules), duplicative, and
inconsistent with the goal of a lightweight CLI. Sending a validation request
to HISE and displaying the result is simpler and always correct.

**Exception**: Tab completion uses static JSON datasets for responsiveness.
If a dataset is stale, a new module just won't appear in autocomplete — but
the command still works if typed manually.

### 2. HISE-side validation with `--validate` flag

**Decision**: The same API endpoints accept a `validate: true` flag that runs
the command through the normal code path but stops before executing.

**Alternative rejected**: Separate `builder.validate.add` endpoints would
double the API surface. The validate flag keeps it at one endpoint per
operation.

### 3. CLI-side script generation

**Decision**: The CLI generates HiseScript from validated plan steps using
static type mappings.

**Alternative rejected**: HISE-side code generation would require building a
string-based code generator in statically compiled C++, which is the wrong
tool for template-based string manipulation. TypeScript with template literals
is far more natural for this.

### 4. Static autocomplete data

**Decision**: Tab completion data (module types, scriptnode nodes, API methods)
ships as static JSON files with the CLI.

**Alternative rejected**: Querying HISE at runtime for completions adds latency
on every Tab press and requires a live connection. Static data works offline,
is instant, and covers 99% of cases. The `meta.*` protocol endpoints exist for
validation or refreshing the static data.

### 5. Dot notation for parent.chain

**Decision**: `Sampler1.gain` uses dots to separate parent from chain.

**Alternative rejected**: Slash (`Sampler1/gain`) was considered but conflicts
with filesystem paths used elsewhere (script connections, sample imports).
Dots mirror HiseScript conventions and read naturally as "property of."

### 6. Hybrid clone syntax — no trailing number inference

**Decision**: Clone count is always explicit (`x4`) or uses brace expansion
(`{2..10}`). No automatic trailing-number detection.

**Rationale**: Trailing number extraction is fragile. `"My Sampler V2"`,
`"Bass_12_Layer"`, `"Pad 1A"` — all break trailing-number inference in
different ways. Explicit count/range is unambiguous.

### 7. Workspace = HISE IDE workspaces

**Decision**: `/workspace` refers to HISE's three IDE workspaces (Scripting,
Sampler, Scriptnode), not project directories.

**Rationale**: The original brainstorm confused "workspace" with "project
directory management." In HISE, workspaces are IDE views. `/workspace
MySampler` switches the HISE IDE to the Sampler workspace AND enters the
CLI's sampler mode — one command does both. This is more useful than managing
directories.

### 8. HTTP REST API over custom protocol

**Decision**: Use HISE's existing HTTP REST API (`localhost:1900`) instead of
designing a custom pipe-based protocol.

**Rationale**: The REST API is already built, battle-tested (used by the MCP
server), has a proven threading model, and is self-documenting. HTTP gives
free request-response correlation (no custom message IDs), standard tooling
(curl, fetch), and stateless operation. The transport is abstracted behind a
`HiseConnection` interface so a named pipe transport can be added later as a
drop-in replacement if needed (lower latency, no port allocation, offline
scenarios).

**Alternative rejected**: A custom newline-delimited JSON pipe protocol with
request IDs, message type discrimination, and subscription management. This
would duplicate work already done in the REST API and add protocol design
complexity with no benefit.

### 9. Tests as API contract

**Decision**: MockHiseConnection-based tests serve as the living specification
for HISE's C++ REPL endpoints.

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

---

## Data Dependencies

Before implementation begins, these JSON datasets are needed from HISE (to be
provided by the maintainer):

| Dataset                | Purpose                                      |
|------------------------|----------------------------------------------|
| Module types by category | Builder constants, autocomplete, validation |
| Chain indexes + constraints | Which categories go in which chains      |
| Module parameters      | Builder `set`, inspect mode                   |
| Scriptnode factories + nodes | DSP mode autocomplete                   |
| Scripting API namespaces + methods | Script mode autocomplete           |
| Sample property indexes + names | Sampler mode select/set               |
| Complex group layer types + defaults | Sampler groups commands           |

These serve as both static CLI autocomplete data and expected values in test
assertions.

---

## Implementation Phases

Critical path: **1 -> 2 -> 3 -> 4 -> 5**. Phase 12 (HISE protocol) is
independent C++ work that can proceed in parallel.

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
| 12    | [#12](https://github.com/christoph-hart/hise-cli/issues/12) | HISE REST API Extensions (C++ side)      |
| —     | [#13](https://github.com/christoph-hart/hise-cli/issues/13) | Future: Wave Editing + Sample Analysis   |
