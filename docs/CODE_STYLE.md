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
- In the v2 architecture, shared types live in `src/engine/` modules
  (`result.ts`, `session.ts`, `hise.ts`). Legacy shared types are in
  `setup-core/types.ts`. Co-locate types when only used by one module
- Return types are inferred — don't annotate unless the signature is ambiguous

## React / Ink Patterns

- **Functional components only** — no class components
- **Named exports only** — no default exports: `export function App() { ... }`
- **One component per file**
- Props interfaces named `{ComponentName}Props`, defined immediately above the component
- State is local `useState` or `useReducer` — no external state libraries
- **`useReducer` for complex input state**: when multiple keystrokes can arrive before
  React re-renders (stale closures), use `useReducer` with atomic actions instead of
  `useState`. The Input component uses this pattern (see `InputAction` type in
  `src/tui/components/Input.tsx`). Propagate value changes to parents via `useEffect`
  on `state.value`, not inline in dispatch.
- **`React.memo` on every panel component** — Output, Input, CompletionPopup, TopBar,
  StatusBar, Overlay. Re-render only when props change.
- **`useCallback` for handlers** passed as props to memoized children
- **`useRef` for scroll offset** and other values that change without needing re-render
- **Derived state anti-jitter**: when derived state (e.g., ghost text) depends on a value
  that changes via `useEffect` (one frame late), store the source value alongside the
  derived value (e.g., `ghostForValue`) and only display the derived value when it matches
  the current source. This prevents one-frame stale renders.

### Central Key Dispatch

A single `useInput` handler in `app.tsx` with a strict priority chain:
Overlay > Global hotkeys > CompletionPopup > TreeSidebar > Input > App scroll.

Components like Input and TreeSidebar do **not** call `useInput` themselves.
Instead they expose imperative handles (`InputHandle`, `TreeSidebarHandle`)
via `useImperativeHandle`. The central dispatcher calls these methods in
response to keys. This guarantees exactly one action per keystroke.

See `src/tui/app.tsx` for the dispatcher and `src/tui/components/Input.tsx`,
`src/tui/components/TreeSidebar.tsx` for the handle interfaces.

### Data-Driven Tree Rendering

`TreeNode` carries all visual properties (`colour`, `filledDot`, `dimmed`,
`diff`). A mode-specific pipeline function (e.g. `propagateChainColors()` in
`builder.ts`) walks the tree and resolves all visual properties before
rendering. The `TreeSidebar` component is purely presentational — it reads
the pre-computed data and renders it. No visual logic in the renderer.

This separation means the same `TreeNode` data can be consumed by the CLI
frontend (as JSON) or a future web frontend without any computation changes.

### Mouse Events

Mouse interaction uses `@ink-tools/ink-mouse`: `useOnClick` for click/
double-click detection, `useOnWheel` for scroll, `useElementPosition` for
coordinate mapping. Double-click detection is manual (timing-based, no
native support). See `TreeSidebar.tsx` and `CompletionPopup.tsx` for examples.

## Engine Layer Patterns

New engine code (`src/engine/`) must have **zero UI dependencies** — no Ink, React, or
terminal-specific imports. The engine communicates results via `CommandResult` types, not
by rendering output directly.

- `HiseConnection` interface for transport abstraction
- Mode-specific parsers in `engine/modes/`
- Validation logic in `engine/validation/` using static JSON data
- Tab completion in `engine/completion/` using static JSON data
- `Mode.contextLabel` — optional dynamic string for path display in prompt
- `Mode.tokenizeInput()` — optional per-mode syntax highlighting tokenizer
- `Mode.getTree()` / `getSelectedPath()` / `selectNode()` — tree sidebar data
  providers. See `src/engine/modes/mode.ts` for the full interface.

## TUI Utility Functions

- **Color manipulation** (`src/tui/theme.ts`): `darkenHex()`, `lightenHex()`,
  `lerpHex()`, `mix()`, `darkenScheme()`, `darkenBrand()` — used for overlay
  dimming, cursor highlight, gradient animation, and diff tinting.
- **Shared scrollbar** (`src/tui/components/scrollbar.ts`): `scrollbarChar()` —
  used by Output, CompletionPopup, TreeSidebar.

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

## Debugging

### Key input logging

Terminal emulators vary in what escape sequences they send for key combos
(e.g. Ghostty sends Ctrl+A/E for fn+Left/Right instead of Home/End). To
diagnose key mapping issues, add temporary logging to the central key
dispatcher in `src/tui/app.tsx` (the single `useInput` handler). Log the
raw `input` string, hex codes, and Ink `key.*` flags to a file. Remove
the logging before committing.
