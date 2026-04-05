# Wizard Conversion Guide

> Agent guideline for converting HISE C++ multipage dialog JSON files into
> YAML wizard definitions for hise-cli. Load this document as context when
> converting a wizard JSON from `data/wizards/`.

---

## Overview

HISE has a C++ multipage dialog system that renders wizard-like UIs from JSON
definitions. The conversion pipeline transforms these JSON files into YAML
wizard definitions that the engine loads at runtime.

**Pipeline**: JSON → `parseWizardJson()` → `WizardDefinition` → `wizardToYaml()` → `.yaml` file

The parser (`src/engine/wizard/parser.ts`) automates most of the structural
conversion. The output needs manual review for cosmetic cleanup (tab labels,
help text, descriptions) and adding metadata the parser can't infer.

**Target location**: `data/wizards/<wizard_id>.yaml`

**Type definitions**: `src/engine/wizard/types.ts`

---

## Source Format Reference

### Top-Level Structure

Every wizard JSON has 5 sections:

| Section       | Purpose                              | Action         |
|---------------|--------------------------------------|----------------|
| `StyleData`   | C++ GUI fonts and ARGB color ints    | **Discarded**  |
| `Properties`  | Wizard metadata                      | Extract `Header` → `header` |
| `LayoutData`  | CSS stylesheets, dialog dimensions   | **Discarded**  |
| `GlobalState` | Initial variable values              | Map to `globalDefaults` |
| `Children`    | **Page/step tree — the gold**        | **Converted**  |

### Component Types

| C++ Type             | Description                              | Maps to                      |
|----------------------|------------------------------------------|------------------------------|
| `TextInput`          | Text field                               | `text` field                 |
| `Button` (shared ID) | Radio button group (multiple with same ID) | `choice` field (deduped)   |
| `Button` (unique ID) | Boolean toggle                           | `toggle` field               |
| `Choice`             | Dropdown selector                        | `choice` field               |
| `TagList`            | Multi-selection tag buttons              | *(skipped by parser)*        |
| `MarkdownText`       | Static descriptive text                  | *(skipped — add to `body`)* |
| `SimpleText`         | Plain label text                         | *(skipped)*                  |
| `Branch`             | Conditional page selection               | Conditional tab (`condition`) |
| `List`               | Vertical layout container (= page/group) | Container — recurse into    |
| `Column`             | Horizontal layout with width ratios      | Container — recurse into    |
| `FileSelector`       | File/directory picker                    | `file` field                 |
| `JavascriptFunction` | Inline or bound code                     | *(skipped)*                  |
| `LambdaTask`         | C++ function call on submit              | `tasks[]` entry              |
| `Button` (Trigger)   | Post-action trigger button               | `postActions[]` entry        |
| `Placeholder`        | Special content area                     | *(skipped)*                  |
| `Skip`               | Empty placeholder in branch              | *(skipped — empty branch)*  |
| `ColourChooser`      | Color picker                             | *(not handled — add manually as text)* |

### Key Component Properties

**TextInput:**
- `Text` → `label`, `ID` → `id`, `EmptyText` → `emptyText`, `Required` → `required`
- `Help` → `help`, `ParseArray` → `parseArray`
- `Items: "{DYNAMIC}"` → not handled by parser (note in help text)

**Button (radio group — shared ID):**
- Multiple `Button` elements with the same `ID` → parser merges into single `choice` field
- `Text` values become `items`, first button's `Help` becomes `help`

**Choice:**
- `Items` (newline-separated) → `items` array
- `ValueMode: "Text"` → `valueMode: "text"`, otherwise `valueMode: "index"`

**FileSelector:**
- `Directory` → `directory`, `Wildcard` → `wildcard`, `SaveFile` → `saveFile`

**Branch:**
- `ID` → `condition.fieldId` on child tabs
- Children indexed positionally → `condition.value` = `String(index)`

---

## Target Format

YAML files are 1:1 serializations of `WizardDefinition` (see
`src/engine/wizard/types.ts` for the full interface). Example:

```yaml
id: new_project
header: Create New Project
description: Creates and initialises a new HISE project folder
body: |
  Markdown body text with usage tips, bullet points, etc.

  > Blockquotes render as description text.

tabs:
  - label: Settings
    fields:
      - id: ProjectName
        type: text
        label: Project Name
        required: true
        help: The name of the project folder to create
        emptyText: Enter a project name
      - id: DefaultProjectFolder
        type: file
        label: Location
        required: true
        help: Parent folder where the project will be created
        directory: true
      - id: Template
        type: choice
        label: Project Template
        help: Choose how to initialise the project
        defaultValue: "0"
        items:
          - Empty Project
          - Import HXI
          - Rhapsody Template
        itemDescriptions:
          - Blank project with default settings
          - Import a previously exported .hxi archive
          - Player template with Rhapsody layout
        valueMode: index

  - label: Import
    fields:
      - id: hxiFile
        type: file
        label: HXI File
        help: Select the .hxi or .lwc file to extract
        wildcard: "*.hxi,*.lwc"
    condition:
      fieldId: Template
      value: "1"

submitLabel: Creates a folder and switches the HISE project
tasks:
  - id: createEmptyProject
    function: createEmptyProject

postActions: []

globalDefaults:
  DefaultProjectFolder: ""
  Template: "0"
```

### Field Types

| Type          | Properties                                   | Notes                         |
|---------------|----------------------------------------------|-------------------------------|
| `text`        | `emptyText`, `parseArray`                    | Single-line text input        |
| `file`        | `directory`, `wildcard`, `saveFile`          | Path input with completion    |
| `choice`      | `items`, `itemDescriptions`, `valueMode`     | Single selection from list    |
| `toggle`      | *(none specific)*                            | Boolean on/off                |
| `multiselect` | `items`, `itemDescriptions`, `valueMode`     | Multiple selections from list |

### Common Field Properties

All fields share: `id`, `type`, `label`, `required`, `help`, `defaultValue`.

### Conditional Tabs

A tab with a `condition` is only active when the referenced field has the
specified value:

```yaml
condition:
  fieldId: Template    # ID of the controlling field
  value: "1"           # value (or index) that activates this tab
```

---

## Automated Conversion

`parseWizardJson(filename, raw)` in `src/engine/wizard/parser.ts` handles:

| Feature                     | How                                         |
|-----------------------------|---------------------------------------------|
| Page → Tab                  | Each page with input fields becomes a tab   |
| TextInput → `text` field    | Maps all properties directly                |
| FileSelector → `file` field | Maps Directory, Wildcard, SaveFile          |
| Choice → `choice` field     | Splits newline-separated Items into array   |
| Button (unique ID) → `toggle` | Detects non-trigger, non-text buttons     |
| Button (shared ID) → `choice` | Radio-group deduplication into single field |
| Branch → conditional tabs   | Each non-empty branch child becomes a tab with `condition` |
| GlobalState → `globalDefaults` | All values normalized to strings          |
| LambdaTask → `tasks[]`     | Extracts `id` and `function` from all pages |
| Trigger Button → `postActions[]` | From last page only                    |
| Tab labels                  | From page `Text` or positional defaults     |

**Not handled** (manual work):

- `description`, `body`, `submitLabel` — not present in source JSON structure
- `itemDescriptions` for choice fields — not in C++ Choice elements
- `MarkdownText` / `SimpleText` content — skipped (fold into `body` or `help`)
- `TagList` → `multiselect` — not extracted (add manually)
- `ColourChooser` — not extracted (add as `text` field with hex format note)
- `JavascriptFunction` / `Placeholder` — skipped (note TODOs in help if relevant)
- Help text cleanup — parser preserves raw C++ help text verbatim

### Running the conversion

```ts
import { parseWizardJson } from "./src/engine/wizard/parser.js";
import { wizardToYaml } from "./src/engine/wizard/yaml.js";

const raw = JSON.parse(fs.readFileSync("data/wizards/source.json", "utf8"));
const def = parseWizardJson("wizard_id", raw);
const yaml = wizardToYaml(def);
fs.writeFileSync("data/wizards/wizard_id.yaml", yaml);
```

---

## Manual Review Checklist

After running the parser, review and fix:

- [ ] **`header`**: Parser extracts from `Properties.Header` — verify it reads well
- [ ] **`description`**: Add a short one-line description (not extracted)
- [ ] **`body`**: Write markdown body from `MarkdownText` elements in the source JSON
- [ ] **`submitLabel`**: Add a description of what happens on submit (not extracted)
- [ ] **Tab labels**: Parser uses `Text` from page element or positional defaults
      (`Settings`, `Execution`, `Complete`, etc.) — rename to something meaningful
- [ ] **Help text**: Remove C++ GUI references (see rewriting table below)
- [ ] **`itemDescriptions`**: Add per-item descriptions for choice fields
- [ ] **`valueMode`**: Parser defaults to `"index"` — verify this matches HISE behavior.
      Use `"text"` when the C++ Choice has `ValueMode: "Text"`
- [ ] **Conditional tab `value`**: Parser uses positional index (`"0"`, `"1"`, ...).
      If the controlling field uses `valueMode: "text"`, change to the text value
- [ ] **Missing fields**: Check for `TagList`, `ColourChooser`, or `FileSelector`
      elements that the parser skipped — add manually
- [ ] **Unused elements**: Verify no important `MarkdownText` or `SimpleText` content
      was lost — fold into `body` or field `help` as appropriate

---

## Help Text Rewriting

The C++ wizard help text references HISE desktop UI elements. Rewrite for TUI/CLI:

| C++ reference                     | TUI equivalent                        |
|-----------------------------------|---------------------------------------|
| "as shown in the Component List"  | "as listed by `inspect components`"   |
| "as shown in the Patch Browser"   | "as listed by `show tree`"            |
| "broadcaster map"                 | keep as-is (concept name)             |
| "click on", "right click"         | remove (no mouse in TUI)              |
| "this dialog", "this popup"       | "this wizard"                         |

General principles:
- Keep technical content and API references intact
- Remove CSS/layout references
- Simplify verbose explanations — help text should be 1-3 sentences
- Preserve code examples and parameter names in backticks
- Remove references to visual elements that don't exist in TUI

---

## Verification Checklist

After converting and reviewing a wizard YAML, verify:

- [ ] Every page in the source `Children` array maps to a tab or has its content
      folded into `body`/`help`
- [ ] Every `Branch` child with input fields has a corresponding conditional tab
- [ ] Every `Required: true` field has `required: true`
- [ ] All radio button groups (shared ID) are merged into single `choice` fields
- [ ] Help text is cleaned up (no C++ UI references)
- [ ] `GlobalState` default values appear in `globalDefaults`
- [ ] `tasks` includes all `LambdaTask` functions from the source
- [ ] `postActions` captures trigger buttons from the last page
- [ ] No `StyleData`, `LayoutData`, CSS, or ARGB color values remain
- [ ] YAML parses cleanly: `yamlToWizard(yaml)` returns a valid `WizardDefinition`
- [ ] The wizard appears in `hise-cli wizard list` after placement in `data/wizards/`
