# TUI Style Guide — hise-cli

> Visual design system for the hise-cli terminal UI. Covers colors, layout, component
> specs, interaction patterns, and mode prompts. This is the visual complement to
> [DESIGN.md](../DESIGN.md), which covers architecture and command grammars.

---

## 1. Color System

### 1.1 Color Architecture

The TUI uses a four-layer color model. The first three layers are hardcoded (fixed across
all color schemes) to maintain HISE brand identity and mode recognition. Only the fourth
layer changes when the user switches themes.

```
┌─────────────────────────────────────────────┐
│  Layer 1: HISE Brand Colors (4)             │  Hardcoded — matches HISE IDE
│  Layer 2: Mode Accent Colors (8 + root)     │  Hardcoded — domain identity
│  Layer 3: Syntax Highlighting (10)          │  Hardcoded — matches HISE editor
├─────────────────────────────────────────────┤
│  Layer 4: Color Scheme (8 values)           │  User-selectable via /theme
│    5 background tiers + 3 foreground tiers  │
└─────────────────────────────────────────────┘
```

### 1.2 HISE Brand Colors (Layer 1 — Hardcoded)

These match the C++ macros in the HISE codebase. They are fixed across all schemes.

| Purpose  | HISE Macro             | Hex       | TUI Usage                                            |
|----------|------------------------|-----------|------------------------------------------------------|
| Signal   | `SIGNAL_COLOUR`        | `#90FFB1` | "HISE" branding text, scrollbar thumb, selection highlight in palette/completion, progress bar fill, active toggle indicators |
| OK       | `HISE_OK_COLOUR`       | `#4E8E35` | Connected status dot, validation pass, plan step `✓`  |
| Warning  | `HISE_WARNING_COLOUR`  | `#FFBA00` | Degraded connection, deprecation warnings `⚠`         |
| Error    | `HISE_ERROR_COLOUR`    | `#BB3434` | Failed commands, validation errors `✗`, disconnected  |

**SIGNAL_COLOUR** (`#90FFB1`) is the distinctive HISE neon green. It appears on
system-level interactive chrome — never on the prompt (which uses mode accents) and
never on output content lines (which use semantic or foreground colors).

### 1.3 Mode Accent Colors (Layer 2 — Hardcoded)

Each mode has a fixed accent color that provides instant visual orientation. Mode accents
appear on: the `>` prompt character, the `[mode]` label in the top bar, the sidebar
heading, and the left-border `▎` on command echo lines in the output.

| Mode     | Accent   | Hex       |
|----------|----------|-----------|
| (root)   | Default  | Uses `foreground.default` — neutral, no mode active |
| Builder  | Orange   | `#fd971f` |
| Script   | Rust     | `#C65638` |
| DSP      | Teal     | `#3a6666` |
| Sampler  | Green    | `#a6e22e` |
| Inspect  | Purple   | `#ae81ff` |
| Project  | Yellow   | `#e6db74` |
| Compile  | Magenta  | `#f92672` |
| Import   | Mint     | `#2de0a5` |

**Wizard accent** (not a mode — a UI chrome color for the wizard overlay):

| Context  | Name     | Hex       |
|----------|----------|-----------|
| Wizard   | Copper   | `#e8a060` |

Used for: wizard overlay border, step indicator highlight, header title, confirm
highlights, selected item markers. See Section 3.10 for full specification.

### 1.4 Syntax Highlighting (Layer 3 — Hardcoded)

These match the HISE code editor color scheme. They apply to the input field in script
mode (full highlighting) and partially in builder/DSP modes (strings, numbers, known
identifiers). Fixed across all schemes — they are part of the HiseScript language identity.

| Token              | Hex       | TUI Usage                                             |
|--------------------|-----------|-------------------------------------------------------|
| Keyword            | `#bbbbff` | `var`, `reg`, `const`, `function`, `if`, `else`, `for`, `while`, `return`, `local`, `namespace`, `inline` |
| Identifier         | `#DDDDFF` | Variable names, function names, property names        |
| ScopedStatement    | `#88bec5` | API namespaces before `.`: `Engine`, `Synth`, `Console`, `Math`, `Content`. In builder/DSP mode: module type names, node factory names |
| Integer            | `#DDAADD` | `42`, `0xFF`, hex literals                            |
| Float              | `#EEAA00` | `3.14`, `0.5`, `44100.0`                              |
| String             | `#DDAAAA` | `"hello"`, single and double quoted                   |
| Comment            | `#77CC77` | `//` and `/* */` — mainly for multi-line script input |
| Operator           | `#CCCCCC` | `+`, `-`, `*`, `/`, `=`, `==`, `!=`, `&&`, `||`      |
| Bracket            | `#FFFFFF` | `(`, `)`, `[`, `]`, `{`, `}`                          |
| Punctuation        | `#CCCCCC` | `.`, `,`, `;`, `:`                                    |

**Highlighting scope by mode:**

| Mode    | Highlighting                                                     |
|---------|------------------------------------------------------------------|
| Script  | Full — all tokens above. The input is a mini code editor.        |
| Builder | Partial — strings, numbers, module types (as ScopedStatement), verbs (`add`, `set`, `remove` as Keyword) |
| DSP     | Partial — strings, numbers, factory.node names (as ScopedStatement), verbs as Keyword |
| Others  | Minimal or none — grammars are simple enough without it          |

**Implementation note:** Syntax highlighting requires a custom input component. The
`ink-text-input` package renders the value as a single `<Text>` element. The replacement
needs a lightweight regex-based tokenizer (pure function in the engine layer, no UI deps)
that returns `{text, tokenType}[]` spans, rendered as multiple `<Text>` elements with
per-token colors. The tokenizer handles cursor positioning and ghost-text overlay.

### 1.5 Color Schemes (Layer 4 — User-Selectable)

A scheme defines 8 values: 5 background tiers and 3 foreground tiers.
See `ColorScheme` interface in `src/tui/theme.ts` for the canonical type definition.

**Background tiers** create visual depth:

| Tier    | Name         | Purpose                              |
|---------|--------------|--------------------------------------|
| 1       | `darker`     | Chrome: top bar, bottom bar, progress |
| 2       | `standard`   | Content: output area                 |
| 3       | `sidebar`    | Sidebar panel                        |
| 4       | `raised`     | Input area                           |
| 5       | `overlay`    | Command palette, completion popup    |

**Foreground tiers:**

| Tier    | Purpose                                          |
|---------|--------------------------------------------------|
| default | Body text, output info lines, unselected items   |
| bright  | Result output lines, emphasized text              |
| muted   | Hints, secondary text, disabled, separators       |

### 1.6 Shipped Schemes

8 schemes (6 dark + 2 light) shipped in `src/tui/theme.ts` (`schemes` object).
Default is Monokai. Each scheme is 8 color values + a name.

Scheme selection: `/theme` lists available schemes with a preview. `/theme <name>`
switches and persists to config. The current scheme name is stored in the hise-cli
config file.

On light themes (`scheme.light === true`), mode accents with poor contrast
(yellow, green, cyan) are automatically darkened for readability.

### 1.7 ThemeContext — Centralized Color Provider

All TUI components read colors from a React context (`ThemeProvider` / `useTheme()`)
instead of importing `brand` or `statusColor` directly. This enables the overlay
dimming system: when a modal overlay opens, the backdrop re-renders the entire UI
inside a `ThemeProvider` with darkened values. Every component automatically gets
dimmed colors without override props.

See `src/tui/theme-context.tsx` for the `ThemeContextValue` interface. Components
call `useTheme()` to access `scheme`, `brand`, and `statusColor`.

**Rule**: Components must never import `brand` or `statusColor` directly from
`theme.ts` for rendering purposes. Always use `useTheme()`. The only exception
is pure functions that bake colors into data structures at creation time (e.g.,
`resultToLines` bakes `brand.error` into `OutputLine.color` — these baked colors
are handled by `darkenOutputLines()` separately).

### 1.8 Overlay Dimming System

When a modal overlay opens (help, wizard, command palette), the underlying UI
freezes and dims to create a visual backdrop. This is implemented as a full
component re-render with darkened colors, not a semi-transparent CSS overlay
(terminals don't support alpha compositing).

**How it works:**

1. **Snapshot**: When the overlay opens, the current UI state is captured
   (output lines, scroll offset, mode label, accent, connection status, hints).
2. **Darken**: All colors are darkened by `DIM_FACTOR` (see `src/tui/app.tsx`).
   This applies to:
   - The entire `ColorScheme` via `darkenScheme(scheme, factor)`
   - Brand colors via `darkenBrand(factor)`
   - Status colors via a darkened resolver
   - Mode accent colors via `darkenHex(accent, factor)`
   - Baked `OutputLine` colors via `darkenOutputLines(lines, factor)`
3. **Re-render**: The snapshot is rendered as an absolute-positioned layer at
   `marginTop={0}` using a `<ThemeProvider>` with the darkened values. Components
   inside this provider (TopBar, Output, Input, StatusBar) automatically render
   with dimmed colors.
4. **Overlay on top**: The modal panel renders at full brightness on top of the
   dimmed backdrop.

Color manipulation utilities (`darkenHex`, `lightenHex`, `darkenScheme`, etc.)
are in `src/tui/theme.ts`.

**Future-proofing**: Any new component that uses `useTheme()` automatically
participates in the dimming system. No override props needed. The only manual
work is extending `darkenOutputLines()` if new color fields are added to
`OutputLine`.

---

## 2. Layout Regions

### 2.1 Full-Screen Layout

The TUI fills the terminal using the alt screen. The layout is a vertical column with
an optional sidebar on the right.

```
+----------------------------------------------+---- 35 cols ---+
│ HISE REPL  [builder:plan]  MyProject         │  PLAN          │
+----------------------------------------------+                │
│                                               │  1 ✓ add Stre..│
│ ▎ > add AHDSR to Sampler1.gain               │  2 ✓ add AHDS..│
│ ▎ ✓ [2] add AHDSR to Sampler1.gain           │  3 …            │
│                                          |█|  │                │
│                                          │ │  │                │
+----------------------------------------------+                │
│ [####--------]  40% Compressing...            │                │
+----------------------------------------------+                │
│                                               │                │
│ [builder:plan] > add LFO to Sampler1.pitch_  │                │
│                                               │                │
+----------------------------------------------+----------------+
│ ● connected  history 3/12  Ctrl+B sidebar    │                │
+----------------------------------------------+----------------+
```

**Regions top to bottom:**

| Region      | Height    | Background       | Content                                  |
|-------------|-----------|------------------|------------------------------------------|
| Top Bar     | 1 row     | `darker`         | Branding + mode label + project name     |
| Output      | flexible  | `standard`       | Scrollable command/result log            |
| Progress    | 0–1 rows  | `darker`         | Determinate bar or spinner (conditional) |
| Separator   | 1 row     | `standard`       | Visual gap between output and input      |
| Input       | 3 rows    | `raised`         | Top border + prompt line + bottom border |
| Bottom Bar  | 1 row     | `darker`         | Status, scroll position, keybind hints   |

**Sidebar** spans from below Top Bar to above Bottom Bar, sharing vertical space with
Output + Progress + Separator + Input.

### 2.2 Row Budget

```
TOP_BAR_ROWS           = 1
BOTTOM_BAR_ROWS        = 1
INPUT_SECTION_ROWS     = 3    (top border + input + bottom border)
SEPARATOR_ROWS         = 1
PROGRESS_ROWS          = 0 or 1 (conditional)

outputRows = terminalRows - TOP_BAR_ROWS - BOTTOM_BAR_ROWS
             - INPUT_SECTION_ROWS - SEPARATOR_ROWS - PROGRESS_ROWS
```

**Terminal size requirements:**

| Scenario          | Minimum columns | Minimum rows | Notes                          |
|-------------------|-----------------|--------------|--------------------------------|
| With sidebar      | 80              | 24           | Sidebar auto-shows             |
| Without sidebar   | 60              | 24           | Sidebar auto-hides             |
| Hard minimum      | 40              | 12           | Degraded but functional         |

### 2.3 Sidebar (TreeSidebar)

- **Position**: left side, separated by a 1-character gap in `backgrounds.darker`
- **Width**: responsive — `max(20, min(40, floor(columns * 0.25)))`
- **Background**: `backgrounds.sidebar` (darker than `standard`)
- **Toggle**: `Ctrl+B`. Opens with focus, closes and returns focus to input.
- **Full height**: spans from below TopBar to above StatusBar, alongside Output
  and Input.

The sidebar renders a `TreeNode` hierarchy provided by `Mode.getTree()`.
Each mode provides its own tree (builder: module tree, script: namespace
hierarchy, project: folder structure, DSP: network tree). Modes without a
tree return `null` and the sidebar shows empty space.

**Visual elements** (see `src/tui/components/TreeSidebar.tsx`):
- Connector lines (`├─ └─ │`) in dimmed color (`darkenHex(foreground.muted, 0.5)`)
- Chain dots: `○` (unfilled) for chains, `●` (filled) for modules — colored
  by chain type (gain amber, pitch purple, FX teal, MIDI rust). Data-driven
  via `TreeNode.colour` and `TreeNode.filledDot`.
- Diff indicators: `+`/`-`/`*` at column 0 with tinted background via
  `mix(statusColor, sidebarBg, 0.9)`. Data-driven via `TreeNode.diff`.
- Current root: `>` prefix, bold, bright white. Always-expanded root node.
- Empty chains dimmed (label + dot). Data-driven via `TreeNode.dimmed`.
- Expand/collapse triangles (`▾`/`▸`), scrollbar, persistent state across
  close/reopen.

---

## 3. Component Specs

### 3.1 TopBar

Single row anchored to the top of the screen.

```
│ HISE REPL  [builder:plan]  MyProject                                 │
```

| Element       | Color                      | Style |
|---------------|----------------------------|-------|
| `HISE REPL`   | SIGNAL_COLOUR (`#90FFB1`)  | bold  |
| `[mode:ctx]`  | Mode accent color          | bold  |
| Project name  | `foreground.default`       |       |
| (no project)  | `foreground.muted`         | shows "connecting..." |

Background: `backgrounds.darker`. Full terminal width, padded with spaces.

Mode label updates instantly on mode switch. Nested modes use colon separator:
`[builder]`, `[builder:plan]`, `[script:Interface]`, `[sampler:MySampler]`.

### 3.2 Output

Scrollable log filling the flexible region between Top Bar and Progress/Input.

**Line types and styling:**

| Type          | Left border          | Prefix  | Text color           | Background   |
|---------------|----------------------|---------|----------------------|--------------|
| Command echo  | `▎` in mode accent   | `> `    | Mode accent color    | `darker`     |
| Result        | `▎` in mode accent   | —       | `foreground.bright`  | `standard`   |
| Plan OK       | —                    | `✓ `    | HISE_OK_COLOUR       | `standard`   |
| Warning       | —                    | `⚠ `    | HISE_WARNING_COLOUR  | `standard`   |
| Error         | —                    | `✗ `    | HISE_ERROR_COLOUR    | `standard`   |
| Info/system   | —                    | —       | `foreground.muted`   | `standard`   |

The left-border `▎` on command echo and result lines uses the accent of the mode that
produced them — creating a visual trail in scrollback of which mode generated each output.

**Scrollbar** (appears when content exceeds viewport):

| Element | Character | Color                |
|---------|-----------|----------------------|
| Thumb   | `█`       | `foreground.muted`   |
| Track   | `│`       | `foreground.muted`   |

Scrollbar rendering is shared across Output, CompletionPopup, and any future scrollable
panel via `scrollbarChar()` in `src/tui/components/scrollbar.ts`.

**Horizontal padding**: 2 characters on each side. Content width =
`availableWidth - scrollbarWidth - horizontalPadding * 2`.

**Text overflow**: truncate with `…`, no word-wrap. Lines exceeding content width are
cut at `contentWidth - 1` and appended with `…`.

**Empty state**: centered `foreground.muted` hint text (e.g., "Type a command or
/help to get started").

### 3.3 Input

Three-row raised panel at the bottom of the main content area.

```
│                                                                      │  ← top border (raised)
│  [builder] SineGenerator.pitch > add LFO_                           │  ← input row (raised)
│                                                                      │  ← bottom border (raised)
```

**State management**: The Input component uses a `useReducer` pattern (inspired by
`@inkjs/ui`'s `useTextInputState`) to avoid stale-closure bugs when multiple keystrokes
arrive before React re-renders. All editing operations dispatch actions to a reducer that
atomically updates `{value, cursorOffset}`. See `InputAction` type in
`src/tui/components/Input.tsx` for the full action list. Value changes propagate to the
parent via `useEffect` on `state.value`, passing both `value` and `cursorOffset`.

**Prompt format:**

| State              | Prompt                         | Colors                              |
|--------------------|--------------------------------|-------------------------------------|
| Root (no mode)     | `> `                           | `>` in `foreground.default`         |
| In a mode          | `[mode] > `                    | Brackets and text in `foreground.muted`, `>` in mode accent |
| Mode with context  | `[mode] context.path > `       | Context path in `foreground.default` |
| Disabled (pending) | `waiting for response...`      | `foreground.muted`, no cursor       |

The `contextLabel` (e.g., `SineGenerator.pitch` in builder mode) is a dynamic property
on the `Mode` interface. It renders between the mode label and the `>` character when
non-empty.

**Cursor rendering**: The cursor is rendered as the character at the cursor position
with a lightened background color (`lightenHex(scheme.backgrounds.raised, 0.3)`). No
block character (`█`) — the actual glyph remains visible. At end of input with ghost
text, the first ghost character appears under the cursor highlight in
`foreground.default` (brighter than muted for visibility).

**Ghost text completion**: The top completion candidate appears after the cursor in
`foreground.muted`. Ghost text is only shown when the cursor is at the end of the input
— when the cursor is mid-string, ghost text is suppressed entirely. A `ghostForValue`
prop ensures ghost text is only displayed when it was computed for the current input
value, preventing one-frame jitter from stale ghost text between render cycles.

**Scroll window**: When the input text exceeds the display width, the visible portion
scrolls horizontally to keep the cursor in view.

**Syntax highlighting** (see Section 1.4): In script mode, the input text is tokenized
and each token rendered with its HISE editor color. In builder/DSP mode, partial
highlighting applies to strings, numbers, and known identifiers. Other modes render
input as plain `foreground.default`.

**Multi-line** (script mode): When brackets are unclosed, the prompt changes to a
continuation indicator `...` aligned to the main prompt. The opening bracket is
highlighted in `#FFFFFF` (Bracket color) to show what's being continued.

Background: `backgrounds.raised` for all three rows. Horizontal padding: 2 characters.

### 3.4 CompletionPopup

Floating dropdown that appears above the input line **immediately as the user types**.
No Tab-to-show step — the popup is always visible when candidates exist. Uses absolute
positioning (`position="absolute"`) to overlay the content without affecting layout. No
border — solid filled rows spanning the full terminal width.

```
   Slash commands                           ← header row in foreground.muted
   AHDSR          EnvelopeModulator         ← selected: signal text, bright detail
   TableEnvelope  EnvelopeModulator         ← overlay bg
   MPEModulator   EnvelopeModulator         ← overlay bg
   LFO            TimeVariantModulator      ← overlay bg
│  [builder] > add A_                                                  │
```

| Element          | Color / Style                                      |
|------------------|----------------------------------------------------|
| Background       | `backgrounds.overlay` (full row, edge to edge)     |
| Header row       | `foreground.muted` — label from `CompletionResult.label` (e.g., "Slash commands", "Module types") |
| Item name        | `foreground.default`                               |
| Item annotation  | `foreground.muted` (type, category, or signature)  |
| Selected name fg | SIGNAL_COLOUR (`brand.signal`)                     |
| Selected detail  | `foreground.bright`                                |

No selection background — the selected item is distinguished by text color only
(signal-colored label + bright detail). This keeps the popup visually clean.

- **Position**: absolute, directly above input, full terminal width per row.
  Left area before the popup content is filled with `backgrounds.overlay`.
- **Width**: adapts to content, max 50 chars
- **Height**: scrollable with shared `scrollbarChar()` utility (max visible items
  configured in `src/tui/components/CompletionPopup.tsx`)
- **Mousewheel**: `useOnWheel` from `@ink-tools/ink-mouse` scrolls the popup. Output
  wheel scrolling is gated when popup is visible.
- **Dismiss**: Input diverging from all candidates auto-dismisses.
- **Escape**: Toggles the popup — close if open, open with all items for current
  context if closed (useful for discovery).
- **Navigation**: Up/Down arrows (wrap around)
- **Tab**: Accepts the selected completion item
- **Enter**: Accepts the selected completion AND submits the command (execute)

Ghost text inline in the input shows the top candidate in `foreground.muted`.
The dropdown shows alternatives.

### 3.5 Progress

Conditional single row between Output and Separator. Only rendered when an operation is
in progress.

**Determinate** (numeric progress 0.0–1.0):
```
│ [########------------]  40%  Compressing monolith...                 │
```

| Element   | Color            |
|-----------|------------------|
| Fill `#`  | SIGNAL_COLOUR    |
| Empty `-` | `foreground.muted` |
| Percent   | `foreground.default` |
| Message   | `foreground.muted` |

Bar width: 20 characters. Background: `backgrounds.darker`. Horizontal padding: 1.

**Indeterminate** (no numeric value):
```
│ ⠋ Compiling...                                                       │
```

Spinner in SIGNAL_COLOUR (dots type), message in `foreground.muted`.

### 3.6 BottomBar

Single row anchored to the bottom of the screen.

```
│ ● connected  history 3/12  Tab: complete  Ctrl+Space: palette       │
```

| Element            | Color                           |
|--------------------|---------------------------------|
| Status dot `●`     | HISE_OK / WARNING / ERROR color |
| Status text        | `foreground.muted`              |
| Scroll position    | `foreground.muted`              |
| Keybind hints      | `foreground.muted`              |

Background: `backgrounds.darker`. Full terminal width.

**Contextual hints** change per mode to show the most relevant keybinds for that context.

### 3.7 CommandPalette

Centered floating panel triggered by `Ctrl+Space` or `/modes`.

```
+----------------------------------------------+
│                                               │
│        ┌────────────────────────────┐         │
│        │  > filter text_            │         │
│        ├────────────────────────────┤         │
│        │  ● Builder     Module tree │         │  ← ● in builder orange
│        │  ● Script      HiseScript  │         │  ← ● in script blue
│        │  ● DSP         Scriptnode  │         │  ← ● in DSP cyan
│        │  ● Sampler     Sample maps │         │  ← ● in sampler green
│        │  ● Inspect     Runtime     │         │
│        │  ● Project     Settings    │         │
│        │  ● Compile     Build       │         │
│        │  ● Import      Assets      │         │
│        └────────────────────────────┘         │
│                                               │
+----------------------------------------------+
```

| Element            | Color / Style                                |
|--------------------|----------------------------------------------|
| Background         | `backgrounds.overlay`                        |
| Border             | `foreground.muted`                           |
| Filter input       | `foreground.default`, cursor visible         |
| Mode dot `●`       | That mode's accent color                     |
| Mode name          | `foreground.default`                         |
| Mode description   | `foreground.muted`                           |
| Selected item bg   | SIGNAL_COLOUR with darkened alpha (~30%)      |
| Selected item text | `foreground.bright`                          |

- **Position**: centered horizontally, ~60% terminal width, ~40% terminal height, drops
  from below the top bar
- **Filter**: type to narrow. Matches against mode name and description.
- **Navigation**: Up/Down arrows, Enter to select, Escape to dismiss
- **Rendered as overlay**: floats above the output area, does not reflow content beneath

### 3.8 TreeSidebar

Left-side panel rendering a `TreeNode` hierarchy. See Section 2.3 for layout
and toggle. Full implementation in `src/tui/components/TreeSidebar.tsx`.

**Row layout** (left to right):
```
[>|+|-|*| ] [connectors] [▾|▸|  ] [●|○|  ] label
```

- Column 0: `>` (current root, bold bright), `+`/`-`/`*` (diff status in
  brand color), or space
- Connectors: `├─`/`└─`/`│ ` in `darkenHex(foreground.muted, 0.5)`
- Expand icon: `▾`/`▸` or spaces for leaves
- Dot: `●` (filled, modules) or `○` (unfilled, chains) in `TreeNode.colour`,
  or spaces when no colour set (sound generators not in a chain)
- Label: plain text, bold for current root, muted when `TreeNode.dimmed`

**Interaction** (keyboard via central dispatch, mouse via `@ink-tools/ink-mouse`):
- Tab: switch focus between sidebar and input
- Up/Down: move cursor. Left: collapse/parent. Right: expand. Enter: select as root.
  Space: toggle expand. Escape: return focus to input.
- Single click: move cursor + grab focus. Double click: navigate into node.
- Scroll wheel: scroll tree content.

**State**: expand/collapse paths, cursor index, and scroll offset persist across
sidebar close/reopen via `TreeSidebarState` ref in `app.tsx`.

### 3.9 LiveMonitor (Inspect Mode Sidebar)

Continuously updating metrics driven by SSE push events from `GET /api/events`.

```
│  MONITOR                       │
│  ───────────────────────────── │
│  CPU  [████████░░░░░]  62%     │  ← fill in SIGNAL_COLOUR
│  VOX  12 / 256                 │  ← foreground.bright
│  MEM  128 MB                   │
│  MIDI ● ● ○ ○ ○ ○ ○ ○         │  ← recent activity: ● SIGNAL, ○ muted
│  ───────────────────────────── │
│  Last: NoteOn C3 vel=100       │  ← foreground.muted
│        CC#1 = 64               │
```

| Element        | Color                    |
|----------------|--------------------------|
| Metric label   | `foreground.muted`       |
| Bar fill       | SIGNAL_COLOUR            |
| Bar empty `░`  | `foreground.muted`       |
| Values         | `foreground.bright`      |
| MIDI dots `●`  | SIGNAL_COLOUR (active), `foreground.muted` (inactive) |
| MIDI log       | `foreground.muted`       |

### 3.10 Wizard Overlay

Centered floating panel for multi-step guided workflows. Triggered by `/wizard <id>`
or `wizard <id>` in a mode that registers the wizard. See [DESIGN.md](../DESIGN.md)
"Wizard Framework" for the engine-layer architecture and type definitions.

**Dimensions**: fixed 60 chars wide × 20 lines tall. Centered horizontally and
vertically over the REPL content using absolute positioning. The REPL remains
visible behind the overlay, frozen and dimmed via the overlay dimming system
(see Section 1.8). All underlying UI components re-render at `DIM_FACTOR`
brightness inside a `ThemeProvider` with darkened colors.

**Background**: `backgrounds.overlay` (at full brightness — only the backdrop
dims). No border — solid filled rectangle matching the help overlay style.
Title row uses wizard copper accent `#e8a060` for the step label.

**Layout** (inside border: 58 usable columns × 18 usable rows):

```
┌──────────────────────────────────────────────────────────┐
│  Step 2/5 — Select Sources                [Esc] Back     │  ← header
│──────────────────────────────────────────────────────────│  ← separator
│                                                          │
│  Which event sources should this broadcaster             │  ← description
│  listen to?                                              │
│                                                          │
│    ● Component property changes                          │  ← options
│      Module parameter changes                            │
│      Script variable changes                             │
│      MIDI messages                                       │
│      Routing matrix changes                              │
│                                                          │
│                                                          │
│                                                          │
│                                                          │
│                                                          │
│──────────────────────────────────────────────────────────│  ← separator
│                                         [Enter] Select   │  ← footer
└──────────────────────────────────────────────────────────┘
```

**Header row** (row 1):
- Left: "Step N/M" in `foreground.muted`, "— Step Title" in wizard copper (`#e8a060`), bold
- Right: "[Esc] Back" in `foreground.muted` (or "[Esc] Cancel" when on step 1)

**Content area** (rows 3–16, 14 usable lines): Renders the current step type.

**Footer row** (row 18): Right-aligned keybind hints in `foreground.muted`. Content
changes per step type.

#### Step Type Rendering

**Select** — single selection from a list:
- Arrow-navigable vertical list
- Selected item: `●` marker in wizard copper, label in `foreground.bright`
- Unselected items: 2-space indent (no marker), label in `foreground.default`
- Option descriptions (if present): shown below label in `foreground.muted`, indented
- Scrollable if >12 items: `▲`/`▼` indicators at top/bottom in `foreground.muted`
- Footer: `[Enter] Select`

**Multi-select** — multiple selections with checkboxes:
- `[✓]` in wizard copper for selected, `[ ]` in `foreground.muted` for unselected
- `Space` toggles individual items, `a` selects all, `n` selects none
- Footer: `3 selected  [Space] Toggle  [a] All  [n] None  [Enter] Confirm`

**Text** — free-form text input:
- Single-line text input rendered on a `backgrounds.raised` stripe (1 row tall)
- Placeholder text in `foreground.muted` when empty
- Cursor visible, text in `foreground.bright`
- Validation error (if any): shown below input in `HISE_ERROR_COLOUR`
- Footer: `[Enter] Confirm`

**Toggle** — boolean yes/no choice:
- Two options rendered as radio buttons: `● Yes  ○ No` (or custom labels)
- `←`/`→` arrow keys to switch between options
- Selected option: `●` in wizard copper, label in `foreground.bright`
- Unselected option: `○` in `foreground.muted`, label in `foreground.default`
- Footer: `[Enter] Confirm`

**Form** — multiple fields on one page:
- Vertical field list with labels left-aligned in `foreground.muted`
- `Tab` cycles between fields, `Shift+Tab` cycles backwards
- Current field highlighted: label gets copper underline, value area gets
  `backgrounds.raised` background
- Required fields marked with `*` in wizard copper after the label
- Each field renders inline according to its type:
  - Text: cursor-editable input
  - Select: shows current value, `↑`/`↓` to change inline (compact, no dropdown)
  - Toggle: `● Yes  ○ No`, `←`/`→` to switch
- Field-level validation errors shown below the field in `HISE_ERROR_COLOUR`
- Footer: `[Tab] Next field  [Enter] Confirm all`

**Repeat group** — repeatable set of steps:
- After completing the group's inner steps, shows a prompt:
  `Add another [label]? [Y/n]` with count: "2 listeners configured"
- `Y`/`Enter` starts another iteration, `N`/`Escape` advances past the group
- Iteration count shown in header: "Step 3/5 — Add Listener (2 of 4)"

**Preview** — generated output with syntax highlighting:
- Code block rendered with Layer 3 syntax colors (Section 1.4)
- Scrollable with `↑`/`↓` if content exceeds the 14-line content area
- Scroll position indicator on right edge in `foreground.muted`
- Footer: `[Enter] Accept  [c] Copy  [Esc] Reject`

**Pipeline** — sequential task execution with live output:

```
┌──────────────────────────────────────────────────────────┐
│  Step 4/5 — Build                         [Ctrl+C] Abort │
│──────────────────────────────────────────────────────────│
│  ✓ Clone repository              12s                     │
│  ✓ Install build dependencies     3s                     │
│  ⠋ Compile HISE                                          │
│  — Verify build                                          │
│  — Configure & test                                      │
│──────────────────────────────────────────────────────────│
│  [ configuring release build...                          │
│  [ -- Building for x86_64                                │
│  [ compiling juce_audio_basics.cpp                       │
│  [ compiling juce_audio_devices.cpp                      │
│  [ compiling juce_audio_formats.cpp                      │
│                                                          │
│──────────────────────────────────────────────────────────│
│                                 [l] Expand log           │
└──────────────────────────────────────────────────────────┘
```

- **Phase list** (top section): one line per phase, scrolls if >6 phases
  - `✓` in `HISE_OK_COLOUR` — completed, duration in `foreground.muted` right-aligned
  - `⠋` spinner in wizard copper — active (cycles through braille dots `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`)
  - `✗` in `HISE_ERROR_COLOUR` — failed
  - `—` in `foreground.muted` — pending
  - `⊘` in `foreground.muted` — skipped
  - Phase name in `foreground.default` (active phase in `foreground.bright`)
- **Separator** between phase list and log pane: `─` in `foreground.muted`
- **Log pane** (bottom section): streaming output from active phase
  - Lines prefixed with `[` in `foreground.muted` (visual bracket, not literal)
  - Log text in `foreground.muted`
  - Last 8 lines visible in compact mode
  - Press `l` to toggle expanded log: fills entire content area, phase list
    collapses to single line showing current phase name + spinner
- **Progress bar** (if phase reports numeric progress): appears on the active
  phase's line, replacing the spinner. Same style as Section 3.5.
- On failure: phase shows `✗`, log pane shows last error output,
  footer: `[r] Retry  [Esc] Back`
- On all phases complete: footer: `[Enter] Continue`

**Display field** (in form steps) — read-only computed content:
- Rendered in `foreground.muted` on `backgrounds.standard` (no raised stripe)
- Not focusable — `Tab` skips display fields
- Multi-line content wraps within field width, max 4 visible lines, truncated
  with `…` if longer
- Label in `foreground.muted` (same as other form field labels)
- No cursor, no border, no interaction

#### Validation Error Rendering

When the user presses Enter to advance and validation fails (sync or async):

- Error message appears **below the failing field**, one line, in
  `HISE_ERROR_COLOUR` (`#BB3434`)
- In form steps with multiple errors: all error messages shown simultaneously,
  cursor jumps to the first error field
- Error text truncated with `…` if it exceeds the field width
- Errors **persist until the next Enter press** — not cleared on keystroke
- During async validation: brief blocking pause (no spinner). If validation
  takes >2 seconds, `Validating...` appears in the footer in `foreground.muted`

```
│  Module IDs *                                            │
│  [Sampler1, FooModule                               ]    │
│  Unknown module: FooModule                               │  ← HISE_ERROR_COLOUR
│                                                          │
│  Parameters *                                            │
│  [Gain, Attack                                      ]    │
│  Unknown parameter "Attack" for SimpleGain               │  ← HISE_ERROR_COLOUR
```

#### Standalone Mode

Wizards with `standalone: true` (setup, update, migrate, nuke) run without a
REPL session. The overlay renders identically but on a bare background:

- Terminal filled with `backgrounds.standard`
- Wizard panel centered at the same 60×20 fixed size
- Top-left corner of terminal: `HISE` in `SIGNAL_COLOUR` (`#90FFB1`), bold
- No top bar, no bottom bar, no sidebar — just the branded background and
  the wizard panel
- All other rendering (border, header, content, footer) is identical to the
  REPL overlay mode

#### Help Text

Each step can have a description that appears below the title. When the
description exceeds 2 lines, it is truncated with `…`. Press `?` to expand
the full help text in a scrollable area (replaces the option list temporarily;
press `?` again or `Escape` to return to the step).

Help text in `foreground.default`. Inline code in help text uses syntax
highlighting color `ScopedStatement` (`#88bec5`).

---

## 4. Interaction Patterns

### 4.1 Keyboard Shortcuts

| Key              | Action                                    | Scope        |
|------------------|-------------------------------------------|--------------|
| `Enter`          | Submit command; accepts completion + submits when popup visible | Always |
| `Ctrl+C`         | Exit entirely                             | Always       |
| `Ctrl+L`         | Clear output, reset scroll                | Always       |
| `Ctrl+B`         | Toggle sidebar                            | Always       |
| `Ctrl+Space`     | Open command palette                      | Always       |
| `Escape`         | Toggle completion popup (close if open, open with all items if closed); dismiss overlay | Context-dependent |
| `Up` / `Down`    | Navigate completion popup when visible; history navigation otherwise | Context-dependent |
| `PageUp`         | Scroll output up by 80% of viewport      | Always       |
| `PageDown`       | Scroll output down by 80% of viewport    | Always       |
| `Home` / `End`   | Move cursor to start / end of input       | Input focused |
| `Ctrl+A` / `Ctrl+E` | Move cursor to start / end (fn+Left/Right on macOS Ghostty) | Input focused |
| `Option+Left`    | Move cursor to previous word boundary     | Input focused |
| `Option+Right`   | Move cursor to next word boundary         | Input focused |
| `Tab`            | Accept selected completion item           | Input focused |

### 4.2 Input Routing

```
Input starts with "/"  →  Slash command dispatcher (never forwarded to HISE)
Anything else          →  Current mode's parser
```

Slash commands are always available in every mode. They are never recorded in plan mode.

### 4.3 Tab Completion Lifecycle

1. User types any character → engine generates candidates from static JSON data
2. Completion popup appears **immediately** with matching candidates; top candidate
   also appears as **ghost text** in `foreground.muted` after the cursor
3. Ghost text is only shown when cursor is at end of input — mid-string editing
   suppresses ghost text entirely
4. `Up`/`Down` navigate the popup, `Tab` accepts the selected item, `Enter` accepts
   and submits
5. `Escape` toggles: close popup if open, re-open with all candidates if closed
   (discovery mode)
6. Continuing to type narrows candidates; input diverging from all candidates
   auto-dismisses the popup

### 4.4 Command Palette Lifecycle

1. `Ctrl+Space` or `/modes` → palette overlay appears
2. Type to filter modes and commands by name/description
3. `Up`/`Down` navigate, `Enter` selects, `Escape` dismisses
4. Selecting a mode enters it (equivalent to typing the slash command)
5. Palette closes on selection or Escape

### 4.5 Wizard Keyboard Map

When a wizard overlay is active, it captures all keyboard input. The standard
REPL shortcuts (`Ctrl+Space`, `Ctrl+B`, etc.) are inactive while the overlay
is open.

| Key              | Action                                      | Step types       |
|------------------|---------------------------------------------|------------------|
| `↑` / `↓`       | Navigate options                            | select, multi-select |
| `←` / `→`       | Switch toggle value                         | toggle           |
| `Enter`          | Confirm step and advance                    | all              |
| `Escape`         | Go back one step (cancel if step 1)         | all              |
| `Space`          | Toggle item selection                       | multi-select     |
| `a`              | Select all items                            | multi-select     |
| `n`              | Select none                                 | multi-select     |
| `Tab`            | Next field                                  | form             |
| `Shift+Tab`      | Previous field                              | form             |
| `c`              | Copy to clipboard                           | preview          |
| `?`              | Expand/collapse full help text              | all              |
| `Y`              | Add another iteration                       | repeat prompt    |
| `N`              | Finish repeating, advance                   | repeat prompt    |
| `l`              | Toggle compact/expanded log                 | pipeline         |
| `r`              | Retry from failed phase                     | pipeline (on failure) |
| `Ctrl+C`         | Abort pipeline (sends abort signal)         | pipeline (while running) |

### 4.6 Mode Stack

- Modes nest: `builder` → `builder:plan`. Top bar and prompt update on each change.
- `/exit` pops one level. If at root, `/exit` is a no-op (use `Ctrl+C` to quit).
- `Ctrl+C` always exits the application entirely, regardless of nesting depth.
- Entering a new top-level mode (e.g., `/script` while in builder) replaces the stack.

### 4.7 Scroll Behavior

- New output auto-scrolls to bottom (live mode)
- `PageUp`/`PageDown` scroll by 80% of output viewport height
- Scrolling up exits live mode; scroll indicator in bottom bar changes from "live" to
  "history N/M"
- New output while scrolled up does NOT auto-scroll — stays at current position.
  Bottom bar shows a hint that new output is available.
- Scrolling past the bottom returns to live mode

---

## 5. Mode Prompts

### 5.1 Prompt Format

The prompt appears in both the **Top Bar** (mode label) and the **Input** (before cursor).

| Mode              | Top Bar Label        | Input Prompt                   | Accent     |
|-------------------|----------------------|--------------------------------|------------|
| Root              | *(none)*             | `> `                           | `foreground.default` |
| Builder           | `[builder]`          | `[builder] > `                 | Orange     |
| Builder (context) | `[builder]`          | `[builder] SineGen.pitch > `   | Orange     |
| Builder:Plan      | `[builder:plan]`     | `[builder:plan] > `            | Orange     |
| Script            | `[script:Interface]` | `[script:Interface] > `        | Rust       |
| Script (named)    | `[script:MyProc]`    | `[script:MyProc] > `           | Rust       |
| DSP               | `[dsp:MyNetwork]`    | `[dsp:MyNetwork] > `           | Teal       |
| Sampler           | `[sampler:MySampler]`| `[sampler:MySampler] > `       | Green      |
| Inspect           | `[inspect]`          | `[inspect] > `                 | Purple     |
| Project           | `[project]`          | `[project] > `                 | Yellow     |
| Compile           | `[compile]`          | `[compile] > `                 | Magenta    |
| Import            | `[import]`           | `[import] > `                  | Mint       |

In the Input, brackets and mode text are `foreground.muted`. The `>` character uses the
mode accent color. In the Top Bar, the entire `[mode:context]` label uses the mode accent
color (bold).

### 5.2 Script Mode Multi-Line

When unclosed brackets are detected, the prompt continues on the next line:

```
│  [script:Interface] > var x = {                                      │
│                    ...   key: "value",                                │
│                    ...   num: 42                                      │
│                    ... }_                                             │
```

The `...` continuation marker is in `foreground.muted`, aligned to the start of the
previous prompt's input area. Syntax highlighting applies across all continuation lines.

---

## 6. Typography & Spacing

### 6.1 Padding Conventions

| Component    | Horizontal Padding | Notes                              |
|--------------|--------------------|------------------------------------|
| Input        | 2 characters       | `paddingX={2}` — room for prompt   |
| Output       | 2 characters       | Manual spaces, not Ink padding     |
| Progress     | 1 character        | Compact chrome row                 |
| Top Bar      | 1 character        | Minimal chrome padding             |
| Bottom Bar   | 1 character        | Minimal chrome padding             |
| Sidebar      | 1 character each side | Consistent with chrome padding   |

### 6.2 Full-Width Painting

Every row must fill the terminal width with spaces to ensure consistent background
colors. This includes the top bar, output lines, input borders, progress, and bottom
bar. Partial-width rows create visual artifacts where the terminal's default background
bleeds through.

Pattern: render content, then `" ".repeat(remainingWidth)` to fill the row.

### 6.3 Text Overflow

- **No word-wrap**: all text is single-line per logical entry
- **Truncation**: lines exceeding content width are cut and appended with `…`
- **Sidebar**: long entries are truncated to fit the 35-column content width
- **Top bar**: project name is truncated first if the bar exceeds terminal width, then
  mode label, then branding (branding is always at least `HISE`)

### 6.4 Separator Characters

| Character | Usage                                  | Unicode  |
|-----------|----------------------------------------|----------|
| `▎`       | Output left-border on command/result lines | U+258E |
| `█`       | Scrollbar thumb                        | U+2588   |
| `│`       | Scrollbar track, sidebar divider       | U+2502   |
| `─`       | Sidebar heading underline              | U+2500   |
| `├` `└`   | Tree connectors in sidebar             | U+251C U+2514 |
| `●`       | Status dot (bottom bar), palette mode indicator | U+25CF |
| `✓`       | Plan step / validation OK              | U+2713   |
| `✗`       | Validation error                       | U+2717   |
| `⚠`       | Warning                                | U+26A0   |
| `…`       | Truncation indicator, pending step     | U+2026   |
| `░`       | Monitor bar empty segment              | U+2591   |
| `┌` `┐` `└` `┘` `├` `┤` | Completion popup / palette borders | Box Drawing |
