# /project mode — Phase 6.9

Project lifecycle mode: loading, saving, switching, creating projects, and
managing project-scoped settings. Presets live in `/presets`, global settings
in `/settings`, validation in respective modes (`/ui`, `/sampler`).

Tracks [#9](https://github.com/christoph-hart/hise-cli/issues/9).

## Command set

```
info                                              # project name, folder, type, status
show projects                                     # list available projects (name + path)
show settings                                     # all project-scoped settings as table
show preprocessors                                # preprocessors x platforms markdown table
show files                                        # XmlPresetBackup + HIP files
switch <name-or-path>                             # switch active project (name or abs path)
save xml [as <filename>]                          # save as XML (git-friendly)
save hip [as <filename>]                          # save as HIP (renames master chain)
load <file>                                       # load XML or HIP file
create                                            # alias -> /wizard new_project
set <key> <value>                                 # set project setting (lenient bool norm)
set preprocessor <name> <value> [on <platform>]   # per-platform preprocessor definition
snippet export                                    # export as HISE snippet
snippet load <snippet>                            # import HISE snippet
help                                              # command list
```

## C++ endpoints (REST_API_ENHANCEMENT.md § Project)

| Endpoint                        | Method | CLI command          | Status |
|---------------------------------|--------|----------------------|--------|
| `GET /api/project/list`         | GET    | `show projects`      | TODO   |
| `GET /api/project/tree`         | GET    | tree sidebar         | TODO   |
| `GET /api/project/files`        | GET    | `show files`         | TODO   |
| `GET /api/project/settings/list`| GET    | `show settings`      | TODO   |
| `POST /api/project/settings/set`| POST   | `set <key> <value>`  | TODO   |
| `POST /api/project/save`        | POST   | `save xml`/`save hip`| TODO   |
| `POST /api/project/load`        | POST   | `load <file>`        | TODO   |
| `POST /api/project/switch`      | POST   | `switch <project>`   | TODO   |
| `GET /api/project/export_snippet` | GET  | `snippet export`     | TODO   |
| `POST /api/project/import_snippet`| POST | `snippet load`       | TODO   |

Full request/response contracts in REST_API_ENHANCEMENT.md § Project.

## Implementation (MODE_DEVELOPMENT.md order)

### 1. Contract — `src/mock/contracts/project.ts`

Normalizers for all response shapes:
- `normalizeProjectList()` — `{projects: [{name, path}], active}`
- `normalizeProjectTree()` — recursive tree with `referenced` flags
- `normalizeProjectFiles()` — `{files: [{name, type, path, modified}]}`
- `normalizeProjectSettings()` — `{settings: Record<string, string>}`
- `normalizeProjectSnippet()` — `{snippet: string}`

### 2. Mock runtime — extend `src/mock/runtime.ts`

Mock handlers for all 10 endpoints. `settings/set` mutates mock state.
`save hip` with filename updates mock project name (master chain rename).
Reuse existing `GET /api/status` for `info` command.

### 3. Engine mode — `src/engine/modes/project.ts`

`ProjectMode implements Mode` with simple command dispatch (like InspectMode).
- `id: "project"`, `accent: MODE_ACCENTS.project`, `prompt: "[project] > "`
- `treeLabel: "Project Files"` — tree from `GET /api/project/tree`
- `set` command: client-side bool normalization
  (`true/yes/on/1` -> `"1"`, `false/no/off/0` -> `"0"`)
- `set preprocessor`: parses `ExtraDefinitions{platform}` fields, merges
  KEY=VALUE pairs
- `show preprocessors`: parses all 4 platform ExtraDefinitions into
  cross-platform table

### 4. Registration wiring

- `src/session-bootstrap.ts` — add to `SUPPORTED_MODE_IDS`, register factory
- `src/engine/commands/slash.ts` — `handleModes()` table + register command
- `src/engine/commands/help.ts` — `MODE_HELP.project`
- `src/cli/help.ts` — `SCOPED_HELP.project`
- `src/engine/completion/engine.ts` — `completeProject()` method
- `src/engine/highlight/project.ts` — tokenizer

### 5. Tests — `src/engine/modes/project.test.ts`

- Command dispatch for all commands
- Settings parsing: `set Version 1.0.0`, `set VST3Support yes`
- Preprocessor parsing: `set preprocessor X Y`, `set preprocessor X Y on Windows`
- Bool normalization edge cases
- Contract validation of mock payloads
- Completion items
- Tree building from project/tree response

### 6. Live parity — `src/live-contract/project.live.test.ts`

- Shape parity for each endpoint against contracts
- Formatter parity for show commands

## Definition of done

- [ ] All 10 C++ endpoints implemented and returning contract-valid responses
- [ ] Mock contract tests pass (`npm test`)
- [ ] Engine mode tests pass (`npm test`)
- [ ] Live parity tests pass (`npm run test:live-contract`)
- [ ] `/project` works in `--mock` mode (all commands)
- [ ] `/project` works against live HISE
- [ ] Tree sidebar renders project file tree with dimmed unreferenced files
- [ ] TUI and CLI both route through same engine path
- [ ] Help text updated (TUI `/help` + CLI `--help`)
