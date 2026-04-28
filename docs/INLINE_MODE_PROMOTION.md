# Inline-mode promotion cleanup

Handoff prompt for the cleanup pass after deciding to switch the REPL to
the inline-mode shell as the canonical UI.

## Context

hise-cli has a parallel inline-mode TUI shell at `src/inline/` that
replaces the full-screen Ink shell at `src/tui/`. After UX validation on
macOS, the decision is to promote inline mode to be the only REPL and
remove the full-screen shell entirely. Plan and reference: see
`C:\Users\chris\.claude\plans\i-d-like-to-brainstorm-floating-leaf.md`
(plan + 3 addenda — wizards, multiline editor, popup-region
stabilization).

Pre-1.0 policy in CLAUDE.md authorizes aggressive removal — no backwards
compat shims, no deprecation period.

## Status (post-salvage session)

The two pre-cleanup regressions are resolved:

- **Observer wired**: `InlineApp` now starts the observer HTTP server on
  mount and renders `[LLM] <command>` echo blocks for events arriving
  from CLI invocations. `command.end` events also invalidate cached
  trees so the panel refreshes.
- **`--web` works** when invoked via `bun dist/index.js --web` (the
  shipped binary uses bun; the dev shim `~/bin/hise-cli` uses node and
  therefore cannot launch `--web`). SPA assets serve correctly via the
  embedded-assets bundle. No code regression — `embedded-assets.ts` is
  not a "stub" but the real generated file (~19 MB).

The "tree sidebar feature" decision point is also resolved — see
"Inline tree panel" below.

## Inline tree panel (replaces full-screen TreeSidebar)

`InlineApp` now renders a live tree panel above the input prompt,
toggled by **Ctrl+B**. It is a static text block (no cursor, no
expand/collapse, no scrollbar) using a Unicode box-drawing tree.

Behaviour:

- Auto-hides for modes without `getTree` (root, script, hise, undo,
  sequence, project, analyse).
- Rooted at PWD; each `cd` zooms the panel.
- Always-visible breadcrumb above the tree, prefixed with a
  mode-specific context label:
  - builder: `Module-Tree: Master Chain / FX Chain / Output`
  - ui: `Component-Tree (Interface): Interface / TopBar / ...`
  - dsp: `DspNetwork Tree (moduleId.networkId): networkId / ...`
- Height-capped at half the terminal: full subtree → fall back to
  `maxDepth: 1` → hard truncation footer (`… +N more rows`).
- Re-fetches the active mode's tree after every command (own submit
  *and* observer-piped CLI calls) via `session.invalidateAllTrees()` +
  `mode.onEnter()`.
- `/compact` in builder hides modulator chains off the active path
  *and* drops the `Type "Label"` form to render just the label. The
  slash handler now mutates `mode.compactView` directly in the engine
  layer (no TUI sentinel parsing).

The renderer lives in `src/engine/modes/builder-ops.ts` as
`renderTreeBox(node, options)`. It honours `node.colour`,
`node.filledDot`, `node.dimmed`, `node.badge`, `node.diff`, plus
`pwdNode`, `mutedColor`, `signalColor`, `maxDepth`, `compact` options.
The same renderer powers `show tree` in builder/ui/dsp via
`preformattedResult(text, undefined, true /* plain */)`.

Implication for cleanup: keep `TreeNode`, `getTree`, `getSelectedPath`,
`compactView`, `compactTree`, `propagateChainColors`, and the slash
commands `/compact`. **Drop** `treeLabel` only if no consumer remains
after `TreeSidebar` deletion (the inline panel hardcodes per-mode
labels).

## Promotion

1. Make inline default. Remove `--inline` flag handling from
   `src/cli/args.ts`. Drop `tui-inline` parse kind. `parseCliArgs`
   returns `tui` for the REPL path; `tui` callers go through inline
   shell.
2. `src/index.ts`: delete `launchTui` + `setupAltScreen` + `launchRepl`.
   Rename `launchInline` → `launchRepl`. Drop `import { App as TuiApp }`.
3. Promote `src/inline/` → integrate at top level. Either rename
   `src/inline/` to `src/tui/` (after deleting old `src/tui/` contents)
   or keep `src/inline/` and adjust paths. User preference: probably
   collapse into a flat `src/tui/` (or rename to `src/repl/`).

## Files to delete entirely

- `src/tui/components/TopBar.tsx` + `.test`
- `src/tui/components/TreeSidebar.tsx` + `.test`
- `src/tui/components/StatusBar.tsx` (replaced by InlineApp's StatusLine)
- `src/tui/components/Output.tsx` (virtualized viewport — gone)
- `src/tui/components/scrollbar.tsx`
- `src/tui/components/LandingLogo.tsx` (replaced by `src/inline/banner.ts`)
- `src/tui/profiler.ts` + `--profile` flag plumbing if not used elsewhere
- `src/tui/hooks/useOutputScroll.ts`
- `src/tui/hooks/useSidebarState.ts`
- `src/tui/hooks/useKeyLabel.ts` (key-press badge — feature in TopBar)
- `src/tui/screencast/` — verify if still useful for inline; likely yes,
  needs adaptation. Keep but test.
- `src/tui/app.tsx` — the full-screen shell. Delete entirely after
  migrating any remaining helpers. The `/compact` and `/density`
  interception blocks at lines ~1521–1562 are dead with this shell;
  `/compact` already works via the engine handler.

**Keep** (still used by inline):

- `src/tui/observer.ts` — wired into both `InlineApp` and `src/web/server.ts`.
  Consider relocating to `src/observer/server.ts` after the TUI shell
  is gone (no TUI deps).
- `src/tui/components/script-log.ts` — used by inline `/edit` F5 path.
- `src/tui/components/Markdown.tsx`, `prerender.ts`, `wizard-render.ts`,
  `wizard-keys.ts`, `Input.tsx`, `CompletionPopup.tsx`.

## Theming simplification

Inline mode uses ZERO background colors. Theming layer is overspecified:

- `src/tui/theme.ts`: ColorScheme has 5 backgrounds (darker / standard /
  sidebar / raised / overlay) — all unused. Drop entire `backgrounds`
  field. Foreground keeps default / bright / muted. `light` field
  unused — drop.
- 8 named schemes (monokai / dracula / nord / ...) — drop all but one.
  Or drop schemes entirely; hardcode 3 fg colors + brand.
- `snapSchemeFor256` + `hasTrueColor` — re-evaluate. ANSI fg-only
  output may not need 256 snapping anymore. Test on macOS Terminal.app
  first.
- `darkenHex` / `lightenHex` / `lerpHex` / `mix`: only used by cursor bg
  (gone in flat mode), wizard internal selBg/cursorBg. Wizard still uses
  for editing visuals — keep what `wizard-render.ts` needs, drop the rest.
- ThemeContext: only `Input.tsx` still calls `useTheme()`. Either drop
  context entirely (pass scheme as plain prop) or keep for one consumer.
- Layout system (`src/tui/layout.ts`): density tiers (compact / standard
  / spacious), `sidebarWidth`, `GAP_ROWS`, `INPUT_SECTION_ROWS`,
  `computeLayout`, `detectDensity` — all gone. Inline only uses
  `horizontalPad` and `completionMaxVisible`. Inline these as constants
  and delete the file.
- `/density` slash command in `src/engine/commands/slash.ts` — delete.

The few remaining `scheme.backgrounds.*` callsites in InlineApp
(echo box, script log) can drop their bg argument — `bgHex("")` returns
empty so the box-around-echo styling will disappear gracefully. The
`preformatted` variant gained a `plain?: boolean` flag (used by tree
output) — keep the boxed path for waveforms/spectrograms.

## Engine layer

- `src/engine/commands/slash.ts`: search for `/density`, tree-related
  commands. Remove `/density` handler. **Keep** `/compact` (now wired
  end-to-end in the engine handler).
- Mode interface (`src/engine/modes/mode.ts`):
  - `treeLabel` — drop after sidebar deletion (panel hardcodes labels).
  - `getTree`, `getSelectedPath`, `invalidateTree`, `compactView`,
    `onEnter` — **keep** (powers the inline tree panel).
- `src/engine/result.ts`: `tree` CommandResult variant unused — only
  `project.ts` and `project-format.ts` still emit it. Either convert
  those to `preformattedResult(renderTreeBox(...), undefined, true)`
  for parity, or drop the variant after migration.

## Input.tsx cleanup

- Drop `flat` prop branching: flat path is the only path now. Delete the
  bg-styled single-line render entirely.
- Drop `ghostText` / `ghostForValue` if not used in inline mode (verify).
- Drop `scrollEditor` + `editorScroll` / mouse-wheel multiline scroll —
  inline multiline auto-extends, no internal scroll.
- Drop multiline `maxLines` fixed-height code path in favor of the
  auto-extend approach. The old internal-scroll branch is unreachable
  when `maxLines >= totalVRows` always. Simplify the render.

## CompletionPopup.tsx

- Drop `viewportRows` / `bottomOffset` / `position: absolute` branch.
  Inline never passes `rows` prop. Simplify to relative-flow only.

## Misc

- `src/tui/components/script-log.ts` — keep, used by inline. Already
  stripped of bg colours; `formatScriptLog` returns ANSI lines without
  the boxed `bgHex(scheme.backgrounds.standard)` wrap.
- `src/tui/components/Markdown.tsx` — keep if `renderResult` uses it.
- `src/tui/components/wizard-render.ts`: drop `bg` parameter usage
  branches; flat is the only path. Same for selBg/cursorBg styling
  (keep only what's still useful for editing feedback).
- `src/tui/components/wizard-keys.ts` — keep, pure logic.
- `src/tui/components/prerender.ts` — keep, all functions used. Note
  `renderPreformatted` now takes a `plain?: boolean` for the tree panel
  use case.
- `src/inline/launch.ts`: clean up the resize handler workaround
  (`instance.clear` + `\x1b[J` + `prependListener`) — re-evaluate if
  still needed after the codebase shrinks. Possibly remove.
- `src/web/embedded-assets.ts` is a real generated bundle (~19 MB), not
  a stub. Generated by `scripts/embed-web-assets.mjs`. Verify
  `npm run build:web` still works after cleanup. Note: top-level
  `npm run build` currently fails on the SPA build because
  `react-markdown` / `zustand` / `monaco-editor` / `react-dom` are
  declared in `package.json` but not installed. Run `npm install` once
  to fix.

## Build pipeline

- `scripts/build.mjs` runs SPA build first. SPA build currently fails
  because `react-markdown` / `zustand` / `monaco-editor` / `react-dom`
  devDeps aren't installed. Run `npm install` once to fix. Then
  `npm run build` should work end-to-end.
- `vitest.screencast.config.ts`: screencast tests test the old TUI shell.
  Adapt or drop.
- `src/live-contract/**.live.test.ts`: contract tests, should still work
  since they're engine-level.

## Documentation

- `CLAUDE.md`: update Project Structure section. Drop sections
  referencing TopBar / TreeSidebar / Output viewport / density / layout
  scale. Add a section for the inline tree panel + `Ctrl+B` toggle.
- `DESIGN.md` (if it exists): same.
- `TUI_STYLE.md` (referenced in CLAUDE.md): rewrite or delete. Layer 1-3
  design spec less relevant without bg colors.
- `src/cli/help.ts`: remove keys/sidebar/density commands. Document
  `/compact` and the `Ctrl+B` panel toggle. Update mode hints.

## Verification after cleanup

1. `npm run typecheck` — clean.
2. `npm run build` — clean (after `npm install` for SPA deps).
3. `npm test` — vitest passes.
4. `hise-cli` launches inline shell. No alt-screen. All commands that
   worked before still work.
5. Wizards: `/setup`, `/install`, `/save` still launch and complete.
6. Multiline: `/edit foo.hsc` opens, F5 executes, F7 validates,
   Esc-Esc exits and clears the input.
7. Tab completion: works in single-line and multiline.
8. Resize: status bar truncates, no scrollback leaks.
9. Connection probe: project name + folder appear in status bar when
   HISE running. `playgroundActive` reflects HISE snippet-browser state.
10. Quit: Ctrl+D shows dimmed border before exit.
11. Tree panel: `Ctrl+B` toggles. Builder/ui/dsp show their tree;
    other modes hide it. `cd` zooms; `cd ..` zooms out. `/compact`
    flattens chains and drops type prefixes (builder only).
12. Banner: shows "Update available: vX" + "Run `hise-cli update`" when
    a newer release exists (with 1.5 s timeout).
13. `bun dist/index.js --web` launches the SPA at
    `http://127.0.0.1:1901/?token=...`.
14. Observer: external `hise-cli -builder "..."` calls render `[LLM] ...`
    blocks in the inline shell and refresh the tree panel.

## Git

Single big-bang cleanup commit acceptable per pre-1.0 policy. Or split
into logical chunks (delete-tui / theme-simplify / promote-inline /
docs).

## Decision points (resolved)

- **Tree sidebar feature**: implemented as the inline panel above the
  prompt (Ctrl+B). `TreeNode`, `getTree`, `getSelectedPath`,
  `compactView`, `compactTree`, `propagateChainColors`, `/compact` all
  retained. `treeLabel` field on Mode interface can be dropped (panel
  hardcodes per-mode labels).
- **Density system**: dropping. `/density` slash handler + layout
  density tiers go.
- **Color scheme picker**: dropping for now. Hardcode a single
  fg-accent palette; can re-add as a config option later.

## Known limitations to revisit later

- **Tree panel initial state**: lazy fetch means the panel is blank
  until the first command in a mode triggers `ensureTree`. Consider
  proactively fetching on mode entry (extend `onEnter` semantics).
- **Tree panel scroll**: large subtrees collapse to depth 1 then hard
  truncate. No keyboard scroll within the panel.
- **DSP PWD**: dsp mode has no `getSelectedPath` analogue (selection is
  a `nodeId` arg per command). Panel shows the dsp tree without PWD
  zoom.
