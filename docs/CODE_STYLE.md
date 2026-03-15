# Code Style — hise-cli

> TypeScript, React/Ink, and engine conventions for this repository.

## Formatting

- **Tabs** for indentation (not spaces)
- **Double quotes** for all strings
- **Semicolons** required at end of statements
- **Trailing commas** in multi-line structures (arrays, objects, parameters)
- No formatter config exists — follow the existing patterns exactly

## Imports

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

## Naming Conventions

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

## Types

- Use `interface` for object shapes; `type` for unions and aliases
- Use string literal unions instead of TypeScript `enum`
- Use `as const` assertions for constant objects/arrays
- Shared types live in `setup-core/types.ts`; co-locate types when only used by one module
- Return types are inferred — don't annotate unless the signature is ambiguous

## React / Ink Patterns

- **Functional components only** — no class components
- **Named exports only** — no default exports: `export function App() { ... }`
- **One component per file**
- Props interfaces named `{ComponentName}Props`, defined immediately above the component
- `useInput` (Ink hook) for keyboard handling
- State is local `useState` only — no external state libraries

## Engine Layer Patterns

New engine code (`src/engine/`) must have **zero UI dependencies** — no Ink, React, or
terminal-specific imports. The engine communicates results via `CommandResult` types, not
by rendering output directly.

- `HiseConnection` interface for transport abstraction
- Mode-specific parsers in `engine/modes/`
- Validation logic in `engine/validation/` using static JSON data
- Tab completion in `engine/completion/` using static JSON data

## Error Handling

- Wrap in `try/catch`; extract messages with `String(error)` (never assume `Error` instance)
- Empty `catch` blocks are acceptable for non-fatal operations — add a comment explaining why
- Return `null` or `false` for "not found" cases rather than throwing
- Fatal CLI errors: print with `chalk.red()`, then `process.exit(1)`
- No custom error classes — use plain `Error` or string messages

## Comments

- **Section dividers** use em-dash style (~72 chars wide):
  ```ts
  // ── Section Title ───────────────────────────────────────────────────
  ```
- Inline comments explain **why**, not what
- No commented-out code; no TODO comments in the codebase

## General Patterns

- **Platform-aware code**: use `process.platform` checks with per-platform branches
- Classes are used sparingly (`SetupLogger` is the main example)
- Feature directories contain their own `App.tsx` as the feature root component
- Constants are co-located at the top of the file or in shared modules (`theme.ts`)
