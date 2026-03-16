# AGENTS.md — hise-cli

Modal REPL and CLI for [HISE](https://hise.dev), an open-source framework for building
audio plugins. Two frontends (TUI for humans, CLI for LLMs) share one engine layer.

## Key Concepts

**Smart client**: The CLI validates locally using shipped JSON datasets in `data/`
(module types, parameter ranges, chain constraints, API signatures) and delegates
execution to HISE. See [DESIGN.md](DESIGN.md) for the full architecture.

**HISE communication**: HTTP REST API on `localhost:1900` (request/response). SSE for
push events is planned but not yet implemented in HISE C++ — polling is the 1.0 fallback.
The legacy named pipe transport (`pipe.ts`, `usePipe.ts`) is scheduled for removal in
Phase 2 when the entry point is rewired.

**Three-layer design** (v2, in progress): `engine/` (zero UI deps), `tui/` (Ink/React),
`cli/` (JSON output). The engine layer must never import Ink, React, or terminal libraries.

**Isomorphic engine** (`src/engine/`): zero `node:` imports — no `node:fs`, `node:path`,
`node:child_process`. Platform-specific operations use `DataLoader` (filesystem access)
and `PhaseExecutor` (shell execution) interfaces. See [DESIGN.md](DESIGN.md) Decision #13.

**Static datasets** in `data/`: `moduleList.json` (79 modules), `scriptnodeList.json`
(194 nodes), `scripting_api.json` (89 classes, 1789 methods). Used for tab completion,
local validation, and inline help.

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
npm run test           # vitest run (available after Phase 0.1)
npm run dev            # build + start
```

`build` and `typecheck` must pass now. `test` becomes available after Phase 0.1 adds
vitest. Implementation roadmap: [ROADMAP.md](ROADMAP.md).

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

**Target** (v2 — not yet implemented, see [DESIGN.md](DESIGN.md)):
```
src/
  engine/              # Shared core — zero UI deps, zero node: imports
    commands/          # Command registry, dispatcher, parsers
    modes/             # Mode definitions (builder, script, dsp, sampler, ...)
    completion/        # Tab completion engine
    wizard/            # Wizard framework (types, runner, executor, pipeline)
    highlight/         # Lezer HiseScript grammar, XML tokenizer
    screencast/        # .tape parser (isomorphic)
  tui/                 # TUI frontend — Ink/React
    components/        # TopBar, Output, Input, CompletionPopup, StatusBar
    screencast/        # Tape runner, asciicast writer, vitest tester
  cli/                 # CLI frontend — JSON output
screencasts/           # VHS-derived .tape scripts (TUI tests + docs assets)
```

New code follows the `engine/` / `tui/` / `cli/` split.

## Conventions

For code style (formatting, imports, naming, types, React/Ink patterns, error handling),
see [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

- **Git commits**: lowercase, terse, no conventional-commits prefix
- **No default exports** — named exports only
- **ESM only** — `.js` extensions on local imports, `node:` prefix on builtins
  (except in `src/engine/` where `node:` imports are forbidden)
- **Test files**: colocated next to source (`session.test.ts` next to `session.ts`)
- **Key input debugging**: flip `DEBUG_KEYS` in `src/tui/components/Input.tsx`,
  rebuild, inspect `debug-keys.log`. See [docs/CODE_STYLE.md](docs/CODE_STYLE.md) § Debugging
