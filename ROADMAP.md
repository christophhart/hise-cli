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
| Phase 4 — Builder + Plan | [#5](https://github.com/christoph-hart/hise-cli/issues/5), [#4](https://github.com/christoph-hart/hise-cli/issues/4) | Full grammar, module tree, plan submode |
| Phase 5 — Wizards | [#15](https://github.com/christoph-hart/hise-cli/issues/15) | Wizard framework + setup wizard |
| Phase 6 — Remaining Modes | [#6](https://github.com/christoph-hart/hise-cli/issues/6), [#8](https://github.com/christoph-hart/hise-cli/issues/8), [#7](https://github.com/christoph-hart/hise-cli/issues/7), [#11](https://github.com/christoph-hart/hise-cli/issues/11), [#9](https://github.com/christoph-hart/hise-cli/issues/9) | DSP, script (full), inspect, sampler, project/compile/import |
| Phase 7 — Polish | [#10](https://github.com/christoph-hart/hise-cli/issues/10), [#15](https://github.com/christoph-hart/hise-cli/issues/15) | Command palette, remaining wizards, CLI frontend |
| HISE C++ (parallel) | [#12](https://github.com/christoph-hart/hise-cli/issues/12) | New REST endpoints + SSE |
| Post-1.0 — Web Frontend | — | Browser frontend, live screencast replay |
| Future | [#13](https://github.com/christoph-hart/hise-cli/issues/13) | Wave editing + sample analysis |

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

## Phase 0 — Foundation

**Goal**: testable engine layer skeleton, HISE REST client, test infrastructure.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (engine core).

### 0.1 Project infrastructure

- Add `vitest` as devDependency
- Create `vitest.config.ts` with `.js` → `.ts` resolver plugin (required
  because the project uses Node16 `.js` extension imports that Vite's resolver
  does not handle natively)
- Add npm scripts: `"test": "vitest run"`, `"test:watch": "vitest"`
- Install engine-layer dependencies (see
  [DESIGN.md — Third-party Dependencies](DESIGN.md#third-party-dependencies)):
  `@lezer/lr`, `@lezer/common`, `@lezer/highlight`, `chevrotain`, `marked`,
  `picomatch`, `brace-expansion`, `fastest-levenshtein`
- Install TUI-layer dependencies: `ink-select-input`, `ink-box`, `cli-table3`
- Install test dependency: `ink-testing-library`

### 0.2 Engine directory structure

Test files are colocated next to their source files (e.g., `hise.test.ts`
next to `hise.ts`).

```
src/engine/
  hise.ts              HiseConnection interface + HttpHiseConnection
  hise.test.ts         Tests with MockHiseConnection
  data.ts              DataLoader interface (isomorphic static dataset access)
  data.test.ts
  session.ts           Session class (mode stack, history, connection)
  session.test.ts
  result.ts            CommandResult types (text, error, code, table, tree, markdown, empty)
  commands/
    registry.ts        CommandRegistry — slash command → handler map
    registry.test.ts
    slash.ts           Built-in slash command handlers
    slash.test.ts
  highlight/
    hisescript.grammar Lezer grammar for HiseScript (forked from JS, simplified)
    hisescript.ts      Generated parser + tokenize() wrapper
    xml.ts             Minimal XML regex tokenizer (~30 lines)
    tokens.ts          Shared token type definitions + color mapping
  screencast/
    types.ts           TapeCommand type definitions (VHS commands + extensions)
    tape-parser.ts     Parse .tape files into TapeCommand[]
    tape-parser.test.ts
  modes/
    mode.ts            Mode interface + ModeId type
    root.ts            Root mode (slash commands only)
    root.test.ts
```

**Isomorphic constraint** (see
[DESIGN.md — Decision #13](DESIGN.md#13-isomorphic-engine-for-web-compatibility)):
the engine layer must contain zero `node:` imports. Platform-specific
operations use two interfaces:

- `DataLoader` — loads `moduleList.json`, `scriptnodeList.json`,
  `scripting_api.json`. Loaded once on session creation, cached for the
  session lifetime. Node.js implementation reads from filesystem (lives
  in `src/tui/` or `src/cli/`). Browser implementation bundles the JSON
  or fetches from URL (lives in `src/web/`).
- `PhaseExecutor` — runs shell scripts for pipeline phases. Node.js only
  (`child_process.spawn`). Disabled in browser.

### 0.3 `HiseConnection` — interface + HTTP implementation

File: `src/engine/hise.ts`

```ts
interface HiseConnection {
  get(endpoint: string): Promise<HiseResponse>;
  post(endpoint: string, body: object): Promise<HiseResponse>;
  probe(): Promise<boolean>;     // GET /api/status, returns false on 503/refused
  destroy(): void;
}
```

Response types (`HiseSuccessResponse`, `HiseErrorResponse`, `HiseResponse`)
are defined in DESIGN.md — Response Format Details. Do not duplicate the
type definitions here; import them from `src/engine/hise.ts`.

`HttpHiseConnection` — `fetch()`-based, targets `localhost:1900`.
`probe()` sends `GET /api/status` (doubles as readiness check — returns 503
while HISE is still loading, verified in `RestHelpers.cpp:947-958`).

`MockHiseConnection` — configurable per-endpoint responses for tests.
Serves as the living API contract per
[DESIGN.md — Decision #9](DESIGN.md#9-tests-as-api-contract).

Tests: connection probing, GET/POST request formatting, error handling,
mock response matching.

### 0.4 `CommandResult` types

File: `src/engine/result.ts`

```ts
type CommandResult =
  | { type: "text"; content: string }
  | { type: "error"; message: string; detail?: string }
  | { type: "code"; content: string; language?: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "tree"; root: TreeNode }
  | { type: "markdown"; content: string }
  | { type: "empty" }
```

Pure data — the engine's output contract. TUI renders them visually, CLI
serializes them as JSON. The `markdown` variant is parsed by `marked` in
the engine and rendered by a custom chalk + cli-table3 renderer in the TUI
(see [DESIGN.md — Third-party Dependencies](DESIGN.md#third-party-dependencies)).

### 0.5 Build verification

Ensure the full chain passes with the new structure:
```bash
npm run build && npm run typecheck && npm test
```

The existing `src/index.ts` entry point remains untouched — it still works
and still imports the legacy code. New engine code is exercised only through
tests at this stage.

**Phase 0 gate — all must pass:**
- `npm run build` produces `dist/index.js` (legacy app still works)
- `npm run typecheck` passes with zero errors
- `npm test` passes with tests for: `HiseConnection` (probe, get, post,
  mock responses), `DataLoader` (loads all three datasets), `CommandResult`
  (type discrimination), tape parser (VHS commands + extensions)

---

## Phase 1 — Session + Mode System

**Goal**: the engine can parse commands, manage modes, route input, and talk
to HISE. Fully tested. No TUI yet — all validation through tests.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (engine core)
and [#2](https://github.com/christoph-hart/hise-cli/issues/2) (mode system).

### 1.1 Mode interface

File: `src/engine/modes/mode.ts`

```ts
type ModeId =
  | "root" | "builder" | "script" | "dsp" | "sampler"
  | "inspect" | "project" | "compile" | "import";

interface Mode {
  id: ModeId;
  name: string;
  accent: string;            // hex color from TUI_STYLE.md Layer 2
  prompt: string;            // display string, e.g. "builder", "script:Interface"
  parse(input: string, session: Session): Promise<CommandResult>;
  complete?(input: string, cursor: number): CompletionResult;
}
```

Mode accent colors from [docs/TUI_STYLE.md — Section 1.3](docs/TUI_STYLE.md):
builder `#fd971f`, script `#7aa2f7`, dsp `#66d9ef`, sampler `#a6e22e`,
inspect `#ae81ff`, project `#e6db74`, compile `#f92672`, import `#2de0a5`.

### 1.2 Session

File: `src/engine/session.ts`

The core state container that both TUI and CLI frontends consume. Class
with thin methods delegating to pure functions for testability:

```ts
class Session {
  readonly modeStack: Mode[];
  readonly history: string[];
  readonly connection: HiseConnection | null;
  projectName: string | null;

  currentMode(): Mode;
  pushMode(mode: Mode): void;
  popMode(): void;
  handleInput(raw: string): Promise<CommandResult>;
}
```

`handleInput` is the main dispatch point:
- Input starts with `/` → `CommandRegistry`
- Anything else → `currentMode().parse()`

This is the single function the TUI calls on submit and the CLI calls per
invocation. Internal logic (routing, validation) is extracted to pure
functions that the class methods delegate to, making them individually
testable without constructing a full Session.

Tests: mode push/pop, slash command routing, input dispatch to current mode,
history tracking, connection state.

### 1.3 CommandRegistry

File: `src/engine/commands/registry.ts`

Maps slash command names to handler functions. Handlers receive
`(args: string, session: Session)` and return `Promise<CommandResult>`.

Built-in slash commands for Phase 1 (see
[DESIGN.md — Slash Commands](DESIGN.md#slash-commands)):

| Command | Handler | Behavior |
|---------|---------|----------|
| `/exit` | `handleExit` | Pop mode stack. At root: signal quit. |
| `/help [topic]` | `handleHelp` | Context-sensitive help (stub initially). |
| `/clear` | `handleClear` | Return `{ type: "empty" }` — TUI interprets as clear. |
| `/modes` | `handleModes` | List available modes with descriptions. |
| `/builder` | `handleBuilder` | Push builder mode onto stack. |
| `/script [proc]` | `handleScript` | Push script mode. Optional processor arg (default: Interface). |
| `/inspect` | `handleInspect` | Push inspect mode. |
| `/project` | `handleProject` | Push project mode. |
| `/wizard [id]` | `handleWizard` | Stub — prints "not yet implemented". |

Tests: each handler, unknown command fallback, argument parsing.

### 1.4 Root mode

File: `src/engine/modes/root.ts`

The default mode when no mode is active. `parse()` returns an error for any
non-slash input ("No mode active. Type /help for available commands.").
`complete()` returns slash command completions.

### 1.5 Script mode — first live HISE interaction

File: `src/engine/modes/script.ts`

Tracks [#8](https://github.com/christoph-hart/hise-cli/issues/8) (script mode)
— partial implementation, enough to validate the transport.

```ts
parse(input: string, session: Session): Promise<CommandResult> {
  const response = await session.connection.post("/api/repl", {
    expression: input,
    moduleId: this.processorId,
  });
  // ... format response as CommandResult
}
```

Sends input to `POST /api/repl` via `HiseConnection`. Request body:
`{ moduleId: "Interface", expression: "..." }`. Response has the evaluation
result in the `value` field (not `result` — verified against
`RestHelpers.cpp:513-517`). Multi-line detection (unclosed brackets) is
deferred.

The processor ID defaults to `"Interface"` and can be overridden via
`/script <processor>`.

Tests (with `MockHiseConnection`):
- Simple expression → text result (reads `response.value`)
- Expression with error → error result (`response.success === false`)
- Console output appears in `response.logs`
- Processor ID forwarded correctly in request body
- `undefined` result normalized to string `"undefined"` by HISE

Manual verification (with running HISE): `Engine.getSampleRate()` → `44100.0`.
This is not an automated gate — `MockHiseConnection` tests are the gate.

### 1.6 Inspect mode stub

File: `src/engine/modes/inspect.ts`

Tracks [#7](https://github.com/christoph-hart/hise-cli/issues/7) (inspect mode)
— partial, demonstrates structured output.

Recognizes commands: `cpu`, `memory`, `voices`, `modules`.
Sends to `GET /api/status`. Returns formatted results as `CommandResult`
with type `table` or `tree`.

### 1.7 Builder mode stub — local validation

File: `src/engine/modes/builder.ts`

Tracks [#5](https://github.com/christoph-hart/hise-cli/issues/5) (builder mode)
— parser + validation only, no HISE execution (builder endpoints are new and
tracked in [#12](https://github.com/christoph-hart/hise-cli/issues/12)).

**Parser**: built with Chevrotain (see
[DESIGN.md — Third-party Dependencies](DESIGN.md#third-party-dependencies)).
Shared token types (quoted strings, dot-paths, identifiers, numbers) are
defined once in `src/engine/modes/tokens.ts` and reused by builder, DSP,
and sampler mode grammars. Each grammar rule is a class method, individually
testable.

Parser skeleton recognizing:
- `add <type> [as "<name>"] [to <parent>.<chain>]`
- `show tree` / `show types`
- `set <target> <param> [to] <value>`

Local validation against `data/moduleList.json`:
- Module type exists (79 types) — typos caught with `fastest-levenshtein`
  ("Did you mean 'AHDSR'?")
- Chain accepts module subtype (constrainer matching)
- Parameter name valid for module type
- Parameter value in range

This validates the smart-client concept from
[DESIGN.md — Builder Mode Validation](DESIGN.md#builder-mode-validation):
the engine catches type errors locally without a HISE round-trip.

Tests:
- Valid `add` commands parse correctly
- Invalid module type → error with suggestion (levenshtein)
- Wrong chain for subtype → error explaining the constraint
- Parameter out of range → error with valid range
- `show types` returns table of module types

**Phase 1 gate — all must pass:**
- `npm test` passes with tests for: Session (mode push/pop, input dispatch,
  slash command routing, history), CommandRegistry (each handler, unknown
  command fallback), root mode (rejects non-slash input), script mode (mock
  REPL round-trip, reads `response.value`, error handling), inspect mode
  (mock status parsing), builder mode (parser accepts valid commands, rejects
  invalid types with "Did you mean?" suggestion, validates chain constraints
  and parameter ranges)
- `npm run build && npm run typecheck` still pass

---

## Phase 2 — TUI v2 Shell

**Goal**: new TUI that renders engine `Session` state. The design becomes
tangible — you can see the color system, switch modes, interact with live HISE.

Tracks [#1](https://github.com/christoph-hart/hise-cli/issues/1) (TUI split)
and [#2](https://github.com/christoph-hart/hise-cli/issues/2) (mode prompts).

### 2.1 Color system

File: `src/tui/theme.ts`

Implements all 4 layers from
[docs/TUI_STYLE.md — Section 1](docs/TUI_STYLE.md#1-color-system):

| Layer | Content | Mutability |
|-------|---------|------------|
| 1 | HISE brand: SIGNAL `#90FFB1`, OK `#4E8E35`, WARNING `#FFBA00`, ERROR `#BB3434` | Hardcoded |
| 2 | Mode accents: 9 modes + wizard copper `#e8a060` | Hardcoded |
| 3 | Syntax highlighting: 10 token colors | Hardcoded |
| 4 | Color scheme: 5 backgrounds + 3 foregrounds | User-selectable (default: dark) |

The existing `src/theme.ts` (Monokai) is reference. The new theme module
exposes typed accessors: `brand.signal`, `accent.builder`, `syntax.keyword`,
`scheme.background.standard`, etc.

### 2.2 TUI App

File: `src/tui/app.tsx`

The new main component. Owns a `Session` instance from the engine and renders
its state:

```
┌──────────────────────────────────────────────┐
│ TopBar: HISE CLI │ project │ [mode] │ status │  ← backgroundDarker
├──────────────────────────────────────────────┤
│                                              │
│  Output area — renders CommandResult[]       │  ← background
│                                              │
├──────────────────────────────────────────────┤
│ [mode] > input                               │  ← backgroundRaised
├──────────────────────────────────────────────┤
│ StatusBar: context hints │ scroll position    │  ← backgroundDarker
└──────────────────────────────────────────────┘
```

Layout regions per
[docs/TUI_STYLE.md — Section 2](docs/TUI_STYLE.md#2-layout).

### 2.3 TopBar

File: `src/tui/components/TopBar.tsx`

Single row. Shows:
- "HISE CLI" in SIGNAL_COLOUR (`#90FFB1`) bold
- Project name (from `session.projectName` via `GET /api/status`)
- Current mode label in mode accent color (e.g. `[builder]` in orange)
- Connection status dot: `●` green (OK) / yellow (WARNING) / red (ERROR)

Replaces the existing `src/components/Header.tsx` which showed pipe names
and scroll position.

### 2.4 Output

File: `src/tui/components/Output.tsx`

Renders an array of `CommandResult` entries with type-appropriate formatting:

| Result type | Rendering |
|-------------|-----------|
| `text` | `foreground.default` |
| `error` | `brand.error` with `✗` prefix |
| `code` | Lezer-highlighted HiseScript or plain monospace |
| `table` | `cli-table3` box-drawn table with Unicode borders |
| `tree` | Indented with `├──` / `└──` connectors |
| `markdown` | Custom `marked` renderer: headings bold + SIGNAL_COLOUR, `**bold**`, `[links](url)` clickable, tables via cli-table3, code blocks via Lezer (HiseScript) or regex (XML), other languages plain |
| `empty` | Clears the output buffer |

The markdown renderer (`src/tui/markdown.ts`, ~150 lines) is a custom
`marked` renderer extension that uses chalk for formatting, cli-table3 for
tables, and our Lezer tokenizer for HiseScript code blocks. XML code blocks
use a ~30-line regex tokenizer. Other languages render without highlighting.
This replaces the `marked-terminal` → `cli-highlight` → `highlight.js`
chain (~7MB) with ~150 lines of code using libraries we already have.

Command echo lines get a left-border `▎` in the current mode's accent color
per [docs/TUI_STYLE.md — Section 3.2](docs/TUI_STYLE.md#32-output).

Scrollbar logic reused from the existing `src/components/Output.tsx`.

### 2.5 Input

File: `src/tui/components/Input.tsx`

Mode-colored prompt per
[docs/TUI_STYLE.md — Section 4.1](docs/TUI_STYLE.md#41-mode-prompts):
- Root: `> ` in `foreground.default`
- Builder: `[builder] > ` — label in orange, `>` in orange
- Script: `[script:Interface] > ` — label in blue, `>` in blue

Command history (up/down arrows) reused from `src/hooks/useCommands.ts` —
the logic is extracted into a pure function or kept as a hook in `src/tui/hooks/`.

### 2.6 StatusBar

File: `src/tui/components/StatusBar.tsx`

Bottom row. Shows:
- Context hints (mode-specific: e.g. "Tab: complete │ Ctrl+Space: palette")
- Scroll position indicator ("live" or "↑ N lines")

### 2.7 Entry point rewire

File: `src/index.ts` (modified)

New startup logic per
[DESIGN.md — Subcommand Aliases & Entry Point](DESIGN.md#subcommand-aliases--entry-point):

1. Probe `localhost:1900` with `HttpHiseConnection.probe()` (`GET /api/status`)
2. If 200 → create `Session` with live connection → render new TUI
3. If 503 → HISE is starting, wait and retry (up to 10s)
4. If connection refused → show standalone menu (setup / update / migrate / nuke / launch HISE)

The standalone menu reuses the existing `src/menu/App.tsx` selection UI
temporarily. It will be replaced by the wizard menu in Phase 5.

Legacy `src/app.tsx` (pipe-based REPL) is no longer imported but stays in the
repo as reference.

### 2.8 End-to-end verification

With a running HISE instance:

```
$ hise-cli
  → auto-detects HISE → shows new TUI with green status dot

> /script
  → prompt changes to [script:Interface] > in blue

[script:Interface] > Engine.getSampleRate()
  → shows 44100.0 in output

[script:Interface] > /exit
  → back to root prompt >

> /builder
  → prompt changes to [builder] > in orange

[builder] > add FakeModule
  → shows local validation error in red: Unknown module type "FakeModule"

[builder] > add AHDSR
  → parses successfully (no HISE execution yet)

[builder] > /exit
> /inspect
[inspect] > modules
  → shows module tree from GET /api/status
```

### 2.9 TUI integration testing + screencasts

See [DESIGN.md — Screencast Framework](DESIGN.md#screencast-framework)
and [DESIGN.md — Decision #14](DESIGN.md#14-vhs-derived-tape-format-for-screencasts-and-tui-testing).

**Screencast runner infrastructure:**

```
src/tui/screencast/
  runner.ts               Execute .tape against ink-testing-library
  writer.ts               Capture frames, write asciicast .cast files
  tester.ts               Wrap runner with vitest assertions

screencasts/              Tape files + generated .cast outputs
```

The runner parses `.tape` files (via `src/engine/screencast/tape-parser.ts`),
creates a `Session` with `MockHiseConnection`, renders the TUI in
`ink-testing-library`'s virtual terminal, feeds keystrokes via
`stdin.write()`, captures frames, and checks `Expect` / `Snapshot`
assertions. Each `.tape` file becomes a vitest test.

The writer captures timestamped frames from the same run and outputs
asciicast v2 `.cast` files (~5-10KB per 30s screencast) for the HISE
documentation site (Nuxt.js + asciinema-player).

**First screencast scripts** (double as integration tests):

```
screencasts/
  mode-switching.tape     Enter/exit modes, verify prompts and colors
  script-repl.tape        Evaluate expressions, see results (mock HISE)
  builder-validation.tape Type errors caught locally, "did you mean" suggestions
```

**npm script**: `"screencasts": "vitest run --project screencasts"` — runs
all `.tape` files as tests AND generates `.cast` files.

Each subsequent phase adds screencast scripts for its new features:
- **Phase 3**: tab completion, ghost text, completion popup
- **Phase 4**: builder workflow (add, show tree, plan, execute, export)
- **Phase 5**: wizard walkthrough (setup wizard step by step)

**Phase 2 gate — all must pass:**
- `npm run build` produces working `dist/index.js` with the new TUI
- `npm run typecheck` passes
- `npm test` passes including: ink-testing-library tests for TopBar,
  Output, Input, StatusBar components; at least 3 `.tape` screencast
  tests run as vitest tests (mode-switching, script-repl, builder-validation)
- Manual verification with live HISE completes the Phase 2.8 scenario

---

## Phase 3 — Tab Completion

**Goal**: instant feedback from the static datasets. Validates the smart-client
concept for humans.

Tracks [#3](https://github.com/christoph-hart/hise-cli/issues/3).

### 3.1 Completion engine

File: `src/engine/completion/engine.ts`

Consumes the three static datasets:
- `data/moduleList.json` — 79 module types, parameters, chains
- `data/scriptnodeList.json` — 194 nodes, 12 factories
- `data/scripting_api.json` — 89 classes, 1789 methods

Mode-aware completions:
- Root: slash commands (`/builder`, `/script`, `/help`, ...)
- Builder: module types, chain names, parameter names, module instances
- Script: API namespaces, method names, property names
- DSP: node factories, node types

### 3.2 Completion popup

File: `src/tui/components/CompletionPopup.tsx`

Per [docs/TUI_STYLE.md — Section 3.5](docs/TUI_STYLE.md#35-completionpopup):
floating box above the input field, max 8 items visible, arrow keys to
navigate, Tab to accept, Escape to dismiss. Selected item highlighted in
SIGNAL_COLOUR. Uses `ink-select-input` for list selection logic; positioning
and ghost text rendering are custom.

### 3.3 Integration

Wire `Mode.complete()` to the completion engine. The Input component triggers
completion on Tab press and renders the popup.

**Phase 3 gate — all must pass:**
- `npm test` passes with: completion engine returns correct candidates for
  all modes (unit tests), CompletionPopup renders in ink-testing-library,
  `.tape` screencast for tab completion UX
- `npm run build && npm run typecheck` pass

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
Chevrotain grammar for graph editing, 194 nodes from `scriptnodeList.json`.
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
- Module type browser (79 modules with parameters)
- API reference browser (89 classes, 1789 methods)
- Scriptnode node browser (194 nodes, 12 factories)
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
