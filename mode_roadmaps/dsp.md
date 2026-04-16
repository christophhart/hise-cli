# /dsp mode — Phase 6.5

Scriptnode graph editing mode: creating, connecting, and parameterizing nodes
within a DspNetwork. Mirrors builder/ui with `GET /tree` + `POST /apply`.
Local validation from `data/scriptnodeList.json`.

Tracks [#6](https://github.com/christoph-hart/hise-cli/issues/6).

Source of truth for field names: `openapi.json` (the HISE REST API dump).

## Resolved design decisions

1. **Module-scoped context** — every DSP call carries a `moduleId` (the
   script processor hosting the DspNetwork). Mode state tracks one
   moduleId at a time; each host has at most one active network.
2. **No range edits via `set`** — the roadmap's
   `set <node>.<param>.<rangeProp>` syntax is dropped. Range metadata is
   configured only at `create_parameter` time.
3. **Optional `sourceOutput` in `connect`** — default form
   `connect lfo1 to Filter1.Frequency`; explicit form
   `connect env1.Value to Filter1.Cutoff`.
4. **`init` returns the initial tree** — client consumes the returned
   tree directly; no follow-up `GET /tree` needed immediately after.
5. **`add` defaults to CWD** — when `to <parent>` is omitted, the node
   is added to the currently `cd`'d container.
6. **`reset` = openapi `clear`** — CLI surfaces `reset` (matching
   `/builder reset`); the wire op stays `{op: "clear"}`.

## Command set

```
show networks | modules | tree | connections
use <moduleId>
init <name> [embedded]
save
reset
add <factory.node> [as <id>] [to <parent>]
remove <id>
move <id> to <parent> [at <index>]
connect <source>[.<output>] to <target>.<param>
disconnect <source> from <target>.<param>
set <node>.<param> [to] <value>
get <id>                       -> factoryPath
get <node>.<param>             -> current value
get source of <node>.<param>   -> connected source
get parent of <node>.<param>   -> parent container id
bypass <id> | enable <id>
create_parameter <container>.<name> [<min> <max>] [default <d>] [step <s>]
cd / ls / pwd
help
```

### Grammar notes

- Shares tokens with builder (`QuotedString`, `Identifier`, `NumberLiteral`,
  `Comma`, `Dot`, `To`, `As`).
- New tokens in `tokens.ts`: `From`, `Of`, `Use`, `Init`, `Save`, `Reset`,
  `Connect`, `Disconnect`, `Connections`, `Networks`, `Modules`,
  `Source`, `Parent`, `Default`, `Step`, `Embedded`, `CreateParameter`.
- Factory paths use `factory.node` dot notation (`core.oscillator`,
  `filters.svf`).
- Comma chaining with verb inheritance — only for verbs in
  `DSP_VERB_KEYWORDS` (add, remove, move, set, get, bypass, enable,
  connect, disconnect). Non-chainable commands (show/use/init/save/reset
  /create_parameter) always need their keyword explicit.
- `/dsp."Script FX1"` enters mode with that moduleId pre-selected
  (multi-word quoting + dot-notation context).

## C++ endpoints (authoritative — openapi.json)

| Endpoint | Method | Envelope |
|----------|--------|----------|
| `/api/dsp/list` | GET | `{networks: string[]}` (top-level, not `result`) |
| `/api/dsp/init?moduleId=X` | POST | `{result: <tree>, filePath, embedded}` |
| `/api/dsp/tree?moduleId=X&verbose?&group?` | GET | `{result: <tree>}` |
| `/api/dsp/apply` | POST | `{scope, groupName, diff}` (shared envelope) |
| `/api/dsp/save?moduleId=X` | POST | `{filePath}` |

Undo/redo reuses the cross-domain `/api/undo/*` system. The diff domain
on DSP operations is `"dsp"`.

### Apply op field names (openapi-authoritative)

| Op | Fields |
|----|--------|
| `add` | `factoryPath`, `parent`, optional `nodeId`, `index` |
| `remove` | `nodeId` |
| `move` | `nodeId`, `parent`, optional `index` |
| `connect` | `source`, `target`, `parameter`, optional `sourceOutput` (string or int) |
| `disconnect` | `source`, `target`, `parameter` |
| `set` | `nodeId`, `parameterId`, `value` |
| `bypass` | `nodeId`, `bypassed` |
| `create_parameter` | `nodeId`, `parameterId`, optional `min`, `max`, `defaultValue`, `stepSize`, `middlePosition`, `skewFactor` |
| `clear` | (empties the loaded network's nodes; CLI surface is `reset`) |

## Tree node shape

```
{ nodeId, factoryPath, bypassed,
  parameters: [{parameterId, value, min?, max?, stepSize?,
                middlePosition?, defaultValue?}],
  connections?: [{source, sourceOutput, target, parameter}],  // containers only
  children: [...] }
```

Connections live on the owning container — the `get source of ...`
resolver scans ancestors from innermost outward.

## Implementation status

- [x] `src/mock/contracts/dsp.ts` — raw types + normalizers
- [x] `src/mock/dspMock.ts` — mock network state + op application
- [x] `src/mock/runtime.ts` — DSP handlers wired into default mock profile
- [x] `src/engine/modes/dsp-parser.ts` — Chevrotain grammar + comma chaining
- [x] `src/engine/modes/dsp-ops.ts` — command → openapi op translation
- [x] `src/engine/modes/dsp-validate.ts` — factory/param/range checks
- [x] `src/engine/modes/dsp.ts` — DspMode class (parse/dispatch/fetch)
- [x] `src/engine/highlight/dsp.ts` — mode tokenizer
- [x] `src/engine/modes/dsp.test.ts` — parser + ops + validation + contract tests
- [x] `src/engine/modes/dsp.integration.test.ts` — end-to-end against mock
- [x] `src/live-contract/dsp.live.test.ts` — shape + round-trip against live HISE
- [x] `src/session-bootstrap.ts` — mode registration + scriptnodeList injection
- [x] `src/engine/commands/help.ts` — `MODE_HELP.dsp`
- [x] `src/cli/help.ts` — `SCOPED_HELP.dsp`
- [x] `npm run test:live-contract:dsp` script

## Testing

- `npm test` runs the full unit + contract suite (1078 tests).
- `npm run test:live-contract:dsp` runs the live parity suite against a
  running HISE on :1900. Requires a DspNetwork-capable script processor
  present.

## Rules of thumb

- Factory paths and parameter names are pre-validated locally against
  `scriptnodeList.json` before any API call. Server still has final say.
- Range metadata is configurable only at `create_parameter` time. Re-run
  `create_parameter` on an existing parameter ID to overwrite.
- Live HISE does not expose module-type metadata in `/api/status`, so
  `show modules` currently lists all script processors rather than
  filtering for DspNetwork-capable ones. This can be tightened once the
  server exposes the filter.
