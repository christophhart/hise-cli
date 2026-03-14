# AGENTS.md — hise-cli

> Guidelines for AI coding agents working in this repository.

## Project Overview

Interactive CLI tool for [HISE](https://hise.dev) (audio plugin framework). Built with
TypeScript, React/Ink (terminal UI), and Node.js ESM. Three modes: REPL (HTTP REST
communication with HISE on localhost:1900), setup wizard (multi-phase build from source),
and main menu.

## Build & Run Commands

```bash
npm run build          # tsc — compile src/ → dist/
npm run start          # node dist/index.js
npm run dev            # tsc && node dist/index.js
```

There is no test runner, linter, or formatter configured. Verify changes compile cleanly
with `npm run build`. TypeScript strict mode is the primary safety net.

## Project Structure

```
src/
  index.ts             # Entry point — CLI arg parsing, subcommand dispatch
  app.tsx              # REPL TUI main component
  pipe.ts              # PipeConnection class (legacy, being replaced by HTTP)
  theme.ts             # MONOKAI color theme constants
  components/          # Shared REPL UI components (Header, Input, Output, Progress)
  hooks/               # React hooks (useCommands, usePipe)
  menu/                # Main menu TUI (App.tsx)
  setup/               # Setup wizard TUI + logic
    App.tsx             # Wizard orchestrator
    detect.ts           # Platform/tool detection
    phases.ts           # Build phase definitions (per-platform shell scripts)
    runner.ts           # Phase runner (spawns scripts, logging)
    components/         # Wizard screens (Config, Detect, Prereq, Run, Complete)
  setup-core/           # Shared setup types and GitHub API helpers
    types.ts            # Central type definitions
    github.ts           # GitHub Actions CI status, Faust version fetching
```

## Code Style

### Formatting

- **Tabs** for indentation (not spaces)
- **Double quotes** for all strings
- **Semicolons** required at end of statements
- **Trailing commas** in multi-line structures (arrays, objects, parameters)
- No formatter config exists — follow the existing patterns exactly

### Imports

- **ESM only** (`"type": "module"` in package.json)
- Local imports **must** use `.js` extensions: `import { foo } from "./bar.js"`
- Node built-ins use `node:` prefix: `import * as fs from "node:fs"`
- Use `import type` or inline `type` keyword for type-only imports:
  ```ts
  import type { PipeConnection } from "./pipe.js";
  import { type MenuChoice } from "../setup-core/types.js";
  ```
- **Import ordering**:
  1. Node built-in modules (`node:fs`, `node:path`, etc.)
  2. Third-party packages (`chalk`, `ink`, `react`)
  3. Local/project imports (`./pipe.js`, `../theme.js`)
- Use namespace imports (`import * as fs`) for Node builtins; named destructuring
  for everything else

### Naming Conventions

| Kind | Convention | Examples |
|------|-----------|----------|
| Files (modules/hooks) | `camelCase.ts` | `usePipe.ts`, `detect.ts` |
| Files (components) | `PascalCase.tsx` | `Header.tsx`, `ConfigScreen.tsx` |
| Functions / hooks | `camelCase` | `sendCommand`, `usePipe` |
| React components | `PascalCase` | `App`, `Header`, `RunScreen` |
| Interfaces | `PascalCase` (no `I` prefix) | `AppProps`, `SetupConfig` |
| Type aliases | `PascalCase` | `Platform`, `OutputLineType` |
| Module-level constants | `SCREAMING_SNAKE_CASE` | `PIPE_PREFIX`, `MONOKAI` |
| Local constants | `camelCase` | `startTime`, `visibleLines` |

### Types

- Use `interface` for object shapes (props, data structures)
- Use `type` for unions and aliases: `type Platform = "windows" | "macos" | "linux"`
- Use string literal unions instead of TypeScript `enum`
- Use `as const` assertions for constant objects/arrays
- Shared types live in `setup-core/types.ts`; co-locate types when only used by one module
- Return types are inferred — don't annotate unless the signature is ambiguous
- Use generics sparingly (see `fetchJSON<T>` in `github.ts` for the pattern)

### React / Ink Patterns

- **Functional components only** — no class components
- **Named exports only** — no default exports: `export function App() { ... }`
- **One component per file**
- Props interfaces named `{ComponentName}Props`, defined immediately above the component
- `useCallback` with proper dependency arrays for event handlers
- `useRef` for mutable values that must not trigger re-renders
- `useEffect` with cleanup (return unsubscribe functions)
- `useInput` (Ink hook) for keyboard handling
- State is local `useState` only — no external state libraries

### Error Handling

- Wrap in `try/catch`; extract messages with `String(error)` (never assume `Error` instance)
- Empty `catch` blocks are acceptable for non-fatal operations — add a comment explaining why:
  ```ts
  try { ... } catch { /* Not fatal. */ }
  ```
- Return `null` or `false` for "not found" cases rather than throwing
- Fatal CLI errors: print with `chalk.red()`, optional hint with `chalk.dim()`,
  then `process.exit(1)`
- Surface errors in UI via state (e.g., output lines with `"error"` type)
- No custom error classes — use plain `Error` or string messages

### Comments

- **Section dividers** use em-dash style (~72 chars wide):
  ```ts
  // ── Section Title ───────────────────────────────────────────────────
  ```
- Inline comments explain **why**, not what
- JSDoc used sparingly (only for public-facing classes/functions that benefit from it)
- No commented-out code; no TODO comments in the codebase

### General Patterns

- **Platform-aware code**: use `process.platform` checks with per-platform branches
  (Windows / macOS / Linux)
- **Listener/unsubscribe pattern**: `PipeConnection.onMessage()` returns an unsubscribe
  function — follow this pattern for new event sources
- Classes are used sparingly — only `PipeConnection` and `SetupLogger`
- Feature directories contain their own `App.tsx` as the feature root component
- Constants are co-located at the top of the file or in shared modules (`theme.ts`)

## Git Conventions

- Commit messages: lowercase, terse, no conventional-commits prefix
- Examples: `"added setup.hise.dev functionality"`, `"migrate to ink"`

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `ink` | React-based terminal UI framework |
| `chalk` | Terminal string coloring |
| `ink-spinner` | Loading spinner component |
| `ink-text-input` | Text input component |
| `react` | Component rendering (via Ink) |
| `typescript` | Compiler (strict mode, ES2022 target, Node16 module) |

## tsconfig Essentials

- `target`: ES2022
- `module` / `moduleResolution`: Node16
- `jsx`: react-jsx (automatic transform, `jsxImportSource: "react"`)
- `strict`: true
- `rootDir`: src/ → `outDir`: dist/
