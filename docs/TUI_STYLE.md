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
| Script   | Blue     | `#7aa2f7` |
| DSP      | Cyan     | `#66d9ef` |
| Sampler  | Green    | `#a6e22e` |
| Inspect  | Purple   | `#ae81ff` |
| Project  | Yellow   | `#e6db74` |
| Compile  | Magenta  | `#f92672` |
| Import   | Teal     | `#2de0a5` |

**Wizard accent** (not a mode — a UI chrome color for the wizard overlay):

| Context  | Name     | Hex       |
|----------|----------|-----------|
| Wizard   | Copper   | `#e8a060` |

Used for: wizard overlay border, step indicator highlight, header title, confirm
highlights, selected item markers. See Section 3.10 for full specification.

On light themes (`scheme.light === true`), accents with poor contrast (yellow, green,
cyan) are automatically darkened by ~20% for readability.

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

```ts
interface ColorScheme {
  name: string;
  light?: boolean;      // if true, mode accents auto-darken for contrast
  backgrounds: {
    darker:   string;   // chrome: top bar, bottom bar, progress row
    standard: string;   // content: output area
    sidebar:  string;   // sidebar panel
    raised:   string;   // input area
    overlay:  string;   // command palette, completion dropdown
  };
  foreground: {
    default: string;    // body text, unselected items
    bright:  string;    // result output, emphasis (warm off-white, not stark white)
    muted:   string;    // hints, secondary text, disabled, separators
  };
}
```

**Background tiers** create visual depth:

| Tier    | Name         | Purpose                             | Monokai (default) |
|---------|--------------|-------------------------------------|--------------------|
| 1       | `darker`     | Chrome: top bar, bottom bar, progress | `#1f201c`        |
| 2       | `standard`   | Content: output area                | `#272822`          |
| 3       | `sidebar`    | Sidebar panel                       | `#2d2e28`          |
| 4       | `raised`     | Input area                          | `#32342d`          |
| 5       | `overlay`    | Command palette, completion popup   | `#3e3f38`          |

**Foreground tiers:**

| Tier    | Purpose                                          | Monokai (default) |
|---------|--------------------------------------------------|--------------------|
| default | Body text, output info lines, unselected items   | `#a0a09a`          |
| bright  | Result output lines, emphasized text              | `#d0d0c8`          |
| muted   | Hints, secondary text, disabled, separators       | `#75715e`          |

### 1.6 Shipped Schemes

Each scheme is just 8 color values + a name. Target: 6 dark + 2 light.

| Scheme            | Type | Darker    | Standard  | Sidebar   | Raised    | Overlay   | Default   | Bright    | Muted     |
|-------------------|------|-----------|-----------|-----------|-----------|-----------|-----------|-----------|-----------|
| Monokai (default) | dark | `#1f201c` | `#272822` | `#2d2e28` | `#32342d` | `#3e3f38` | `#a0a09a` | `#d0d0c8` | `#75715e` |
| Dracula           | dark | `#21222c` | `#282a36` | `#2d2f3d` | `#343746` | `#414558` | `#a0a4b8` | `#d4d6e4` | `#6272a4` |
| Nord              | dark | `#242933` | `#2e3440` | `#333a47` | `#3b4252` | `#4c566a` | `#9aa3b6` | `#d8dee9` | `#616e88` |
| Tokyo Night       | dark | `#16161e` | `#1a1b26` | `#1f202d` | `#24283b` | `#33375a` | `#9098b8` | `#c0caf5` | `#565f89` |
| One Dark          | dark | `#1e2127` | `#282c34` | `#2d313a` | `#323842` | `#3e4452` | `#9aa2b1` | `#d4d8e0` | `#5c6370` |
| Catppuccin Mocha  | dark | `#181825` | `#1e1e2e` | `#232336` | `#313244` | `#45475a` | `#9399b2` | `#cdd6f4` | `#585b70` |
| Catppuccin Latte  | light | `#dce0e8` | `#eff1f5` | `#e6e9ef` | `#ccd0da` | `#bcc0cc` | `#5c5f77` | `#4c4f69` | `#8c8fa1` |
| Solarized Light   | light | `#eee8d5` | `#fdf6e3` | `#f5eedb` | `#e8e1ce` | `#d6cfbc` | `#586e75` | `#073642` | `#93a1a1` |

Scheme selection: `/theme` lists available schemes with a preview. `/theme <name>`
switches and persists to config. The current scheme name is stored in the hise-cli
config file.

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

### 2.3 Sidebar

- **Position**: right side, separated by a 1-character vertical divider (`│`) in
  `foreground.muted`
- **Width**: fixed 35 characters content + 1 divider = 36 columns total
- **Background**: `backgrounds.sidebar`
- **Toggle**: `Ctrl+B` or `/sidebar`. Auto-hides when terminal width < 80 columns.
- **Header**: heading text in the mode's accent color, underlined with `foreground.muted`

**Sidebar content per mode:**

| Mode              | Heading     | Content                                          |
|-------------------|-------------|--------------------------------------------------|
| Builder (live)    | `TREE`      | Module tree hierarchy, updated on each command   |
| Builder (plan)    | `PLAN`      | Numbered plan steps with `✓`/`…`/`✗` status     |
| DSP               | `GRAPH`     | Node graph outline (nested containers)           |
| Sampler           | `SELECTION` | Selection count, key range, velocity, layer info |
| Script            | `API`       | Method list for last-referenced class            |
| Inspect           | `MONITOR`   | Live CPU/voices/memory bars (SSE-driven)         |
| Project           | `PROJECT`   | Asset counts, settings summary                   |
| Compile           | `TARGETS`   | Build target list with status indicators         |
| Import            | *(hidden)*  | No sidebar — simple command mode                 |

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
| Thumb   | `█`       | SIGNAL_COLOUR        |
| Track   | `│`       | `foreground.muted`   |

Thumb height is proportional: `max(1, round(visibleRows² / totalRows))`.

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
│  [builder:plan] > add LFO to Sampler1.pitch_                        │  ← input row (raised)
│                                                                      │  ← bottom border (raised)
```

**Prompt format:**

| State              | Prompt                         | Colors                              |
|--------------------|--------------------------------|-------------------------------------|
| Root (no mode)     | `> `                           | `>` in `foreground.default`         |
| In a mode          | `[mode:context] > `            | Brackets and text in `foreground.muted`, `>` in mode accent |
| Disabled (pending) | `waiting for response...`      | `foreground.muted`, no cursor       |

**Syntax highlighting** (see Section 1.4): In script mode, the input text is tokenized
and each token rendered with its HISE editor color. In builder/DSP mode, partial
highlighting applies to strings, numbers, and known identifiers. Other modes render
input as plain `foreground.default`.

**Ghost text completion**: The top completion candidate appears after the cursor in
`foreground.muted`. Typing characters that match the ghost text accepts it
incrementally. Tab accepts the full ghost text.

**Multi-line** (script mode): When brackets are unclosed, the prompt changes to a
continuation indicator `...` aligned to the main prompt. The opening bracket is
highlighted in `#FFFFFF` (Bracket color) to show what's being continued.

Background: `backgrounds.raised` for all three rows. Horizontal padding: 2 characters.

### 3.4 CompletionPopup

Dropdown that appears above the input line when Tab is pressed or after typing 2+
characters with matches.

```
│  ┌──────────────────────────────┐                                    │
│  │  AHDSR          EnvelopeMod  │  ← selected: SIGNAL_COLOUR bg     │
│  │  TableEnvelope  EnvelopeMod  │                                    │
│  │  MPEModulator   EnvelopeMod  │                                    │
│  │  LFO            TimeVariant  │                                    │
│  └──────────────────────────────┘                                    │
│  [builder] > add A_                                                  │
```

| Element          | Color / Style                                      |
|------------------|----------------------------------------------------|
| Background       | `backgrounds.overlay`                              |
| Border           | `foreground.muted`                                 |
| Item name        | `foreground.default`                               |
| Item annotation  | `foreground.muted` (type, category, or signature)  |
| Selected item bg | SIGNAL_COLOUR with darkened alpha (~30%)            |
| Selected item fg | `foreground.bright`                                |

- **Position**: directly above input, left-aligned to the token being completed
- **Width**: adapts to content, max 50% of available width
- **Height**: max 8 visible items, scrollable
- **Dismiss**: Escape, submitting, or input diverging from all candidates
- **Navigation**: Up/Down arrows, Enter or Tab to accept

Ghost text inline in the input shows the top candidate. The dropdown shows alternatives.

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

### 3.8 Sidebar

Right-side panel with mode-determined content. See Section 2.3 for dimensions and toggle.

```
│  PLAN                          │  ← heading in mode accent, bold
│  ───────────────────────────── │  ← underline in foreground.muted
│  1 ✓ add StreamingSampler      │  ← ✓ in HISE_OK_COLOUR
│      as "Sampler 1"            │
│  2 ✓ add AHDSR                 │
│      to Sampler1.gain          │
│  3 … add LFO                   │  ← … in foreground.muted (pending)
│      to Sampler1.pitch         │
│                                │
```

| Element          | Color                          |
|------------------|--------------------------------|
| Heading          | Mode accent, bold              |
| Underline        | `foreground.muted`             |
| Step number      | `foreground.muted`             |
| Step `✓`         | HISE_OK_COLOUR                 |
| Step `✗`         | HISE_ERROR_COLOUR              |
| Step `…`         | `foreground.muted`             |
| Step text        | `foreground.default`           |
| Tree connectors  | `foreground.muted` (`├`, `└`, `│`, `─`) |

Background: `backgrounds.sidebar`. Content is scrollable when it exceeds the available
height. Scrollbar uses the same style as the Output scrollbar (SIGNAL_COLOUR thumb,
`foreground.muted` track).

**Mode-specific sidebar rendering:**

- **TREE** (Builder live): Indented module tree. Type abbreviations in `foreground.muted`.
  Selected module highlighted with SIGNAL_COLOUR background.
- **PLAN** (Builder plan): Numbered steps with status prefix as shown above.
- **GRAPH** (DSP): Indented node tree with factory prefix in ScopedStatement color (`#88bec5`).
- **SELECTION** (Sampler): Selection count, key range (e.g., `C1–C5`), velocity range,
  active layers. Numbers in `foreground.bright`.
- **API** (Script): Method list for the last-referenced class. Method names in Identifier
  color (`#DDDDFF`), return types in `foreground.muted`.
- **MONITOR** (Inspect): Live-updating metrics. See Section 3.9.
- **TARGETS** (Compile): Target name + status (`✓` built, `…` building, `✗` failed, `—` pending).
- **PROJECT**: Asset category counts (Samples: 142, Scripts: 8, Networks: 3, etc.)

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
vertically over the REPL content. The REPL remains visible behind the overlay
(dimmed by the overlay background).

**Background**: `backgrounds.overlay`. **Border**: single-line box drawing characters
(`┌─┐│└─┘`) in wizard copper accent `#e8a060`.

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

| Key            | Action                                    | Scope        |
|----------------|-------------------------------------------|--------------|
| `Enter`        | Submit command / accept palette selection  | Always       |
| `Ctrl+C`       | Exit entirely                             | Always       |
| `Ctrl+L`       | Clear output, reset scroll                | Always       |
| `Ctrl+B`       | Toggle sidebar                            | Always       |
| `Ctrl+Space`   | Open command palette                      | Always       |
| `Escape`       | Dismiss overlay (palette / completion)    | When overlay visible |
| `Up` / `Down`  | History navigation (no overlay) or navigate overlay items | Context-dependent |
| `PageUp`       | Scroll output up by 80% of viewport      | Always       |
| `PageDown`     | Scroll output down by 80% of viewport    | Always       |
| `Tab`          | Accept ghost text / open completion popup | Input focused |

### 4.2 Input Routing

```
Input starts with "/"  →  Slash command dispatcher (never forwarded to HISE)
Anything else          →  Current mode's parser
```

Slash commands are always available in every mode. They are never recorded in plan mode.

### 4.3 Tab Completion Lifecycle

1. User types 2+ characters → engine generates candidates from static JSON data
2. Top candidate appears as **ghost text** in `foreground.muted` after the cursor
3. `Tab` press: if ghost text visible, accepts it; if no ghost text, opens dropdown
4. Dropdown open: `Up`/`Down` navigate, `Enter`/`Tab` accept, `Escape` dismisses
5. Continuing to type narrows candidates; input diverging from all candidates dismisses

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
| Builder:Plan      | `[builder:plan]`     | `[builder:plan] > `            | Orange     |
| Script            | `[script:Interface]` | `[script:Interface] > `        | Blue       |
| Script (named)    | `[script:MyProc]`    | `[script:MyProc] > `           | Blue       |
| DSP               | `[dsp:MyNetwork]`    | `[dsp:MyNetwork] > `           | Cyan       |
| Sampler           | `[sampler:MySampler]`| `[sampler:MySampler] > `       | Green      |
| Inspect           | `[inspect]`          | `[inspect] > `                 | Purple     |
| Project           | `[project]`          | `[project] > `                 | Yellow     |
| Compile           | `[compile]`          | `[compile] > `                 | Magenta    |
| Import            | `[import]`           | `[import] > `                  | Teal       |

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
