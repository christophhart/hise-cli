# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview — hise-cli

Modal REPL and CLI for [HISE](https://hise.dev), an open-source framework for building
audio plugins. Two frontends (TUI for humans, CLI for LLMs) share one engine layer.

## Key Concepts

**Smart client**: The CLI validates locally using shipped JSON datasets in `data/`
(module types, parameter ranges, chain constraints, API signatures) and delegates
execution to HISE. See [DESIGN.md](DESIGN.md) for the full architecture.

**HISE communication**: HTTP REST API on `localhost:1900` (request/response). SSE for
push events is planned but not yet implemented in HISE C++ - polling is the 1.0 fallback.

**Three-layer design**: `engine/` (zero UI deps), `tui/` (inline Ink REPL),
`cli/` (JSON output). The engine layer must never import Ink, React, or terminal
libraries. The TUI is a sticky-bottom inline shell — no alt-screen, no full-screen
layout. Output blocks commit to scrollback via Ink `<Static>`. Tree panel toggles
above the prompt with **Ctrl+B**; `/compact` (builder mode) flattens chains.

**Isomorphic engine** (`src/engine/`): zero `node:` imports — no `node:fs`, `node:path`,
`node:child_process`. Platform-specific operations use `DataLoader` (filesystem access)
and `PhaseExecutor` (shell execution) interfaces. See [DESIGN.md](DESIGN.md) Decision #13.

**Static datasets** in `data/`: `moduleList.json` (module types + parameters),
`scriptnodeList.json` (scriptnode factories + nodes), `scripting_api.json` (HiseScript
API classes + methods). Used for tab completion, local validation, and inline help.
See `src/engine/data.ts` for type definitions.

**Wizard framework**: Declarative multi-step workflows for complex operations (broadcaster
setup, asset payloads, monolith encoding, plugin export, HISE installation). Same
definition serves TUI (step-by-step form rendered inline in the output log) and
CLI (single-shot with `--answers` JSON).
Source wizard JSONs from HISE's C++ multipage dialogs live in
`data/wizards/`. Conversion guide: [docs/WIZARD_CONVERSION.md](docs/WIZARD_CONVERSION.md).

**Pre-1.0 policy**: Before `1.0.0`, stale systems are removed aggressively. Do not preserve
backwards compatibility for obsolete commands, files, or APIs. Keep only explicit reference
material when useful for reimplementation.

**REST-first development**: Follow [MODE_DEVELOPMENT.md](MODE_DEVELOPMENT.md) for the
canonical mode workflow: contract probing, shared mock runtime support, engine work
against normalized mock payloads, and live parity tests. For new HISE REST endpoints,
pair that workflow with the C++ endpoint work tracked in [ROADMAP.md](ROADMAP.md).

**Terminal markdown renderer**: Renders markdown via `marked` + `marked-terminal`
with syntax-highlighted code blocks. Pre-rendered to ANSI strings once via
`renderMarkdown()` in `src/tui/markdown.ts`, then committed to scrollback via
Ink `<Static>` (no virtualization needed in inline shell — terminal handles scroll).

## Build & Verify

```bash
npm run build          # esbuild bundle → dist/index.js
npm run typecheck      # tsc --noEmit
npm run test           # vitest run
npm run dev            # build + start
```

All three gates (build, typecheck, test) must pass.

### Running individual tests

```bash
npx vitest run src/engine/modes/builder.test.ts   # single file
npx vitest run -t "test name pattern"             # by test name
npm run test:watch                                # watch mode
```

### Specialized test suites

```bash
npm run test:live-contract          # requires HISE running on :1900
npm run test:live-contract:inspect  # just inspect contract tests
npm run test:live-contract:script   # just script contract tests
npm run test:screencasts            # requires npm run build first, 60s timeout
```

Live contract tests live in `src/live-contract/**/*.live.test.ts`. Screencast tests
use a separate vitest config (`vitest.screencast.config.ts`).

**HISE source reference**: Clone `https://github.com/christoph-hart/HISE` (without
`--recurse-submodules`) into `hise-source/` for C++ source inspection. This directory
is gitignored — it is a local reference, not tracked.

## Release pipeline

Tag-triggered builds via `.github/workflows/release.yml`. Pushing a tag matching
`v*` runs two parallel jobs on self-hosted runners:

- **macOS** (`[self-hosted, macOS]`) → universal2 binary (lipo arm64 + x64) →
  codesign with hardened runtime → `pkgbuild` → notarize + staple →
  uploads `hise-cli.pkg` to the GitHub Release.
- **Windows** (`[self-hosted, Windows]`) → bun-compiled `hise-cli.exe` →
  Inno Setup compile (`installer/hise-cli.iss`) → uploads
  `hise-cli-setup.exe` to the same release.

`workflow_dispatch` is enabled for build-only smoke tests on a branch — those
runs upload artifacts but skip the GitHub Release publish step.

`hise-cli update` (in `src/cli/update.ts`) is the in-binary self-updater. It
resolves the latest tag via the `/releases/latest` redirect (no GitHub API
auth, no rate limit), downloads the platform installer, and runs it: macOS
`sudo installer -pkg`, Windows silent installer with the rename trick (rename
running `.exe` → `.exe.old`, run `setup.exe /VERYSILENT`). Auto-check fires
2s into TUI launch only — CLI invocations stay silent so LLM agents don't
make extra network calls.

### Web SPA embedding

The bun-compiled binary serves the `--web` SPA from memory, not disk.
`scripts/embed-web-assets.mjs` walks `dist/web/` after the SPA build and emits
`src/web/embedded-assets.ts` (gitignored) — a `Map<string, Uint8Array>` of all
assets, base64-encoded for the JS bundle, decoded once at startup. The build
chain order is:

```
build-web.mjs → embed-web-assets.mjs → build-embed.mjs → esbuild
```

### Self-hosted runner setup

One-time bootstrap per machine — see [docs/RUNNER_SETUP.md](docs/RUNNER_SETUP.md).
Without it, signing / notarization / Inno Setup steps will fail.

## Project Structure

```
src/
  index.ts             # Entry point (TUI launcher + one-shot CLI)
  engine/              # Shared core - zero UI deps, zero node: imports
    commands/          # Command registry, dispatcher, parsers
    modes/             # Mode definitions
    completion/        # Tab completion engine
    highlight/         # Syntax highlighting: per-mode tokenizers, span splitting
    screencast/        # .tape parser (isomorphic)
    session.ts         # Mode stack, history, connection
    result.ts          # CommandResult + TreeNode types
    hise.ts            # HiseConnection interface + HttpHiseConnection + Mock
    data.ts            # DataLoader interface
  tui/                 # Inline (sticky-bottom) Ink REPL shell
    InlineApp.tsx      # Main shell: <Static> scrollback + status line + prompt
    launch.ts          # Boots Session, mounts InlineApp, prints banner
    banner.ts          # Static ASCII logo + version + update badge
    Input.tsx, CompletionPopup.tsx, prerender.ts, markdown.ts,
    script-log.ts, wizard-render.ts, wizard-keys.ts, useWizardState.ts
    theme.ts           # Hardcoded monokai constants + darken/lighten/lerp helpers
    observer.ts        # Local HTTP server piping CLI invocations into the shell
    nodeDataLoader.ts, nodeHiseLauncher.ts, nodePhaseExecutor.ts,
    bundledDataLoader.ts  # Node platform implementations
    wizard-handlers/   # Wizard task handler bindings (setup, update, compile, ...)
    wizard-files.ts    # Path completion for wizard file fields
    screencast/        # Tape runner, asciicast writer, vitest tester
  cli/                 # CLI execution, args, help, observer client
  globals.d.ts         # Build-time constants (__APP_VERSION__)
data/                  # Static JSON datasets (not in src/)
  wizards/             # HISE C++ multipage dialog JSONs (conversion source)
scripts/build.mjs      # esbuild config
screencasts/           # VHS-derived .tape scripts
```

New code follows the `engine/` / `tui/` / `cli/` split.

## Documentation Rules

**Source code is the single truth** for exact values, counts, interface definitions,
hex colors, and implementation details. Design docs describe *what and why* (architecture,
visual intent, design decisions). Never duplicate into docs:

- Exact test counts, file counts, method counts, line counts
- TypeScript interface or type definitions (reference the source file instead)
- Hex color values (live in `src/tui/theme.ts` and `src/engine/highlight/tokens.ts`)
- Full directory listings of every file (use structural descriptions with brief purpose)
- Code examples that mirror actual source (they become stale immediately)

When referencing implementation details, point to the source file location:
`see src/engine/modes/mode.ts for the full interface`.

## Conventions

For full code style reference, see [docs/CODE_STYLE.md](docs/CODE_STYLE.md).

### Critical formatting rules

- **Tabs** (not spaces), **double quotes**, **semicolons required**, trailing commas in multi-line
- `camelCase.ts` for files, `PascalCase.tsx` for React components
- Interfaces over enums; string literal unions; `as const` assertions
- Error handling: `try/catch`, extract with `String(error)`, return `null`/`false` for "not found"

### TypeScript config

- Target ES2022, module Node16, strict mode enabled
- `.js` extensions required on local imports (Node16 module resolution)

### Project rules

- **Git commits**: lowercase, terse, no conventional-commits prefix
- **No default exports** — named exports only
- **ESM only** — `.js` extensions on local imports, `node:` prefix on builtins
  (except in `src/engine/` where `node:` imports are forbidden)
- **Test files**: colocated next to source (`session.test.ts` next to `session.ts`)
- **Help text sync**: when adding or changing commands, modes, or wizards, update
  both `src/engine/commands/help.ts` (TUI `/help`) and `src/cli/help.ts` (CLI `--help`).
  The CLI help is the primary reference for LLM consumers — it must include full
  syntax, examples, and all available subcommands.
- **Ink imports**: TUI components import `Box`, `Text`, and hooks directly
  from `"ink"`.
- **Key input debugging**: see [docs/CODE_STYLE.md](docs/CODE_STYLE.md) § Debugging
