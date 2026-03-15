# Wizard Conversion Guide

> Agent guideline for converting HISE C++ multipage dialog JSON files into
> TypeScript `WizardDefinition` objects for hise-cli. Load this document as
> context when converting a wizard JSON from `data/wizards/`.

---

## Overview

HISE has a C++ multipage dialog system that renders wizard-like UIs from JSON
definitions. The files in `data/wizards/` are these JSON definitions. They
contain rich data (page layouts, component types, option lists, help text,
branching logic) but are tightly coupled to the C++ rendering system (CSS
styles, ARGB color integers, inline JavaScript, positional branching).

This guide describes how to transform them into TypeScript `WizardDefinition`
objects (see [DESIGN.md](../DESIGN.md) "Wizard Framework" for the target
type definitions). The conversion is not a mechanical format translation — it
requires judgment calls about grouping, help text rewriting, and resolver
function design.

---

## Source Format Reference

### Top-Level Structure

Every wizard JSON has 5 sections:

| Section       | Purpose                              | Action         |
|---------------|--------------------------------------|----------------|
| `StyleData`   | C++ GUI fonts and ARGB color ints    | **Discard**    |
| `Properties`  | Wizard metadata                      | Extract `Header` → `name` |
| `LayoutData`  | CSS stylesheets, dialog dimensions   | **Discard**    |
| `GlobalState` | Initial variable values              | Map to field defaults |
| `Children`    | **Page/step tree — the gold**        | **Convert**    |

### Component Types

These are all the component types found across existing wizard JSONs:

| C++ Type             | Description                              | Maps to                |
|----------------------|------------------------------------------|------------------------|
| `TextInput`          | Text field                               | `text` field/step      |
| `Button` (shared ID) | Radio button group (multiple with same ID) | `select` step        |
| `Button` (unique ID) | Boolean toggle                           | `toggle` field/step   |
| `Choice`             | Dropdown selector                        | `select` field/step   |
| `TagList`            | Multi-selection tag buttons              | `multi-select` step   |
| `MarkdownText`       | Static descriptive text                  | Step `description`    |
| `SimpleText`         | Plain label text                         | Step `description` or label |
| `Branch`             | Conditional page selection               | `showIf` on steps     |
| `List`               | Vertical layout container (= page/group) | `form` step or step grouping |
| `Column`             | Horizontal layout with width ratios      | Layout hint (discard) |
| `FileSelector`       | File/directory picker                    | `text` field with resolver |
| `ColourChooser`      | Color picker                             | `text` field with hex validation |
| `JavascriptFunction` | Inline or bound code                     | Resolver or discard   |
| `LambdaTask`         | C++ function call on submit              | `WizardOutput.execute` TODO |
| `CoallascatedTask`   | Sequential task chain                    | Multi-step output TODO |
| `DownloadTask`       | URL download                             | Resolver or output TODO |
| `Skip`               | Empty placeholder in branch              | `showIf: () => false` |
| `Placeholder`        | Special content area                     | `preview` step        |

### Key Component Properties

**TextInput:**
- `Text` → field label
- `ID` → field id in answers map
- `EmptyText` → placeholder
- `Required` → add validation
- `Help` → description (markdown)
- `Multiline` → note in description (TUI text input is single-line)
- `ParseArray` → the value is comma-separated, parsed as array
- `Items: "{DYNAMIC}"` → needs a `resolve` function
- `Items: "Foo\nBar\nBaz"` → could be a `select` instead of text
- `CallOnTyping` → irrelevant for TUI (discard)
- `Height` → irrelevant for TUI (discard)
- `Code: "{BIND::name}"` → bound function, note as TODO

**Button (radio group — shared ID):**
- Multiple `Button` elements with the same `ID` form a radio group
- `Text` → option label
- `Help` → option description
- `InitValue: "true"` / `UseInitValue: true` → default selection
- The containing `Column` with `Class: ".button-selector"` is a layout hint (discard)

**Choice:**
- `Items` → newline-separated option list
- `ValueMode: "Text"` → value is the label string
- `ValueMode: "Index"` → value is the zero-based index (convert to named values)
- `Help` → description

**TagList:**
- `Items` → newline-separated list of selectable tags
- Maps to `multi-select` step

**Branch:**
- `ID` → references the controlling selector field
- `Children[]` → indexed by the selector's value (child 0 for option 0, etc.)
- Convert to `showIf` predicates that check the named value

---

## Transformation Rules

### 1. Pages → Steps

Each top-level entry in `Children` is a page. Walk each page:

- If the page contains **only a selector** (radio buttons or Choice): create a
  `select` step.
- If the page contains **only a MarkdownText + selector**: create a `select`
  step with the markdown as `description`.
- If the page contains **multiple input fields**: create a `form` step. Each
  input component becomes a `FormField`.
- If the page contains **only MarkdownText** (intro/outro): fold the text into
  the `description` of the next/previous step, or omit if it's purely
  decorative.
- If the page contains a **Placeholder with CustomResultPage**: create a
  `preview` step.

### 2. Radio Buttons → Select Step

Multiple `Button` elements sharing the same `ID`:

```json
{ "Type": "Button", "Text": "ComplexData", "ID": "attachType", "Help": "..." },
{ "Type": "Button", "Text": "ComponentValue", "ID": "attachType", "Help": "..." }
```

Becomes:

```ts
{
  type: "select",
  id: "attachType",
  title: "Event Source",
  description: "Select the event type...",
  options: [
    { label: "Complex Data", value: "ComplexData", description: "..." },
    { label: "Component Value", value: "ComponentValue", description: "..." },
  ],
}
```

- Use `Text` as both `label` and `value` (values must be stable identifiers)
- Clean up `label` for display (add spaces to camelCase if needed)
- Preserve `Help` as option `description`, but clean up markdown
- If one button has `InitValue: "true"`, note it as the default

### 3. Branch → showIf

A `Branch` with `ID: "attachType"` and 12 children maps to 12 conditional
steps/forms, one per option:

```ts
{
  type: "form",
  id: "complexDataConfig",
  title: "Complex Data Configuration",
  showIf: (answers) => answers.attachType === "ComplexData",
  fields: [ /* fields from the branch child */ ],
}
```

The Branch's children are positionally indexed (child 0 = first option,
child 1 = second option, etc.). Map each index to the corresponding option
value from the selector step. If a branch child contains only a `Skip`
element, omit the step entirely (it's the "no configuration needed" case).

### 4. TextInput → Text Field

```json
{
  "Type": "TextInput",
  "Text": "Module IDs",
  "ID": "moduleIds",
  "EmptyText": "Enter module IDs...",
  "Required": true,
  "ParseArray": true,
  "Items": "{DYNAMIC}",
  "Help": "The ID of the module..."
}
```

Becomes a `FormField`:

```ts
{
  type: "text",
  id: "moduleIds",
  label: "Module IDs",
  placeholder: "Enter module IDs...",
  required: true,
  description: "The ID of the module...",
  // TODO: resolve function — fetch module IDs from GET /api/builder/tree
}
```

- `ParseArray: true` → note that the runtime should split on commas
- `Items: "{DYNAMIC}"` → flag with a `// TODO: resolve` comment and
  specify which REST API endpoint would provide the data
- `Items: "Foo\nBar"` (static list) → consider converting to a `select`
  field instead of text
- `Multiline: true` → note in description; TUI text input is single-line,
  the user enters comma-separated values instead

### 5. Choice → Select Field

```json
{
  "Type": "Choice",
  "Text": "DataType",
  "ID": "complexDataType",
  "ValueMode": "Text",
  "Items": "Table\nSliderPack\nAudioFile"
}
```

Becomes:

```ts
{
  type: "select",
  id: "complexDataType",
  label: "Data Type",
  options: [
    { label: "Table", value: "Table" },
    { label: "SliderPack", value: "SliderPack" },
    { label: "AudioFile", value: "AudioFile" },
  ],
}
```

- If `ValueMode` is `"Index"`, convert index values to meaningful string
  values (use the item text as the value)

### 6. TagList → Multi-Select Step

```json
{
  "Type": "TagList",
  "ID": "FileTypeFilter",
  "Items": "Scripts\nAdditionalSourceCode\nSamples\nImages"
}
```

Becomes:

```ts
{
  type: "multi-select",
  id: "FileTypeFilter",
  title: "File Type Filter",
  options: [
    { label: "Scripts", value: "Scripts" },
    { label: "Additional Source Code", value: "AdditionalSourceCode" },
    { label: "Samples", value: "Samples" },
    { label: "Images", value: "Images" },
  ],
}
```

### 7. Foldable List → Toggle + Conditional Form

A `List` with `Foldable: true` / `Folded: true` represents an optional
section. Convert to a toggle step followed by a conditional form:

```ts
{
  type: "toggle",
  id: "useWildcards",
  title: "Configure Wildcards",
  description: "Set include/exclude patterns for file filtering",
  default: false,
},
{
  type: "form",
  id: "wildcardConfig",
  title: "Wildcard Configuration",
  showIf: (answers) => answers.useWildcards === true,
  fields: [ /* fields from the foldable section */ ],
}
```

### 8. FileSelector → Text Field with Resolver

```ts
{
  type: "text",
  id: "DefaultProjectFolder",
  label: "Location",
  placeholder: "Enter project path...",
  required: true,
  description: "Choose a folder for the HISE project",
  // TODO: path completion resolver — list directories from filesystem
}
```

Note that the TUI cannot show a native file dialog. The resolver should
provide path completion (listing directory contents as suggestions).

### 9. ColourChooser → Text Field with Validation

```ts
{
  type: "text",
  id: "colour",
  label: "Colour",
  placeholder: "#RRGGBB or 0xAARRGGBB",
  validate: (v) => /^(#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{8})$/.test(v) ? null : "Invalid color format",
}
```

### 10. JavascriptFunction → Discard or TODO

- `{BIND::functionName}` → note the function name as a TODO for
  reimplementation in TypeScript
- Inline `Code` → read to understand behavior, discard the code itself
- `EventTrigger: "OnSubmit"` → likely maps to wizard output logic

### 11. LambdaTask / CoallascatedTask → WizardOutput

These represent the final action when the wizard completes:

```ts
output: {
  type: "apply",
  execute: async (answers, hise) => {
    // TODO: implement — calls REST API endpoint(s)
    // Original C++ function: "createEmptyProject"
  },
}
```

### 12. Placeholder with CustomResultPage → Preview Step

```ts
{
  type: "preview",
  id: "result",
  title: "Generated Code",
  generate: (answers) => {
    // TODO: implement code generation from answers
    return {
      content: generateBroadcasterCode(answers),
      language: "hisescript",
      actions: ["accept", "copy", "reject"],
    };
  },
}
```

---

## Help Text Rewriting

The C++ wizard help text references HISE desktop UI elements. Rewrite for
the TUI/CLI context:

| C++ reference                     | TUI equivalent                        |
|-----------------------------------|---------------------------------------|
| "as shown in the Component List"  | "as listed by `inspect components`"   |
| "as shown in the Patch Browser"   | "as listed by `show tree`"            |
| "broadcaster map"                 | keep as-is (concept name)             |
| "click on", "right click"         | remove (no mouse in TUI)              |
| "this dialog", "this popup"       | "this wizard"                         |
| Markdown blockquotes (`> ...`)    | keep — will render as description text |
| Markdown headers (`### ...`)      | remove — the step title replaces these |
| `\n` literal in strings           | replace with actual newlines           |

General principles:
- Keep technical content and API references intact
- Remove CSS/layout references
- Simplify verbose explanations — TUI descriptions should be 1-3 sentences
- Preserve code examples and parameter names in backticks
- Remove references to visual elements that don't exist in TUI

---

## Dynamic Data Mapping

When a field has `Items: "{DYNAMIC}"`, determine which REST API endpoint
provides the data:

| Field context         | REST API endpoint                    | Data path           |
|-----------------------|--------------------------------------|---------------------|
| Component IDs         | `GET /api/list_components`           | `[].id`             |
| Module IDs            | `GET /api/builder/tree`              | flatten tree → IDs  |
| Module parameters     | `GET /api/meta/module_types` or local `moduleList.json` | `parameters[].id` |
| Radio group IDs       | `GET /api/list_components` + filter  | components with `radioGroup` property |
| Script properties     | hardcode common list: `text`, `enabled`, `visible`, `x`, `y`, `width`, `height`, `colour`, etc. |
| Complex data types    | hardcode: `Table`, `SliderPack`, `AudioFile` |
| EQ event types        | hardcode: `BandAdded`, `BandRemoved`, `BandSelected`, `FFTEnabled` |

Write the resolver function signature with a TODO body:

```ts
resolve: async (answers, hise) => {
  // TODO: fetch from GET /api/list_components
  // return components.map(c => ({ label: c.id, value: c.id }));
  return [];
},
```

---

## Output Template

The generated `.ts` file should follow this structure:

```ts
import type { WizardDefinition } from "../types.js";

export const broadcasterWizard: WizardDefinition = {
  id: "broadcaster",
  name: "Broadcaster Wizard",
  description: "Create a broadcaster with event sources and listeners",
  modes: ["script"],

  steps: [
    // ... converted steps ...
  ],

  output: {
    type: "preview-then-decide",
  },
};
```

Conventions:
- Named export, no default export
- Variable name: camelCase wizard name + `Wizard` suffix
- File name: kebab-case wizard id + `.ts` (e.g., `broadcaster.ts`)
- Place in `src/engine/wizard/definitions/`
- Import types from `../types.js`
- All TODO comments use the format `// TODO: <description>`
- Resolver functions have a comment explaining the data source

---

## Verification Checklist

After converting a wizard JSON, verify:

- [ ] Every page in the source `Children` array maps to at least one step
- [ ] Every `Branch` child has a corresponding `showIf` step
- [ ] Every `{DYNAMIC}` field has a resolver TODO with the REST API endpoint
- [ ] Every `Required: true` field has validation or `required: true`
- [ ] All radio button groups (shared ID) are collected into single `select` steps
- [ ] Help text is cleaned up (no C++ UI references, no markdown headers)
- [ ] `GlobalState` default values are mapped to field defaults
- [ ] The `output` property matches the source wizard's final action
  (clipboard copy, file write, or API call)
- [ ] `Skip` elements in branches are omitted (no empty steps)
- [ ] The `modes` array is set correctly (which CLI modes can invoke this)
- [ ] No `StyleData`, `LayoutData`, CSS, or ARGB color values remain
