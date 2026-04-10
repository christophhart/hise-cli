# /dsp mode — Phase 6.5

Scriptnode graph editing mode: creating, connecting, and parameterizing nodes
within a DspNetwork. Uses the same `GET /tree` + `POST /apply` pattern as
builder and UI modes. Local validation from `data/scriptnodeList.json`.

Tracks [#6](https://github.com/christoph-hart/hise-cli/issues/6).

## Command set

```
show networks                                     # list available DspNetworks
init <name> [--embedded]                          # create/load a DspNetwork
show tree                                         # current network hierarchy
add <factory.node> [as "<id>"] [to <parent>]      # add node to container
remove <id>                                       # remove node
move <id> to <parent> [at <index>]                # move node to container
connect <source> to <target>.<param>              # connect modulation source
disconnect <source> from <target>.<param>         # disconnect modulation
set <node>.<param> [to] <value>                   # set parameter or property
set <node>.<param>.<rangeProp> [to] <value>       # set range property (min, max, etc.)
bypass <id>                                       # bypass node
enable <id>                                       # enable node
create_parameter <container>.<name> [min max]     # create dynamic parameter
clear                                             # clear all nodes
help                                              # command list
```

### Grammar notes

- Shares token types with builder (quoted strings, dot-paths, identifiers, numbers)
- Factory paths use `factory.node` dot notation (e.g., `core.oscillator`, `filters.svf`)
- `set` is unified for parameters and properties — HISE resolves which one
- Range properties use dot-chained syntax: `set Filter1.Frequency.middlePosition 1000`
- Canonical range IDs: `min`, `max`, `stepSize`, `middlePosition`, `defaultValue`
  (domain-native `MinValue`/`MaxValue`/`SkewFactor` also accepted via
  `RangeHelpers::getIdSetForJSON()` auto-detection)
- `connect ... to <target>.Bypass` routes to `Node.connectToBypass()` (synthetic parameter)
- Comma chaining with verb inheritance (same as builder)

## C++ endpoints (REST_API_ENHANCEMENT.md § DSP)

| Endpoint                | Method | CLI command          | Status |
|-------------------------|--------|----------------------|--------|
| `GET /api/dsp/list`     | GET    | `show networks`      | TODO   |
| `POST /api/dsp/init`    | POST   | `init <name>`        | TODO   |
| `GET /api/dsp/tree`     | GET    | tree sidebar / `show tree` | TODO |
| `POST /api/dsp/apply`   | POST   | all mutation commands | TODO   |

Undo/redo reuses the cross-domain `/api/undo/*` endpoints.

### Apply operations

| Op                | Builder syntax                              |
|-------------------|---------------------------------------------|
| `add`             | `add core.oscillator as "Osc1" to Main`     |
| `remove`          | `remove Osc1`                               |
| `move`            | `move Osc1 to SubChain at 0`                |
| `connect`         | `connect lfo1 to Filter1.Frequency`         |
| `disconnect`      | `disconnect lfo1 from Filter1.Frequency`    |
| `set`             | `set Osc1.Frequency 440`                    |
| `bypass`          | `bypass Osc1`                               |
| `create_parameter`| `create_parameter Main.Cutoff 20 20000`     |
| `clear`           | `clear`                                     |

### Key C++ ↔ REST mapping

| REST op            | HiseScript API call                              |
|--------------------|--------------------------------------------------|
| `add`              | `DspNetwork.createAndAdd(path, id, parent)`      |
| `remove`           | `DspNetwork.deleteIfUnused(id)`                  |
| `move`             | `Node.setParent(parentNode, indexInParent)`       |
| `connect`          | `Node.connectTo(parameterTarget, sourceInfo)`     |
| `connect` (Bypass) | `Node.connectToBypass(sourceInfo)`                |
| `disconnect`       | `Connection.disconnect()`                         |
| `set`              | `Node.set(id, value)` — unified param + property |
| `bypass`           | `Node.setBypassed(bool)`                          |
| `create_parameter` | `Node.getOrCreateParameter(id)` + range setup    |
| `clear`            | `DspNetwork.clear(true, true)`                    |
| `init`             | `DspNetwork::Holder::getOrCreate(name)`           |
| `list`             | scan `DspNetworks/*.xml`                          |

## Implementation (MODE_DEVELOPMENT.md order)

### 1. Contract — `src/mock/contracts/dsp.ts`

Raw types and normalizers for all response shapes:

- `RawDspNode` — `{id, path, bypassed, parameters[], connections[], children[]}`
- `RawDspParameter` — `{id, value}` (verbose adds `min, max, stepSize, middlePosition, defaultValue`)
- `RawDspConnection` — `{source, sourceOutput, parameter}`
- `normalizeDspList()` — `string[]`
- `normalizeDspTree()` — recursive `TreeNode` mapping (nodes, containers, connections)
- `normalizeDspApply()` — diff actions `[{type: +/-/*, id, path?, parent?, message?}]`
- `normalizeDspInit()` — same shape as tree (initial empty network)

### 2. Mock runtime — extend `src/mock/runtime.ts`

Mock handlers for all 4 endpoints:
- `GET /api/dsp/list` — returns hardcoded network names
- `POST /api/dsp/init` — creates empty network in mock state
- `GET /api/dsp/tree` — returns mock network hierarchy
- `POST /api/dsp/apply` — processes ops, updates mock tree, returns diff

Mock tree: small representative network (chain → oscillator + filter + LFO,
one connection, one dynamic parameter on root container).

### 3. Parser — `src/engine/modes/dsp-parser.ts`

Chevrotain grammar for DSP commands. Shares tokens with builder
(`QuotedString`, `DotPath`, `Identifier`, `NumberLiteral`, `Comma`).

New tokens: `From` (for disconnect syntax).

Command rules:
- `add <DotPath> [As QuotedString] [To Identifier]`
- `remove <Identifier>`
- `move <Identifier> To <Identifier> [At NumberLiteral]`
- `connect <Identifier> To <Identifier>.<Identifier>`
- `disconnect <Identifier> From <Identifier>.<Identifier>`
- `set <Identifier>.<DotPath> [To] <value>`
- `bypass <Identifier>` / `enable <Identifier>`
- `create_parameter <Identifier>.<Identifier> [NumberLiteral NumberLiteral]`
- `clear`
- `show tree` / `show networks`
- `init <Identifier> [--embedded]`

### 4. Engine mode — `src/engine/modes/dsp.ts`

`DspMode implements Mode`:
- `id: "dsp"`, `accent: MODE_ACCENTS.dsp`, `prompt: "[dsp] > "`
- `treeLabel: "Network"` — tree from `GET /api/dsp/tree`
- `contextLabel` shows current network name (set via `init` or mode entry arg)
- Navigation: `cd` into containers, `ls` lists children, `pwd` shows path
- Local validation: factory paths against `scriptnodeList.json`, parameter
  names against node definitions
- `complete()`: factory paths after `add`, node IDs after `remove`/`bypass`/`set`,
  parameter names after `set <node>.`, range properties after `set <node>.<param>.`

### 5. Registration wiring

- `src/session-bootstrap.ts` — add to `SUPPORTED_MODE_IDS`, register factory
- `src/engine/commands/slash.ts` — `handleModes()` table + register command
- `src/engine/commands/help.ts` — `MODE_HELP.dsp`
- `src/cli/help.ts` — `SCOPED_HELP.dsp`
- `src/engine/completion/engine.ts` — `completeDsp()` method
- `src/engine/highlight/dsp.ts` — tokenizer (factory paths, node IDs, keywords)

### 6. Tests — `src/engine/modes/dsp.test.ts`

- Parser: all command shapes, comma chaining, dot-path parameter access
- Command → ops translation (parser output → apply operations array)
- Local validation: valid/invalid factory paths, parameter names, range properties
- Contract validation of mock payloads
- Tree building from dsp/tree response
- Completion: factory paths, node IDs, parameters, range properties
- Range ID normalization (canonical ↔ domain-native)

### 7. Live parity — `src/live-contract/dsp.live.test.ts`

- Shape parity for each endpoint against contracts
- Round-trip: `init` → `add` nodes → `tree` matches expected shape
- `set` parity for parameters vs properties
- `connect` / `disconnect` round-trip
- `create_parameter` with range properties

## Definition of done

- [ ] All 4 C++ endpoints implemented and returning contract-valid responses
- [ ] Mock contract tests pass (`npm test`)
- [ ] Parser tests pass — all command shapes
- [ ] Engine mode tests pass (`npm test`)
- [ ] Live parity tests pass (`npm run test:live-contract`)
- [ ] `/dsp` works in `--mock` mode (all commands)
- [ ] `/dsp` works against live HISE
- [ ] Tree sidebar renders scriptnode network hierarchy
- [ ] Tab completion: factory paths, node IDs, parameters, range properties
- [ ] Syntax highlighting for DSP commands
- [ ] TUI and CLI both route through same engine path
- [ ] Help text updated (TUI `/help` + CLI `--help`)
