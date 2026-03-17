# AGENTS.md — hise-cli

Modal REPL and CLI for [HISE](https://hise.dev), an open-source framework for building
audio plugins. Two frontends (TUI for humans, CLI for LLMs) share one engine layer.

## Key Concepts

**Smart client**: The CLI validates locally using shipped JSON datasets in `data/`
(module types, parameter ranges, chain constraints, API signatures) and delegates
execution to HISE. See [DESIGN.md](DESIGN.md) for the full architecture.

**HISE communication**: HTTP REST API on `localhost:1900` (request/response). SSE for
push events is planned but not yet implemented in HISE C++ — polling is the 1.0 fallback.
The legacy named pipe transport (`pipe.ts`, `usePipe.ts`) is superseded by HTTP but
retained as reference until the entry point is fully rewired.

**Three-layer design** (v2, in progress): `engine/` (zero UI deps), `tui/` (Ink/React),
`cli/` (JSON output). The engine layer must never import Ink, React, or terminal libraries.

**Isomorphic engine** (`src/engine/`): zero `node:` imports — no `node:fs`, `node:path`,
`node:child_process`. Platform-specific operations use `DataLoader` (filesystem access)
and `PhaseExecutor` (shell execution) interfaces. See [DESIGN.md](DESIGN.md) Decision #13.

**Static datasets** in `data/`: `moduleList.json` (module types + parameters),
`scriptnodeList.json` (scriptnode factories + nodes), `scripting_api.json` (HiseScript
API classes + methods). Used for tab completion, local validation, and inline help.
See `src/engine/data.ts` for type definitions.

**Wizard framework**: Declarative multi-step workflows for complex operations (broadcaster
setup, asset payloads, monolith encoding, plugin export, HISE installation). Same
definition serves TUI (step-by-step overlay) and CLI (single-shot with `--answers` JSON).
Standalone wizards (setup, update, migrate, nuke) replace the current `src/setup/` and
`src/menu/` code. Source wizard JSONs from HISE's C++ multipage dialogs live in
`data/wizards/`. Conversion guide: [docs/WIZARD_CONVERSION.md](docs/WIZARD_CONVERSION.md).

## Build & Verify

```bash
npm run build          # esbuild bundle → dist/index.js
npm run typecheck      # tsc --noEmit
npm run test           # vitest run
npm run dev            # build + start
```

All three gates must pass. Implementation roadmap: [ROADMAP.md](ROADMAP.md).

**HISE source reference**: Clone `https://github.com/christoph-hart/HISE` (without
`--recurse-submodules`) into `hise-source/` for C++ source inspection. This directory
is gitignored — it is a local reference, not tracked.

## Project Structure

**Current** (legacy — functional, shipped as v0.x):
```
src/                   # TypeScript source (esbuild bundles to dist/)
  index.ts             # Entry point (rewired in Phase 2)
  app.tsx              # LEGACY — pipe-based REPL TUI
  pipe.ts              # LEGACY — named pipe transport (removed in Phase 2)
  theme.ts             # LEGACY — Monokai color constants
  components/          # LEGACY — shared UI components
  hooks/               # LEGACY — React hooks (useCommands history logic reusable)
  menu/                # LEGACY — main menu (replaced by wizard menu)
  setup/               # LEGACY — setup wizard (pipeline phases reused in Phase 5)
  setup-core/          # LEGACY — types + GitHub helpers
data/                  # Static JSON datasets (not in src/)
  wizards/             # HISE C++ multipage dialog JSONs (conversion source)
scripts/build.mjs      # esbuild config
```

**Target** (v2 — engine/ and tui/ implemented through Phase 3 + UX polish, cli/ pending):
```
src/
  engine/              # Shared core — zero UI deps, zero node: imports
    commands/          # Command registry, dispatcher, parsers
    modes/             # Mode definitions + dummy module tree for dev
    completion/        # Tab completion engine
    wizard/            # Wizard framework (planned — Phase 5)
    highlight/         # Syntax highlighting: per-mode tokenizers, span splitting
    screencast/        # .tape parser (isomorphic)
    session.ts         # Mode stack, history, connection
    result.ts          # CommandResult + TreeNode types
    hise.ts            # HiseConnection interface + HttpHiseConnection + Mock
    data.ts            # DataLoader interface
  tui/                 # TUI frontend — Ink/React
    components/        # TopBar, Output, Input, CompletionPopup, StatusBar,
                       #   Overlay, scrollbar, TreeSidebar, LandingLogo
    theme.ts           # Color system, darkenHex, lightenHex, lerpHex, mix
    theme-context.tsx  # ThemeProvider, useTheme() hook
    app.tsx            # Main TUI shell (central key dispatch)
    nodeDataLoader.ts  # Node.js DataLoader implementation
    screencast/        # Tape runner, asciicast writer, vitest tester (planned)
  cli/                 # CLI frontend — JSON output (planned — Phase 7)
  globals.d.ts         # Build-time constants (__APP_VERSION__)
screencasts/           # VHS-derived .tape scripts (planned)
```

New code follows the `engine/` / `tui/` / `cli/` split.

## Documentation Rules

**Source code is the single truth** for exact values, counts, interface definitions,
hex colors, and implementation details. Design docs describe *what and why* (architecture,
visual intent, design decisions). Never duplicate into docs:

- Exact test counts, file counts, method counts, line counts
- TypeScript interface or type definitions (reference the source file instead)
- Hex color values (except in TUI_STYLE.md Layer 1-3 design spec tables)
- Full directory listings of every file (use structural descriptions with brief purpose)
- Code examples that mirror actual source (they become stale immediately)

When referencing implementation details, point to the source file location:
`see src/engine/modes/mode.ts for the full interface`.

## Conventions

For code style (formatting, imports, naming, types, React/Ink patterns, error handling),
see [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

- **Git commits**: lowercase, terse, no conventional-commits prefix
- **No default exports** — named exports only
- **ESM only** — `.js` extensions on local imports, `node:` prefix on builtins
  (except in `src/engine/` where `node:` imports are forbidden)
- **Test files**: colocated next to source (`session.test.ts` next to `session.ts`)
- **Key input debugging**: see [docs/CODE_STYLE.md](docs/CODE_STYLE.md) § Debugging
