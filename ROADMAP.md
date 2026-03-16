# ROADMAP.md — hise-cli Implementation

> De-facto implementation reference for hise-cli 1.0.
> Architecture and type specifications live in [DESIGN.md](DESIGN.md).
> Visual design system in [docs/TUI_STYLE.md](docs/TUI_STYLE.md).

---

## Issue Cross-Reference

ROADMAP phases are canonical. GitHub issues use descriptive titles.

| ROADMAP Phase | GitHub Issue | Scope |
|---------------|-------------|-------|
| Phase 0 — Foundation | [#1](https://github.com/christoph-hart/hise-cli/issues/1) | Engine core, test infra, directory structure |
| Phase 1 — Session + Modes | [#1](https://github.com/christoph-hart/hise-cli/issues/1), [#2](https://github.com/christoph-hart/hise-cli/issues/2) | Mode system, slash commands, session |
| Phase 2 — TUI v2 Shell | [#2](https://github.com/christoph-hart/hise-cli/issues/2) | TUI components, entry point rewire, screencasts |
| Phase 3 — Tab Completion | [#3](https://github.com/christoph-hart/hise-cli/issues/3) | Completion engine + popup |
| Phase 3.5 — Dot-Notation Dispatch | [#3](https://github.com/christoph-hart/hise-cli/issues/3) | Mode cache, arg completion, one-shot execution |
| Phase 4 — Builder + Plan | [#5](https://github.com/christoph-hart/hise-cli/issues/5), [#4](https://github.com/christoph-hart/hise-cli/issues/4) | Full grammar, module tree, plan submode |
| Phase 5 — Wizards | [#15](https://github.com/christoph-hart/hise-cli/issues/15) | Wizard framework + setup wizard |
| Phase 6 — Remaining Modes | [#6](https://github.com/christoph-hart/hise-cli/issues/6), [#8](https://github.com/christoph-hart/hise-cli/issues/8), [#7](https://github.com/christoph-hart/hise-cli/issues/7), [#11](https://github.com/christoph-hart/hise-cli/issues/11), [#9](https://github.com/christoph-hart/hise-cli/issues/9) | DSP, script (full), inspect, sampler, project/compile/import |
| Phase 7 — Polish | [#10](https://github.com/christoph-hart/hise-cli/issues/10), [#15](https://github.com/christoph-hart/hise-cli/issues/15) | Command palette, remaining wizards, CLI frontend |
| HISE C++ (parallel) | [#12](https://github.com/christoph-hart/hise-cli/issues/12) | New REST endpoints + SSE |
| Post-1.0 — Web Frontend | — | Browser frontend, live screencast replay |
| Future | [#13](https://github.com/christoph-hart/hise-cli/issues/13) | Wave editing + sample analysis |
| Future | — | Plugin UI testing via tape sessions |

---

## Principles

- **Engine-first, TUI-validated**: every feature starts as tested engine code
  (zero UI deps), then gets a TUI rendering. The TUI is the integration test
  you can feel.
- **TDD**: vitest for all engine code. `MockHiseConnection` doubles as the
  living API contract ([DESIGN.md — Decision #9](DESIGN.md#9-tests-as-api-contract)).
- **Live HISE early**: script mode (`POST /api/repl`) works against the real
  REST API from Phase 1. No mock-only development.
- **Clean break**: existing code in `src/` stays as reference. New code goes
  into `src/engine/`, `src/tui/`, `src/cli/`. Entry point (`src/index.ts`)
  is rewired in Phase 2.

## Resolved Design Decisions

These were open questions that are now settled:

- **Test file placement**: colocated (`session.test.ts` next to `session.ts`)
- **Session design**: class with thin methods delegating to pure functions
- **HiseConnection interface**: explicit `get()` / `post()` methods (not a
  single `request()` method). See Phase 0.3 for the interface definition.
- **Phase 8 (Web Frontend)**: deferred to post-1.0. The 1.0 release ships
  TUI + CLI only. The isomorphic engine constraint remains to keep the door
  open.

---

## Phase 0 — Foundation ✓

**Goal**: testable engine layer skeleton, HISE REST client, test infrastructure.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (engine core).

**Status: Completed.** Engine directory structure established, vitest configured,
all core types and interfaces implemented.

### Key decisions

- **Isomorphic constraint** ([DESIGN.md — Decision #13](DESIGN.md#13-isomorphic-engine-for-web-compatibility)):
  engine layer has zero `node:` imports. Platform-specific operations use
  `DataLoader` (see `src/engine/data.ts`) and `PhaseExecutor` (see DESIGN.md)
  interfaces.
- **Ink 6.8.0 exact** — pinned after memory leak smoke test passed.
- **`MockHiseConnection`** as living API contract
  ([DESIGN.md — Decision #9](DESIGN.md#9-tests-as-api-contract)).

### What was built

- `src/engine/hise.ts` — `HiseConnection` interface, `HttpHiseConnection`,
  `MockHiseConnection`
- `src/engine/result.ts` — `CommandResult` union type (canonical definition)
- `src/engine/data.ts` — `DataLoader` interface + dataset type definitions
- `src/engine/highlight/` — Lezer HiseScript grammar, XML tokenizer, token colors
- `src/engine/screencast/` — `.tape` parser (isomorphic)
- `vitest.config.ts` with `.js` → `.ts` resolver plugin
- Ink memory leak smoke test + scroll prototype (seed for Output component)

**Phase 0 gate: passed.** Build, typecheck, and all tests pass.

---

## Phase 1 — Session + Mode System ✓

**Goal**: the engine can parse commands, manage modes, route input, and talk
to HISE. Fully tested. No TUI yet — all validation through tests.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (engine core)
and [#2](https://github.com/christoph-hart/hise-cli/issues/2) (mode system).

**Status: Completed.** Mode system, session, command registry, and three mode
stubs (script, inspect, builder) implemented with full test coverage.

### Key decisions

- **`SessionContext` interface** avoids circular imports between modes and session.
  Modes depend on `SessionContext` (minimal), not the full `Session` class.
- **`handleInput` dispatch**: input starts with `/` → `CommandRegistry`;
  anything else → `currentMode().parse()`. Single entry point for both TUI and CLI.
- **Script mode reads `response.value`** (not `response.result`) — verified
  against `RestHelpers.cpp:513-517`.
- **Builder local validation** against `data/moduleList.json` — typos caught
  with `fastest-levenshtein` suggestions. Validates the smart-client concept.
- **Mode accent colors**: see `MODE_ACCENTS` in `src/engine/modes/mode.ts`
  (canonical) and [docs/TUI_STYLE.md — Section 1.3](docs/TUI_STYLE.md) (visual spec).

### What was built

- `src/engine/modes/mode.ts` — `Mode` interface, `ModeId` type, `CompletionResult`,
  `CompletionItem`, `MODE_ACCENTS` (canonical color definitions)
- `src/engine/session.ts` — `Session` class (mode stack, history, dispatch,
  completion routing)
- `src/engine/commands/registry.ts` — `CommandRegistry` (slash command → handler map)
- `src/engine/commands/slash.ts` — Built-in handlers (see source for current list)
- `src/engine/modes/root.ts` — Root mode (slash commands only)
- `src/engine/modes/script.ts` — Script mode (`POST /api/repl`, processor ID)
- `src/engine/modes/inspect.ts` — Inspect mode stub (cpu, memory, voices, modules)
- `src/engine/modes/builder.ts` — Builder mode (Chevrotain parser: `add`, `show`, `set`)
- `src/engine/modes/tokens.ts` — Shared Chevrotain token types

**Phase 1 gate: passed.** All tests pass including session dispatch, command registry,
mode stubs with mock HISE round-trips, builder parser + local validation.

---

## Phase 2 — TUI v2 Shell ✓

**Goal**: new TUI that renders engine `Session` state. The design becomes
tangible — you can see the color system, switch modes, interact with live HISE.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (TUI split)
and [#2](https://github.com/christoph-hart/hise-cli/issues/2) (mode prompts).

**Status: Completed.** Full TUI shell with 4-layer color system, virtual scrolling,
overlay dimming, ThemeContext, entry point rewire. Screencast infrastructure
planned but not yet implemented.

### Key decisions

- **4-layer color system**: brand (hardcoded), mode accents (hardcoded), syntax
  highlighting (hardcoded), color scheme (user-selectable). 8 shipped schemes.
  See [docs/TUI_STYLE.md — Section 1](docs/TUI_STYLE.md#1-color-system) for the
  visual spec; `src/tui/theme.ts` for canonical color values.
- **ThemeContext** (`src/tui/theme-context.tsx`): all components read colors via
  `useTheme()`, never importing `brand` directly. Enables overlay dimming
  (re-render with darkened scheme).
- **Virtual scrolling**: Output stores history as a plain array, renders only
  the visible slice. Scroll offset is a `useRef`. `React.memo` on all panels.
  See [DESIGN.md — TUI Performance Constraints](DESIGN.md#tui-performance-constraints).
- **Entry point**: probes `localhost:1900`, auto-detects HISE, falls back to
  standalone menu. See `src/index.ts`.

### What was built

- `src/tui/theme.ts` — Brand colors, `ColorScheme` interface, 8 schemes,
  `darkenHex()`, `lightenHex()`, `darkenScheme()`, `darkenBrand()`
- `src/tui/theme-context.tsx` — `ThemeProvider`, `useTheme()` hook
- `src/tui/app.tsx` — Main shell (session wiring, overlay snapshot/dimming,
  completion state, scroll handling)
- `src/tui/components/TopBar.tsx` — Branding, mode label, project name, status dot
- `src/tui/components/Output.tsx` — Virtual scrolling, `CommandResult` rendering,
  pre-computed ANSI strings, history cap
- `src/tui/components/Input.tsx` — Mode-colored prompt, command history
- `src/tui/components/StatusBar.tsx` — Context hints, scroll position
- `src/tui/components/Overlay.tsx` — Help overlay with dimmed backdrop
- `src/index.ts` — Rewired entry point with HTTP probe

**Screencasts**: infrastructure planned (`.tape` runner, asciicast writer),
**not yet implemented**. See [DESIGN.md — Screencast Framework](DESIGN.md#screencast-framework).

**Phase 2 gate: passed.** Build, typecheck, all tests pass. Manual verification
with live HISE completed (mode switching, script REPL, builder validation).

---

## Phase 3 — Tab Completion ✓

**Goal**: instant feedback from the static datasets. Validates the smart-client
concept for humans.

Tracks [#3](https://github.com/christoph-hart/hise-cli/issues/3).

**Status: Completed.** Implementation includes the completion engine, popup UX,
ghost text, and extensive UX polish (cursor navigation, `useReducer`-based input,
escape toggle, mousewheel scrolling). Builder navigation (`cd`/`ls`/`pwd`) and
`contextLabel` on modes were added as part of the UX polish work.

### 3.1 Completion engine

File: `src/engine/completion/engine.ts`

Consumes the three static datasets:
- `data/moduleList.json` — module types, parameters, chains
- `data/scriptnodeList.json` — scriptnode factories and nodes
- `data/scripting_api.json` — HiseScript API classes and methods

Mode-aware completions:
- Root: slash commands (`/builder`, `/script`, `/help`, ...)
- Builder: keywords (`add`, `show`, `set`, `cd`, `ls`, `pwd`), module types
- Script: API namespaces, method names, property names
- DSP: node factories, node types

Each `CompletionResult` carries a `label` field (e.g., "Slash commands",
"Builder keywords") displayed as a header row in the popup.

### 3.2 Completion popup

File: `src/tui/components/CompletionPopup.tsx`

Per [docs/TUI_STYLE.md — Section 3.4](docs/TUI_STYLE.md#34-completionpopup):
floating box above the input field, max 8 items visible, arrow keys to
navigate, Tab to accept. Custom implementation — no `ink-select-input`.

Key UX decisions implemented:
- **Immediate popup**: appears as user types (no Tab-to-show step)
- **No selection background**: selected item uses `brand.signal` text color only
- **Header row**: `CompletionResult.label` rendered as muted header above items
- **Scrollbar**: shared `scrollbarChar()` utility from `src/tui/components/scrollbar.ts`
- **Mousewheel**: `useOnWheel` from `@ink-tools/ink-mouse`
- **Enter accepts + submits**: completes selection and executes the command
- **Escape toggles**: close if open, open with all items if closed (discovery mode)
- **Up/Down gated**: when popup visible, arrow keys navigate popup instead of history

### 3.3 Input UX polish

File: `src/tui/components/Input.tsx`

Major rewrite of the Input component alongside completion integration:
- **`useReducer` pattern**: atomic actions for `{value, cursorOffset}` (see
  `InputAction` type), avoids stale-closure bugs from multiple keystrokes between renders
- **Full cursor navigation**: Left/Right, Home/End, Ctrl+A/E, Option+Left/Right
  (word boundary), Cmd+Left/Right
- **Cursor as bg-highlight**: `lightenHex(raised, 0.3)` instead of `█` block
- **Ghost text jitter fix**: `ghostForValue` prop suppresses stale ghost between
  render cycles; ghost only shown when cursor is at end of input
- **Scroll window**: horizontal scrolling for long inputs
- **`contextLabel` in prompt**: dynamic path from `Mode.contextLabel` property

### 3.4 Builder navigation

File: `src/engine/modes/builder.ts`

Added filesystem-style navigation for the processor tree:
- **`cd <name>`**: push to path; `cd ..` pop; `cd /` reset; `cd a.b.c` dotted path
- **`ls`/`dir`**: placeholder — returns "requires HISE connection" (needs live data)
- **`pwd`**: prints current path or `/` at root
- **`contextLabel` getter**: returns `currentPath.join(".")` for prompt display
- **`initialPath` constructor param**: for future dot-notation mode entry

### 3.5 Integration

`Mode.complete()` wired to the completion engine. `CompletionResult` flows from
engine through Session to the TUI. App manages completion state including ghost
text computation, popup visibility, and selection index.

**Phase 3 gate — results:**
- `npm test` passes: all tests green. Completion engine returns correct
  candidates for all modes, CompletionPopup renders in ink-testing-library,
  Input cursor navigation + editing thoroughly tested.
- `npm run build && npm run typecheck` pass.
- `.tape` screencast tests for completion UX: **not yet implemented** (planned).

---

## Phase 3.5 — Mode Instance Cache + Dot-Notation Dispatch

**Goal**: enable one-shot mode execution (`/builder add SimpleGain`) and cross-mode
argument completion (`/builder add ` shows builder completions from root). Builds on
the `contextLabel` and `initialPath` infrastructure from Phase 3.

This is structural plumbing — no new HISE endpoints needed. Context-dependent
completion (e.g., completing processor names in `cd` or after `/builder.`) is deferred
to Phase 4+ when live HISE data is available.

### 3.5.1 Mode instance cache

File: `src/engine/session.ts`

Currently `pushMode()` creates a new mode instance each time. This loses state
(builder's `currentPath`, script's processor ID) when modes are popped and re-entered.

Add a mode cache to Session:

```ts
private modeCache: Map<ModeId, Mode> = new Map();

getOrCreateMode(modeId: ModeId): Mode {
  let mode = this.modeCache.get(modeId);
  if (!mode) {
    mode = this.modeFactories.get(modeId)!();
    this.modeCache.set(modeId, mode);
  }
  return mode;
}
```

- `pushMode()` uses `getOrCreateMode()` instead of calling the factory directly
- Mode instances are cached for the session lifetime — re-entering `/builder`
  restores the previous `currentPath`
- Factory functions remain for initial creation (and accept constructor args
  like `initialPath` for dot-notation entry)

`popMode(silent?: boolean)`: The `silent` flag suppresses the "Exited..." result
message. Used by one-shot dispatch (Phase 3.5.3) to pop silently after executing
a single command.

Tests:
- Re-entering a mode reuses the cached instance (same object identity)
- `popMode(true)` returns `emptyResult()` instead of exit message
- Mode state (e.g., builder `currentPath`) persists across push/pop cycles

### 3.5.2 Argument completion from root

File: `src/engine/session.ts` (in `complete()` method)

When the user types `/builder add ` in root mode, completion should delegate to
builder mode's `complete()` for the argument portion.

Pattern detection in `session.complete()`:

```
/mode[.context] args
       ^              ^
       first dot      first space separates modeSpec from args
```

1. If input starts with `/` and contains a space after the mode name:
   split into `modeSpec` (before first space) and `args` (after)
2. Resolve `modeSpec` to a mode via `getOrCreateMode()`
3. If the mode has a `complete()` method, call it with `args` and an
   adjusted cursor offset (shifted left by the modeSpec + space length)
4. Shift the returned `CompletionResult.from`/`.to` back to absolute positions

This enables tab completion for mode arguments without entering the mode:
- `/builder add A` → builder completes module types starting with "A"
- `/script Engine.` → script completes API methods on Engine
- `/inspect cpu` → inspect completes its command keywords

Tests:
- `/builder add ` returns builder module type completions
- `/script ` returns script mode completions
- Cursor offset translation is correct for mid-argument positions
- Unknown mode returns no completions (no crash)

### 3.5.3 Dot-notation dispatch + one-shot execution

Files: `src/engine/commands/registry.ts`, `src/engine/commands/slash.ts`

The dot-notation system enables two things:
1. **Context entry**: `/builder.SineGenerator.pitch` → enter builder mode with
   `currentPath` set to `["SineGenerator", "pitch"]`
2. **One-shot execution**: `/builder add SimpleGain` → execute `add SimpleGain`
   in builder mode, return result to root (without staying in builder)

**Registry dispatch** (`registry.ts`):

When `dispatch()` receives a command name containing a dot (e.g., `builder.SineGenerator`),
it splits on the first dot: command = `builder`, the dot-suffix is prepended to args
as `.SineGenerator`. The handler receives `args = ".SineGenerator"` (or
`".SineGenerator.pitch add LFO"` for context + command).

**Mode handler** (`slash.ts`, `createModeHandler()`):

The handler parses its args to determine the execution style:

| Input                               | Parsed as                    | Behavior                          |
|-------------------------------------|------------------------------|-----------------------------------|
| `/builder`                          | no context, no args          | Enter mode (current behavior)     |
| `/builder.SineGenerator.pitch`      | context="SineGenerator.pitch", no args | Enter mode with context |
| `/builder add SimpleGain`           | no context, args="add SimpleGain" | One-shot: push, execute, silent pop |
| `/builder.SineGenerator.pitch add LFO` | context="SineGenerator.pitch", args="add LFO" | One-shot with context |

**One-shot flow**:
1. `getOrCreateMode(modeId)` — get or create the mode instance
2. If context: set mode's context (e.g., builder's `currentPath`)
3. `pushMode(mode)` onto the stack
4. `mode.parse(args, session)` — execute the command
5. `popMode(true)` — silent pop, no exit message
6. Return the parse result to the caller

**Context setting**: Each mode that supports context entry needs a `setContext(path: string)`
method (or the constructor's `initialPath` for first creation). For builder, this sets
`currentPath`. For script, this could set the processor ID. The exact context semantics
per mode are defined in their respective Phase 4/6 specs.

Tests:
- `/builder.SineGenerator` enters builder with `contextLabel === "SineGenerator"`
- `/builder add SimpleGain` executes one-shot, returns result, stays in root mode
- `/builder.SineGenerator.pitch add LFO` one-shot with context
- Mode stack is restored after one-shot (still in root)
- Context is preserved in cache after one-shot (re-entering `/builder` shows
  the last context set by one-shot)

### 3.5.4 Deferred: context-dependent completion

The following require live HISE data and are deferred to Phase 4+:

- **`cd` completion**: completing child processor names in builder's `cd` command
  (needs `GET /api/builder/tree` from [#12](https://github.com/christoph-hart/hise-cli/issues/12))
- **Dot-context completion**: completing processor IDs after `/builder.` (e.g.,
  `/builder.Sine` → suggests `SineGenerator`) — needs the module tree
- **`ls` output**: showing actual children at the current path — needs live data

These will be implemented alongside the full builder mode (Phase 4) and remaining
modes (Phase 6) when the HISE connection provides real processor tree data.

**Phase 3.5 gate — all must pass:**
- `npm test` passes with: mode cache reuse (same instance on re-entry), silent
  pop returns empty result, argument completion from root delegates to mode's
  `complete()` with correct offset translation, dot-notation dispatch enters
  mode with context, one-shot execution returns to root after single command
- `npm run build && npm run typecheck` pass
- `.tape` screencast tests: **not yet implemented** (planned alongside Phase 3
  screencasts)

---

## Phase 4 — Builder Mode + Plan Submode

**Goal**: the first mode with real depth. Local validation, module tree
tracking, plan recording, HiseScript generation.

Tracks [#5](https://github.com/christoph-hart/hise-cli/issues/5) (builder)
and [#4](https://github.com/christoph-hart/hise-cli/issues/4) (plan submode).

### 4.1 Builder parser

Full Chevrotain grammar from
[DESIGN.md — Builder Mode](DESIGN.md#builder-mode):
`add`, `clone`, `remove`, `clear`, `move`, `set`, `connect`, `show`, `select`,
`bypass`/`enable`, `flush`. Clone commands use `brace-expansion` for
`{2..10}` patterns.

### 4.2 Module tree tracking

Fetch from `GET /api/builder/tree` on mode entry (requires
[#12](https://github.com/christoph-hart/hise-cli/issues/12)).
Update locally as commands execute. Enables instance-level validation
(module name exists, name uniqueness) without round-trips.

### 4.3 Plan submode

Record validated commands. `/execute` runs the plan. `/export` generates
HiseScript using `builderPath` from `moduleList.json`. `/show` displays
the plan. `/remove N` edits it. `/discard` returns to live mode.

HISE-side plan validation via `validate: true` flag requires
[#12](https://github.com/christoph-hart/hise-cli/issues/12).

Phase 4 can be completed with `MockHiseConnection`. Live HISE execution
of builder commands requires [#12](https://github.com/christoph-hart/hise-cli/issues/12)
to be implemented on the C++ side.

**Phase 4 gate — all must pass:**
- `npm test` passes with: full Chevrotain parser for all documented grammar
  forms (`add`, `clone`, `remove`, `clear`, `move`, `set`, `connect`, `show`,
  `select`, `bypass`/`enable`, `flush`), plan submode records/shows/removes/
  exports commands, module tree tracking validates against mocked
  `builder/tree` response, `.tape` screencast for builder workflow
- `npm run build && npm run typecheck` pass

---

## Phase 5 — Wizard Framework

**Goal**: declarative multi-step workflows serving both TUI and CLI.

Tracks [#15](https://github.com/christoph-hart/hise-cli/issues/15).
Full type specification in
[DESIGN.md — Wizard Framework](DESIGN.md#wizard-framework).
Conversion guide in
[docs/WIZARD_CONVERSION.md](docs/WIZARD_CONVERSION.md).

### 5.1 Engine types

File: `src/engine/wizard/types.ts`

`WizardDefinition`, `WizardStep` (8 types), `FormField`, `PipelinePhase`,
`PipelineCallbacks`, `PhaseResult`, `WizardOutput`, `Answers`.

### 5.2 WizardRunner (TUI state machine)

File: `src/engine/wizard/runner.ts`

Step-by-step navigation: `advance()`, `back()`, `visibleSteps()`,
`currentStep()`, `isComplete()`, `generateOutput()`.

### 5.3 WizardExecutor (CLI single-shot)

File: `src/engine/wizard/executor.ts`

`execute(answers)`, `validate(answers)`, `schema()`.

### 5.4 TUI overlay

File: `src/tui/wizard/WizardOverlay.tsx`

60×20 fixed-size overlay, copper `#e8a060` border. Step renderers for
select, text, toggle, form, preview, pipeline. Keyboard map per
[docs/TUI_STYLE.md — Section 4.5](docs/TUI_STYLE.md#45-wizard-keyboard-map).

### 5.5 Pipeline executor

File: `src/engine/wizard/pipeline.ts`

Phase sequencing, streaming log output, abort (`AbortController`), retry
from failed phase.

### 5.6 Shared pipeline phases

Directory: `src/engine/wizard/phases/`

Reusable building blocks extracted from `src/setup/phases.ts`. The
extraction must remove all TUI dependencies (Ink components, React hooks)
from the phase logic. Prerequisite for Phase 5.7.

Specific exports to extract from `src/setup/phases.ts`:
- `compile.ts` — Projucer + platform compiler (`runProjucer`, `runBuild`)
- `verify.ts` — binary check (`verifyBinary`, `checkBuildFlags`)
- `git-ops.ts` — clone, fetch, checkout (`gitClone`, `gitFetch`, `gitCheckout`)
- `cleanup.ts` — directory + PATH removal (`removeDirectory`, `cleanPath`)

### 5.7 Setup wizard definition

File: `src/engine/wizard/definitions/setup.ts`

The first real wizard. `standalone: true`. 5 steps (form → form → form →
pipeline → preview). Reuses the 9 build phases from `src/setup/phases.ts`
via shared pipeline phases. Source reference: `data/wizards/new_project.json`.

### 5.8 CLI commands

`hise-cli wizard <id> --answers '<json>'` — single-shot execution.
`hise-cli wizard <id> --schema` — dump parameter schema.
`hise-cli wizard list` — list available wizards.
Subcommand aliases: `hise-cli setup` → `hise-cli wizard setup`.

**Phase 5 gate — all must pass:**
- `npm test` passes with: WizardRunner step navigation (advance, back,
  showIf, repeat groups), WizardExecutor single-shot validation + execution,
  pipeline phase sequencing with abort, setup wizard definition renders in
  ink-testing-library overlay, CLI `--answers` and `--schema` work,
  `.tape` screencast for setup wizard walkthrough
- `npm run build && npm run typecheck` pass
- Manual: `hise-cli setup` opens standalone wizard overlay

---

## Phase 6 — Remaining Modes

### 6.1 DSP (Scriptnode) mode

Tracks [#6](https://github.com/christoph-hart/hise-cli/issues/6).
Chevrotain grammar for graph editing, nodes from `scriptnodeList.json`.
Shares token types with builder mode grammar (quoted strings, dot-paths,
identifiers, numbers). Requires
[#12](https://github.com/christoph-hart/hise-cli/issues/12)
for new dsp endpoints.

### 6.2 Script mode — full implementation

Tracks [#8](https://github.com/christoph-hart/hise-cli/issues/8).
Multi-line support (unclosed brackets — detected via Lezer parse tree),
`_` for last result, `/api` inline help (rendered as `markdown`
CommandResult), syntax highlighting in input field (Lezer tokenizer →
chalk-colored `<Text>` spans in custom input component).

**Variable watch** (see
[DESIGN.md — Script Mode / Variable Watch](DESIGN.md#variable-watch)):

- Engine: `src/engine/modes/script-watch.ts` — polls
  `GET /api/inspect/watch_variables`, parses hierarchical debug info,
  applies glob/type filters client-side (glob matching via `picomatch`)
- TUI: sidebar panel or toggled split view with live-updating table.
  Type badges (R/V/C/G/N) in color. Expandable object/array children.
  `/watch [glob]` to toggle and filter.
- Configurable polling interval (default 500ms, matching HISE IDE)
- Depends on `GET /api/inspect/watch_variables` — new endpoint in
  [#12](https://github.com/christoph-hart/hise-cli/issues/12)

### 6.3 Inspect mode — full implementation

Tracks [#7](https://github.com/christoph-hart/hise-cli/issues/7).
Live monitoring (cpu, midi) via SSE subscriptions when available, with
polling `GET /api/inspect/cpu` at 500ms intervals as fallback (SSE is
not yet implemented in HISE C++ — see DESIGN.md SSE Status). The polling
fallback ships in 1.0; SSE upgrade is transparent when
[#12](https://github.com/christoph-hart/hise-cli/issues/12) delivers it.

### 6.4 Sampler mode

Tracks [#11](https://github.com/christoph-hart/hise-cli/issues/11).
Selection-based workflow, sample map management, complex group manager.
Requires [#12](https://github.com/christoph-hart/hise-cli/issues/12).

### 6.5 Project, Compile, Import modes

Tracks [#9](https://github.com/christoph-hart/hise-cli/issues/9).

**Phase 6 gate — all must pass:**
- `npm test` passes with: DSP mode Chevrotain grammar, script mode
  multi-line detection + `/api` help + watch polling, inspect mode polling
  fallback, sampler mode grammar + selection commands, project/compile/import
  mode parsers
- All modes have at least one `.tape` screencast test
- `npm run build && npm run typecheck` pass

---

## Phase 7 — Polish

### 7.1 Command Palette (Ctrl+Space)

Tracks [#10](https://github.com/christoph-hart/hise-cli/issues/10).
Filterable overlay showing all modes and commands.

### 7.2 Remaining wizards

Tracks [#15](https://github.com/christoph-hart/hise-cli/issues/15).
Broadcaster, export, compile-networks, install-package, update, migrate, nuke.

### 7.3 CLI frontend

File: `src/cli/index.ts`

Non-interactive, argument-based invocation with structured JSON output.
Uses the same `Session` and `Mode` infrastructure.

### 7.4 SSE event streaming

Upgrade inspect mode and wizard pipelines from polling to SSE push when
available. Non-blocking — 1.0 ships with polling fallback. SSE is an
enhancement when [#12](https://github.com/christoph-hart/hise-cli/issues/12)
delivers the `GET /api/events` endpoint.

**Phase 7 gate (1.0 release gate) — all must pass:**
- `npm run build && npm run typecheck && npm test` all pass
- All modes have tests and at least one `.tape` screencast
- Command palette opens and filters correctly
- CLI frontend `src/cli/index.ts` produces structured JSON output
- Remaining wizards (broadcaster, export, compile-networks) render and
  execute in both TUI and CLI modes
- Manual: full end-to-end walkthrough with live HISE covering all modes

---

## Post-1.0 — Web Frontend

> Deferred from the 1.0 release. The isomorphic engine constraint (Phase 0)
> keeps the door open. This section is included for architectural context.

**Goal**: browser-based frontend sharing the engine layer. Terminal aesthetic
via monospace CSS. Three targets, implemented incrementally.

See [DESIGN.md — Web Frontend](DESIGN.md#web-frontend-future) and
[DESIGN.md — Decision #13](DESIGN.md#13-isomorphic-engine-for-web-compatibility).

### 8.1 Web shell

Directory: `src/web/`

React DOM app (Vite) that renders engine `Session` state in the browser.
Monospace CSS replicating the TUI aesthetic:

- Monospace font (`JetBrains Mono` / `Fira Code` / system fallback)
- All 4 color layers as CSS custom properties (same hex values as TUI)
- Layout regions (TopBar, Output, Input, StatusBar) as flexbox divs
- Box-drawing characters (`─`, `│`, `├`, `└`, `▎`) rendered natively
- Mode-colored prompts, type badges, tree connectors — all CSS
- Cursor blinking via CSS animation

Web superpowers beyond what the TUI can do:
- Hover tooltips on module types, API methods
- Clickable elements (expand trees, navigate to definitions)
- Resizable panes (sidebar, output split)
- Smooth scrolling
- Copy-to-clipboard buttons on code blocks
- Syntax highlighting via CodeMirror 6 using the same Lezer HiseScript
  grammar from the engine — zero additional parser work
- Markdown rendering via `react-markdown` or similar, consuming the same
  `marked` AST from the engine

### 8.2 Mock playground

The demo/playground — a standalone web app with `MockHiseConnection` and
bundled static datasets. No HISE instance needed.

- Interactive command entry with tab completion
- Mode switching, wizard walkthrough
- Module type browser (all modules with parameters from `data/moduleList.json`)
- API reference browser (all classes/methods from `data/scripting_api.json`)
- Scriptnode node browser (all nodes/factories from `data/scriptnodeList.json`)
- Deployable to GitHub Pages, Vercel, or similar static hosting

### 8.3 Live companion

Connect to a real HISE instance at configurable `host:port`. Uses
`HttpHiseConnection` (same `fetch()` API, works in browser).

- Full REPL functionality against live HISE
- Variable watch with live updates
- Module tree visualization
- Requires HISE on same machine (localhost) or network-accessible

### 8.4 Screencast live replay

Replace the asciinema-player on the HISE docs site with the live engine
replay. The same `.tape` files from `screencasts/` now drive the actual
engine `Session` with `MockHiseConnection` in the browser. Screencasts
become interactive — visitors see real syntax highlighting, real
completions, real mode transitions. `Annotation` commands render as
overlay captions. Visitors can pause and optionally take over typing.

This reuses the web shell (8.1) + mock playground (8.2) infrastructure.
The tape parser is already in the engine layer (isomorphic). The only
new code is the playback controller that feeds tape commands to the
Session at the scripted timing.

### Future: Remote access

Requires C++ changes (HISE binding to `0.0.0.0`, authentication) and
SSE/WebSocket for efficient push. Not in current scope.

### Future: Plugin UI testing via tape sessions

The `.tape` screencast format can be extended to drive UI tests for HISE
plugins. The same declarative structure that describes terminal interactions
(type, wait, assert output) maps naturally to plugin-level UI testing:

```tape
# Test page switching
Click "EffectsButton"
Wait 100ms
Assert Visible "EffectsPage"
Assert Hidden "MainPage"

Click "MainPageButton"
Wait 100ms
Assert Visible "MainPage"
Assert Hidden "EffectsPage"

# Test knob interaction
Set "CutoffKnob" 0.75
Assert Value "CutoffKnob" 0.75
Assert Connected "CutoffKnob" "SimpleFilter.Frequency"
```

New tape commands for plugin testing:

- `Click "<componentId>"` — simulate click on a UI component
- `Set "<componentId>" <value>` — set a component's value
- `Assert Visible "<componentId>"` — check component is visible
- `Assert Hidden "<componentId>"` — check component is not visible
- `Assert Value "<componentId>" <value>` — check component value
- `Assert Connected "<componentId>" "<processorId>.<param>"` — verify parameter connection
- `SendMidi NoteOn <note> <velocity>` — send MIDI into the plugin
- `SendMidi NoteOff <note>` — release a note
- `Wait <duration>` — already exists in the tape format

The tape parser (`src/engine/screencast/tape-parser.ts`) is isomorphic and
extensible. The execution backend would use the HISE runtime API
(`set_component_value`, `get_component_properties`, `screenshot`) instead of
terminal keystrokes, but the parser, test runner, and assertion framework
are shared infrastructure. Plugin developers could ship `.tape` files as
regression tests alongside their HISE projects.

---

## Dependencies on HISE C++ work

[#12](https://github.com/christoph-hart/hise-cli/issues/12) tracks all new
REST API endpoints. This work proceeds in parallel on the HISE side.

| hise-cli feature | Required HISE endpoint | Phase blocked |
|------------------|----------------------|---------------|
| Script mode (basic) | `POST /api/repl` (exists) | None — works now |
| Script mode (recompile) | `POST /api/recompile` (exists) | None — works now |
| Script mode (diagnostics) | `POST /api/diagnose_script` (exists) | None — works now |
| Script mode (file list) | `GET /api/get_included_files` (exists) | None — works now |
| Inspect mode (basic) | `GET /api/status` (exists) | None — works now |
| Connection probe | `GET /api/status` (exists, returns 503 while loading) | None — works now |
| Builder execution | `POST /api/builder/add`, `/remove`, `/move`, `/set` | Phase 4 |
| Plan validation | `POST /api/builder/add` with `validate: true` | Phase 4 |
| Module tree fetch | `GET /api/builder/tree` | Phase 4 |
| Variable watch | `GET /api/inspect/watch_variables` (new) | Phase 6 |
| DSP mode | `POST /api/dsp/*` | Phase 6 |
| Sampler mode | `POST /api/sampler/*` | Phase 6 |
| SSE events | `GET /api/events` (not yet implemented in C++) | Phase 6-7 |

Phases 0–3 require **no new C++ endpoints**. Everything uses existing APIs
or local validation against static datasets.

---

## File disposition

| Current file | Status | Notes |
|---|---|---|
| `src/index.ts` | Modified in Phase 2.7 | Rewired to new TUI |
| `src/app.tsx` | Reference | Legacy pipe-based REPL |
| `src/pipe.ts` | Reference | Legacy named pipe transport |
| `src/theme.ts` | Reference | Monokai colors → replaced by `src/tui/theme.ts` |
| `src/hooks/usePipe.ts` | Reference | Legacy pipe hook |
| `src/hooks/useCommands.ts` | Reference | History logic reused |
| `src/menu/App.tsx` | Reference | Temporary menu until wizard menu (Phase 5) |
| `src/components/*` | Reference | Scrollbar logic may be reused |
| `src/setup/*` | Reference | Pipeline phases reused in Phase 5.6 |
| `src/setup-core/*` | Reference | Types + GitHub helpers reused |

<!-- All design questions resolved — see "Resolved Design Decisions" at top -->
