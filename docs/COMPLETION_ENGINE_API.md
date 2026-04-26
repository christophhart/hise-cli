# completionEngine API Map

## 1. Type Definition and Signatures

**File**: `src/engine/completion/engine.ts`

**Class**: `CompletionEngine` (lines 252–472)

**Public methods**:
```typescript
async init(loader: DataLoader): Promise<void>
setSlashCommands(commands: CommandEntry[]): void
setDatasets(datasets: CompletionDatasets): void
completeSlash(input: string): CompletionResult
completeModuleType(prefix: string): CompletionItem[]
completeModuleParam(moduleId: string, prefix: string): CompletionItem[]
completeScript(input: string): CompletionResult
completeScriptnode(input: string): CompletionResult
completeInspect(prefix: string): CompletionItem[]
completeSequence(prefix: string): CompletionItem[]
completeBuilderKeyword(prefix: string): CompletionItem[]
completeBuilderShow(prefix: string): CompletionItem[]
completeUndo(prefix: string, inPlan: boolean): CompletionItem[]
```

**Stateful**: yes. Caches `datasets` + `slashItems` after first load. Per-call = O(1) fuzzy filter.

**Construction**: instantiated by `createEmbedSession()` / `createSession()` at `src/session-bootstrap.ts:38`. No public ctor args.

---

## 2. Per-Call API

**Entry point**: `Session.complete(input: string, cursor: number): CompletionResult`
**File**: `src/engine/session.ts:333`

- `input` = full line up to cursor
- `cursor` = byte offset, 0-based

**Mode detection**: `Session.complete()` does it. Two paths:
- input starts with `/` → parse slash command + optional mode args (e.g. `/script Engine.get` → script mode arg "Engine.get")
- otherwise → delegate to currently pushed mode's `complete()`

**No exported `detectModeAtOffset` helper exists.** For multi-line buffer with embedded `/<mode>` lines, scan backward yourself for the last `/<mode>` / `/exit` line. The `Session` only knows the *currently pushed* mode (stack state), not arbitrary offsets in a multi-line source. If you want mode-at-offset for a CodeMirror buffer, write it yourself.

---

## 3. Completion Item Shape

**File**: `src/engine/modes/mode.ts:27–31`

```typescript
interface CompletionItem {
  label: string;        // required, displayed + sort key
  detail?: string;      // optional, brief description / type hint
  insertText?: string;  // optional, may differ from label
}

interface CompletionResult {
  items: CompletionItem[];
  from: number;         // replacement range start (offset in input)
  to: number;           // replacement range end
  label?: string;       // popup header (e.g. "Slash commands", "Module types")
}
```

**No separate item kinds.** Caller infers category from `CompletionResult.label` (e.g. `"Builder keywords"` vs `"Module types"` vs `"Show arguments"`).

**`detail` is plain text**, not markdown. First-sentence extraction at dataset build time (`engine.ts:162–164, 173–174`).

---

## 4. Mode Coverage

| Mode | Completion | Contributor | Categories |
|------|-----------|-------------|------------|
| `builder` | yes | `src/engine/modes/builder.ts:255–336` | keywords (`add`/`set`/`get`/`show`/`cd`), module types, module params, live module IDs, "show" subcommands |
| `script` | yes | `src/engine/modes/script.ts:96–122` | API namespaces, methods (dotted `Namespace.method`), `/callback` targets for MIDI processors |
| `dsp` | yes | `src/engine/modes/dsp.ts:704–751` | DSP keywords, scriptnode factories + nodes, live node IDs, screenshot args (`at`/`to`) |
| `ui` | yes | `src/engine/modes/ui.ts:160–172` | UI keywords, component types, properties, instance IDs |
| `inspect` | yes | `src/engine/modes/inspect.ts:35–44` | `version`, `project`, `help` |
| `sequence` | yes | `src/engine/modes/sequence.ts:57–72` | commands (`create`/`flush`/`show`/`play`/`record`/`stop`/`get`), event verbs (`send`/`set`/`eval`), signals (`sine`/`saw`/`sweep`/`dirac`/`noise`/`silence`) |
| `undo` | yes | `src/engine/modes/undo.ts:85–94` | `back`/`forward`/`clear`/`diff`/`history`, conditional `plan`/`apply`/`discard` |
| `root` (default `hsc`) | no | — | Only slash commands at root level |

`project`, `compile`, `wizard`, `hise`, `analyse`: stub or none.

---

## 5. Datasets Dependency

| Dataset | Used by engine? | Methods | Loader |
|---------|-----------------|---------|--------|
| `moduleList.json` | yes | `completeModuleType`, `completeModuleParam` | `DataLoader.loadModuleList()` |
| `scriptnodeList.json` | yes | `completeScriptnode` | `DataLoader.loadScriptnodeList()` |
| `scripting_api.json` | yes | `completeScript` | `DataLoader.loadScriptingApi()` |
| `ui_component_properties.json` | **no** — handled inside `UiMode`, not engine | — | `getComponentProperties()` injected into `UiMode` ctor |

**Silent degradation**: yes. `init()` uses `Promise.all([...]).catch(() => null)` (`engine.ts:266–270`). Missing dataset → null → that category returns `[]`. No throw. (`engine.ts:303–306` example.)

---

## 6. Live-State vs Static

**Engine itself never touches HISE.** Pure fuzzy-filter over static datasets + caller-provided snapshots.

**Live data flows through Mode layer, not engine**:
- Builder: live module IDs collected from `treeRoot` (snapshot held by mode, refreshed on mode entry)
- DSP: live node IDs from `rawTree`
- Script: `/callback` targets — hardcoded `MIDI_PROCESSOR_CALLBACKS` (`script.ts:152–154`), not live

**Pure / offline-safe** (every engine method is pure):
- `completeSlash`, `completeModuleType`, `completeModuleParam`, `completeScript`, `completeScriptnode`, `completeInspect`, `completeSequence`, `completeBuilderKeyword`, `completeBuilderShow`, `completeUndo`

**For docs embed without HISE**: parameter completion (`completeModuleParam`), module type, scriptnode, scripting API, slash, inspect, sequence, builder keywords, undo — all work. Live module/node *instance IDs* will be empty (no HISE → no tree), but module *type* + *param* completion (the must-have) works fully offline.

---

## 7. Slash-Command Completion

**Same `Session.complete()` call.** Single dispatch handles both top-level `/cmd` and arguments.

**Top-level**: `completeSlash()` at `engine.ts:294–298`, fed by `setSlashCommands(registry.all())` via `buildSlashItems()` (`engine.ts:242–248`).

Item format:
```typescript
{ label: "/script", detail: "Enter script mode", insertText: "/script" }
```

**Argument completion** in `Session.complete()` (`session.ts:363–409`):
- `/run <path>` / `/edit <path>` → script file names from cache
- `/expect <command> is <expectation>` → delegates to current mode for the `<command>` part
- `/builder add ...`, `/script Synth.add` → mode args delegated to that mode's completion

---

## 8. Example Caller (Web SPA WebSocket Handler)

**File**: `src/web/ws-handler.ts:226–238`

```typescript
function handleComplete(
  ctx: ConnectionContext,
  msg: Extract<ClientMsg, { kind: "complete" }>,
): void {
  const result = ctx.host.session.complete(msg.line, msg.cursor);
  send(ctx, {
    kind: "completion",
    id: msg.id,
    payload: result
      ? { items: result.items, from: result.from, to: result.to, label: result.label }
      : null,
  });
}
```

**Wire protocol** (`src/web/protocol.ts:21`):
```typescript
// client → server
{ kind: "complete"; id: string; line: string; cursor: number }
// server → client
{ kind: "completion"; id: string; payload: { items, from, to, label? } | null }
```

**Flow**:
1. Keystroke → client sends `{ line: "/script Synth.a", cursor: 15 }`
2. `Session.complete()` parses leading `/script`, extracts `"Synth.a"` as mode arg
3. Delegates → `ScriptMode.complete()` → `engine.completeScript("Synth.a")`
4. Engine finds last `.` → namespace `"Synth"`, prefix `"a"` → fuzzy match methods
5. Returns `{ items, from: dotIndex+1, to: input.length, label: "Synth methods" }`
6. Script mode adjusts offsets relative to full input
7. Server sends payload back

---

## Embed Wiring (How completionEngine reaches caller)

**File**: `src/web-embed/index.ts:67–104`

```typescript
export interface EmbedSession {
  readonly session: Session;
  readonly completionEngine: CompletionEngine;
  close(): void;
}
```

**Caller can**:
- `session.complete(line, cursor)` — full dispatch (recommended; handles slash + mode + args)
- `completionEngine.completeScript(input)` directly — bypass mode layer if you already know mode

**Bootstrap**: `src/session-bootstrap.ts:30–59` registers all modes with shared `completionEngine` instance. After construction, caller must `await loadSessionDatasets(dataLoader, completionEngine, session)` to populate datasets.

---

## Notes

- `docs/EMBED_INTEGRATION.md` mentions `completionEngine` as a return field (line 85) but documents no methods. This map fills that gap.
- For CodeMirror: use `session.complete(line, cursor)` as the `CompletionSource` backend. Map `from`/`to` directly to CM's `from`/`to`. Use `result.label` for the section header. `detail` → CM `detail` field (plain text). No `kind` field exists; if you need icons, derive from `result.label`.
- Mode-at-offset for multi-line buffers: not provided. Scan backward for `/<mode>` / `/exit` markers yourself, then push that mode on `session` before calling `complete()`.
