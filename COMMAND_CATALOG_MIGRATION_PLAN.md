# Unified Command Catalogue and `/how` Migration Plan

## Purpose

Migrate hise-cli to one generated, surface-aware command catalogue that drives:

- deterministic intent lookup (`which`),
- shell CLI help,
- interactive TUI `/help`,
- embedded-agent command discovery,
- `/how <question>` in the TUI,
- a future `hise-cli how "<question>" --agent` route,
- command-surface coverage tests and compact AI contracts.

The migration is complete when command syntax, examples, aliases, descriptions, safety metadata, and surface availability are not duplicated in handwritten TypeScript help tables.

This plan intentionally separates **command documentation** from ordinary user-facing text. Parser errors, runtime errors, completion labels, keybindings, onboarding text, and explanatory prose that is not a command contract may remain in source code.

## Non-negotiable constraints

1. `docs/CLI_GRAMMAR.md` remains the canonical language specification. Any grammar, keyword, value-form, chaining, or verb-shape change must update it in the same change.
2. Exact executable command metadata has one source. Generated files are never edited manually.
3. CLI and TUI syntax are distinct renderings of the same command identity. The worker model must never translate between them.
4. `src/engine/` remains isomorphic and must not import `node:` modules.
5. Every public command declares which surfaces support it. Do not invent a CLI form for a TUI-only operation or vice versa.
6. Existing parser and dispatcher behaviour remains the execution source of truth. Catalogue entries must be validated against it.
7. Before removing a handwritten help source, preserve useful conceptual prose in catalogue mode metadata or a deliberately retained non-command document.
8. Follow the pre-1.0 policy: remove obsolete parallel systems after each migration stage rather than maintaining compatibility layers indefinitely.

## Current state

### Generated command metadata

`scripts/generate-agent-context.mjs` reads `docs/agent-context/*.yaml` and writes:

- `src/cli/generated-agent-context.ts`
- `src/cli/generated-ai-contract.ts`

The current generated context covers only the modes represented by YAML files. `src/cli/which.ts` searches this generated data and returns CLI-oriented command recipes.

### Duplicated command documentation

Command descriptions and syntax are currently spread across:

- `docs/agent-context/*.yaml`
- `src/engine/commands/help.ts` (`MODE_HELP`, used by TUI `/help`)
- `src/cli/help.ts` (`SCOPED_HELP`, except selected generated scopes)
- mode-local help builders and constants under `src/engine/modes/`
- `src/cli/command-surface.ts`
- root slash-command descriptions in `src/engine/commands/slash.ts`
- selected global help and AI prompt strings

The duplication permits a command to be discoverable through `which` but absent from TUI help, or documented with CLI flags in one place and modal TUI syntax in another.

### Important baseline task

Start the fresh implementation session by reviewing `git status` and the complete diff. The current working tree may contain prototype `/how`, `hise_which`, and help-tool changes from earlier exploration. Decide explicitly which prototype pieces to retain before beginning the catalogue migration. Do not treat prototype prompts or tool schemas as the final architecture.

## Target architecture

### Shared generated catalogue

Move the generated catalogue to an engine-safe location, for example:

```text
src/engine/commands/generatedCatalog.ts
```

Keep source types in a non-generated engine file, for example:

```text
src/engine/commands/catalogTypes.ts
```

The exact interfaces belong in source code, not this plan. At a conceptual level the catalogue must represent:

- stable command ID,
- owning mode,
- title and purpose,
- aliases and search tags,
- safety classification,
- help visibility and ordering,
- relevant concepts, notes, and anti-patterns,
- supported surfaces,
- one or more executable recipes per supported surface,
- examples linked by semantic command identity,
- optional context requirements such as selected DSP host or current path.

Generated consumers in `src/cli/` and `src/tui/` import this engine-safe catalogue.

### Surface renderings

A command has one identity but may have different representations:

- **CLI**: argv suitable for external automation, including the executable in display form and `--agent` where appropriate.
- **TUI**: an ordered list of input lines, including mode entry and any required context selection.

TUI rendering must support multi-line workflows. A DSP command may require `/dsp`, then `cd <module>`, then the operation. Do not force every TUI representation into a single slash-command string.

Each surface recipe should carry structured argv/input lines plus a generated display string. Display strings must be generated from structured values so quoting is consistent.

### Authored versus derived syntax

Use a staged strategy:

1. Initially add explicit TUI recipes to YAML while retaining existing CLI argv. This establishes a single source immediately and handles genuinely different modal workflows.
2. Add shared renderers for command families where both forms can be derived from semantic fields.
3. Gradually replace paired explicit recipes with semantic recipes when doing so reduces duplication without hiding important context.
4. Keep explicit surface overrides for exceptional commands.

Do not duplicate translation logic inside the generator. Extract reusable pure conversion/normalisation code from `src/cli/args.ts` where practical, and use parser-based validation for all authored recipes.

## Proposed source layout

Continue using `docs/agent-context/` as the authored catalogue directory unless implementation reveals a compelling reason to rename it. Add one YAML document per public mode or command family, including currently missing areas such as:

- root and slash commands,
- inspect,
- project,
- undo,
- wizard operations,
- sequence,
- HISE runtime control,
- analyse,
- publish,
- assets,
- API documentation mode,
- compile and sampler placeholders if they remain public.

Keep `_common.yaml` for cross-surface grammar and output conventions. Do not place exact parser rules there when `docs/CLI_GRAMMAR.md` already owns them; reference the grammar and include only agent-facing operational guidance.

Wizard definitions in `data/wizards/` remain the source for wizard fields and tasks. Catalogue generation should read wizard metadata or generate generic wizard command entries rather than copying wizard inventories by hand.

## Migration phases

### Phase 0 — Inventory and freeze the baseline

1. Run the three verification gates before structural changes.
2. Record all public modes from `ModeId`, `SLASH_MODE_IDS`, the command registry, CLI direct namespaces, and one-shot routes.
3. Inventory command tables and mode-local help strings with repository search.
4. Classify each string as:
   - command contract to migrate,
   - conceptual prose to preserve,
   - parser/runtime error to retain,
   - completion/onboarding text to retain,
   - stale documentation to delete.
5. Compare `src/cli/command-surface.ts` with generated YAML entries and parser branches. Resolve ID mismatches before changing consumers.
6. Add a migration checklist keyed by stable command ID. Do not use file or command counts as completion criteria; use coverage against registries and parser surfaces.

Deliverable: a reviewed inventory in the implementation PR description or a temporary working checklist, not another permanent duplicate command list.

### Phase 1 — Introduce catalogue schema v3

1. Extend the YAML schema with surface-aware recipes and explicit surface availability.
2. Update `scripts/generate-agent-context.mjs` to validate and normalise the new fields.
3. Preserve schema v2 loading temporarily only while migrating existing files. Emit only the new generated shape.
4. Move generated types into the engine layer and make CLI agent-context types consume or re-export them.
5. Generate stable display strings from structured CLI argv and TUI input lines.
6. Add generator diagnostics that include source filename, command ID, and failing field.
7. Add duplicate-ID, duplicate-example, unsupported-surface, and missing-rendering checks.

Acceptance criteria:

- Existing YAML generates the new catalogue.
- Every migrated command clearly declares CLI, TUI, or both.
- Generated files are deterministic.
- Build fails on invalid catalogue data.

### Phase 2 — Add parser-backed surface validation

1. Validate every CLI recipe with `parseCliArgs()` using the real command registry.
2. Validate every TUI recipe through the actual slash dispatcher/mode parser without executing mutations.
3. Add a dry parse API where necessary rather than duplicating parser logic in tests.
4. Verify CLI and TUI recipes resolve to the same stable command identity when both surfaces exist.
5. Handle context-bearing modes explicitly:
   - DSP host selection,
   - builder/UI current paths,
   - script processor/callback context,
   - wizard IDs and overrides.
6. Add negative tests proving CLI flags cannot appear in TUI recipes unless a TUI parser explicitly accepts them.
7. Add tests for quoting, spaces in IDs, arrays, percentages, hex colours, and multi-line payload routes.

Where semantic-equivalence checking is not yet possible, require an explicit validation exception with a reason. Exceptions should be rare and searchable.

### Phase 3 — Migrate existing generated modes

Migrate builder, UI, DSP, script, and MCP YAML first.

1. Add TUI recipes for every command.
2. Reconcile IDs with `src/cli/command-surface.ts`.
3. Move useful TUI concepts from `MODE_HELP` into mode-level catalogue metadata.
4. Preserve CLI concepts already present in YAML.
5. Ensure examples are surface-specific where workflows differ.
6. Generate both CLI and TUI help from the same entries and compare against current output for intentional differences.
7. Replace command-surface assertions with catalogue coverage assertions.

Acceptance criteria:

- `which(query, "cli")` and `which(query, "tui")` return the same command IDs with different renderings.
- Every direct builder/UI/DSP/script command has parser-validated recipes.
- Existing CLI help tests use generated data for both surfaces.

### Phase 4 — Add all remaining modes and root commands

For each remaining public mode:

1. Create or extend its YAML source.
2. Migrate command syntax, purpose, examples, aliases, safety, and ordering.
3. Move conceptual prose into mode metadata.
4. Mark TUI-only or CLI-only commands honestly.
5. Link wizard-backed aliases to their canonical wizard command identity rather than copying workflow details.
6. Generate generic command entries for data-driven wizard operations.
7. Include root slash commands and test/run utilities where they are public and useful to agents.

Special cases:

- Placeholder modes should be marked unavailable or planned rather than advertising executable syntax.
- API and MCP documentation browsers may retain content rendering logic, but their command entry points belong in the catalogue.
- Commands that accept arbitrary HiseScript or payload files should document transport forms without embedding stale code examples.

Acceptance criteria:

- Every public registry command and mode has catalogue metadata or an explicit internal-only exemption.
- `which` searches the complete public command surface.
- Project export, runtime control, screenshots, assets, publishing, and wizard workflows are discoverable without special-case aliases in the model prompt.

### Phase 5 — Switch all help consumers

#### TUI `/help`

1. Replace `MODE_HELP` command tables in `src/engine/commands/help.ts` with a catalogue renderer.
2. Keep root navigation/keybinding prose in source or move it to a dedicated non-command document.
3. Render mode concepts, commands, examples, notes, and caveats from catalogue metadata.
4. Ensure the renderer emits modal TUI lines, never CLI flags.

#### CLI help

1. Replace generated-scope special casing and command-oriented `SCOPED_HELP` sections in `src/cli/help.ts` with catalogue rendering.
2. Retain global output-format and exit-code prose where it is not command-specific.
3. Render CLI argv and examples only.

#### Mode-local help

1. Replace local command tables returned for empty input or `help` with calls to the shared catalogue renderer.
2. Delete duplicated command constants after the mode uses generated help.
3. Retain runtime-generated content such as API class indexes and project-specific lists.

#### AI help tool

1. Make `hise_help` accept an explicit surface and mode.
2. Return only the requested surface representation.
3. Remove prompt instructions that ask a model to translate syntax.

Acceptance criteria:

- No handwritten public command table remains in `src/engine/commands/help.ts`, `src/cli/help.ts`, or mode implementations.
- CLI help contains no TUI-only syntax.
- TUI help contains no shell-only flags.

### Phase 6 — Make `which` surface-aware

1. Extend `executeWhich()` with a requested surface.
2. Keep scoring independent of surface so both surfaces return the same semantic matches.
3. Filter out commands unavailable on the requested surface.
4. Project matched entries to the requested rendering only after ranking.
5. Include owning mode explicitly in each match; do not infer it from the command ID.
6. Preserve score and reason fields for diagnostics.
7. Default the public `hise-cli which` route to CLI output.
8. Add an explicit surface option only if useful publicly; internal callers should always pass a surface.
9. Keep empty matches as a normal structured result for `/how`, while the standalone CLI may retain its current usage-error policy if desired.

Acceptance criteria:

- A UI screenshot intent returns CLI syntax to CLI callers and modal TUI syntax to TUI callers.
- Match IDs and ranking are identical across surfaces when both are supported.
- No model is asked to convert a returned command.

### Phase 7 — Build a shared how-to service

Create one reusable orchestration entry point, conceptually:

```text
runHow(question, surface)
```

Place Node/pi-specific orchestration outside `src/engine/`; keep deterministic retrieval and catalogue selection in the engine layer.

Required behaviour:

1. Use the configured worker model with reasoning disabled or minimal.
2. Use an in-memory session and a tight system prompt.
3. Retrieve `which` evidence for the original question and requested surface.
4. Retrieve mode help alongside it:
   - use owning modes from confident matches,
   - if there are no matches, allow the worker to select one documented high-level mode and retrieve its help,
   - root help is the final fallback when no mode can be selected.
5. Give the worker both evidence sets.
6. Require concise explanation plus exact commands already rendered for the requested surface.
7. Prohibit project inspection, HISE mutation, filesystem browsing, and syntax translation.
8. Return structured evidence as well as rendered Markdown so agent callers can inspect matches and sources.
9. Do not require a live HISE connection; this is static command guidance.

The service should expose progress/tool events without coupling its core result to Ink.

### Phase 8 — Wire both frontends

#### TUI

- `/how <question>` calls `runHow(question, "tui")`.
- Render the answer as Markdown.
- Show compact retrieval activity.
- Reuse embedded AI authentication and worker-model configuration.
- Keep the run ephemeral and out of persistent `/ai` conversations.

#### CLI

Add:

```text
hise-cli how "<question>"
hise-cli how "<question>" --json
hise-cli how "<question>" --agent
```

Requirements:

- `--agent` returns a stable JSON envelope.
- Include concise answer, selected command matches, owning modes, and surface-rendered CLI recipes.
- Remain silent on stderr except for explicit progress in non-JSON mode.
- Do not launch the TUI when invocation is malformed.
- Do not require HISE to be running.
- Add full syntax and examples to CLI help and `docs/CLI_GRAMMAR.md`.

### Phase 9 — Remove obsolete systems

After all consumers have switched:

1. Delete `MODE_HELP` command tables.
2. Delete command-oriented `SCOPED_HELP` entries.
3. Delete mode-local duplicated command help strings.
4. Delete or generate `src/cli/command-surface.ts`; do not leave it as a second authored inventory.
5. Remove generated-help scope allowlists.
6. Remove prompt-level command aliases and topic-routing hints introduced as temporary `/how` fixes.
7. Remove schema v2 compatibility from the generator.
8. Rename generated files if needed so their names reflect the unified catalogue rather than CLI-only agent context.
9. Run a final repository search for command tables, syntax blocks, and stale examples.

Do not remove parser usage errors or dynamic help content merely because they contain command words.

## Rendering and help policy

### What belongs in the catalogue

- Public command syntax
- Surface-specific invocation
- Stable examples
- Purpose and aliases
- Safety classification
- Required context
- Common caveats tied to command use
- Help ordering and visibility

### What remains outside

- Parser errors that describe the immediate invalid input
- Runtime/HISE errors
- Completion menu labels
- Keyboard navigation
- Authentication and onboarding prose
- Dynamic API documentation content
- Dynamic project/module/component/node listings
- Architectural documentation

### Avoid stale duplication

Documentation should reference source locations instead of copying TypeScript interfaces or exact implementation counts. `docs/CLI_GRAMMAR.md` describes the grammar; catalogue YAML enumerates public commands and renderings; parser code executes them.

## Test strategy

### Generator tests

- deterministic output,
- unique mode and command IDs,
- valid source paths in diagnostics,
- valid surface declarations,
- examples normalised consistently,
- generated files up to date.

### Coverage tests

- every public mode is catalogued or explicitly exempt,
- every public registry command is catalogued or explicitly exempt,
- every direct CLI route has a command identity,
- every parser command family maps to catalogue entries,
- every wizard exposed publicly is reachable through generated metadata.

### Parser tests

- every CLI example parses,
- every TUI example parses,
- dual-surface recipes map to the same identity,
- modal context lines are valid,
- quoting and structured values survive rendering.

### Help tests

- CLI renderer uses only CLI recipes,
- TUI renderer uses only TUI recipes,
- all visible commands appear in generated mode help,
- hidden/internal commands do not appear,
- conceptual prose and anti-patterns render without syntax conversion.

### `which` tests

Use representative intents across all major modes. Assert stable command IDs first and rendered syntax second. Include:

- exact command terms,
- aliases,
- ambiguous cross-mode terms,
- no-match behaviour,
- commands available on only one surface.

Do not make ranking tests depend on irrelevant global ordering.

### `/how` tests

- worker receives both `which` and help evidence,
- CLI route returns CLI syntax,
- TUI route returns TUI syntax,
- empty `which` results still permit a help-based answer,
- no CLI flags leak into TUI answers,
- no slash/modal TUI lines leak into CLI recipes,
- no HISE connection is required,
- malformed CLI invocation never launches Ink.

Use a fake worker/model adapter for deterministic tests; do not require provider credentials.

## Documentation updates

Update during the same migration:

- `docs/CLI_GRAMMAR.md` for the `how` route, surface selection, and any command-shape changes,
- `src/cli/help.ts` and `src/engine/commands/help.ts` during transition, then reduce them to generated renderers and retained non-command prose,
- `docs/PI_EMBED_DESIGN.md` if `/how` becomes a permanent embedded-agent feature,
- project architecture documentation if the generated catalogue moves into the engine layer.

Do not document exact command, file, or test counts.

## Recommended commit sequence

Keep commits independently verifiable:

1. catalogue v3 types and generator,
2. parser-backed dual-surface validation,
3. migrate existing generated modes,
4. add remaining modes and root commands,
5. generated TUI help,
6. generated CLI help,
7. surface-aware `which`,
8. shared `runHow` service,
9. CLI `how` route and TUI integration,
10. remove obsolete help tables and migration compatibility.

Use terse lowercase commit messages without conventional-commit prefixes.

## Final acceptance checklist

- One authored catalogue covers every public command.
- Every command declares supported surfaces.
- CLI and TUI recipes are parser validated.
- `which` searches the full catalogue and returns requested-surface syntax.
- CLI and TUI help are generated from the catalogue.
- `/how` never translates syntax in the model.
- `hise-cli how ... --agent` returns stable structured CLI guidance.
- No duplicated public command tables remain in TypeScript mode/help files.
- `src/cli/command-surface.ts` is removed or generated.
- Temporary prompt aliases and routing hacks are removed.
- `docs/CLI_GRAMMAR.md` matches the shipped grammar.
- `npm run build`, `npm run typecheck`, and `npm run test` all pass.
