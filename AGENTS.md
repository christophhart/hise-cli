# AGENTS.md — hise-cli

Modal REPL and CLI for [HISE](https://hise.dev), an open-source framework for building
audio plugins. Two frontends (TUI for humans, CLI for LLMs) share one engine layer.

## Key Concepts

**Smart client**: The CLI validates locally using shipped JSON datasets in `data/`
(module types, parameter ranges, chain constraints, API signatures) and delegates
execution to HISE. See [DESIGN.md](DESIGN.md) for the full architecture.

**HISE communication**: HTTP REST API on `localhost:1900` (request/response) + SSE for
push events. The legacy named pipe transport (`pipe.ts`, `usePipe.ts`) is being retired.

**Three-layer design** (v2, in progress): `engine/` (zero UI deps), `tui/` (Ink/React),
`cli/` (JSON output). The engine layer must never import Ink, React, or terminal libraries.

**Static datasets** in `data/`: `moduleList.json` (79 modules), `scriptnodeList.json`
(194 nodes), `scripting_api.json` (89 classes, 1789 methods). Used for tab completion,
local validation, and inline help.

## Build & Verify

```bash
npm run build          # esbuild bundle → dist/index.js
npm run typecheck      # tsc --noEmit
npm run dev            # build + start
```

No test runner or linter configured. `npm run build` is the verification step.

## Project Structure

```
src/                   # TypeScript source (esbuild bundles to dist/)
  index.ts             # Entry point
  app.tsx              # REPL TUI main component
  pipe.ts              # LEGACY — being retired
  theme.ts             # Color constants
  components/          # Shared UI components
  hooks/               # React hooks
  menu/                # Main menu TUI
  setup/               # Setup wizard (build-from-source)
  setup-core/          # Shared setup types + GitHub helpers
data/                  # Static JSON datasets (not in src/)
scripts/build.mjs      # esbuild config
```

New code should follow the `engine/` / `tui/` / `cli/` split described in
[DESIGN.md](DESIGN.md). The engine, modal REPL modes, CLI frontend, and TUI refactor
are not yet implemented.

## Conventions

For code style (formatting, imports, naming, types, React/Ink patterns, error handling),
see [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

- **Git commits**: lowercase, terse, no conventional-commits prefix
- **No default exports** — named exports only
- **ESM only** — `.js` extensions on local imports, `node:` prefix on builtins
