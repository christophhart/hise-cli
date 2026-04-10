# HISE REST API Enhancement — hise-cli Endpoints

> New REST API endpoints required to support the hise-cli modal REPL.
> These extend the existing REST API at `http://localhost:1900`.
>
> **Design principles** (from the existing API):
> - `GET` for reads, `POST` for mutations
> - Query parameters for GET, JSON body for POST
> - All responses: `{success, result, logs, errors}`
> - Errors include `errorMessage` + `callstack` where applicable
> - Endpoints self-register with `GET /` for discovery
> - Categories match mode names: `sampler`, `dsp`, etc.

---

## Settings

### GET /api/settings/get

Get HISE settings values.

**Query Parameters**:

| Parameter | Required | Description                                     |
|-----------|----------|-------------------------------------------------|
| `key`     | No       | Specific setting key. If omitted, returns all.  |

**Response**:
```json
{
  "success": true,
  "result": {
    "settings": {
      "HISE_PATH": "D:/Development/HISE",
      "USE_IPP": true,
      "CUSTOM_NODE_PATH": ""
    }
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/settings/set

Set a HISE settings value.

**JSON Body**:

| Field   | Required | Description                  |
|---------|----------|------------------------------|
| `key`   | Yes      | Setting key                  |
| `value` | Yes      | New value                    |

**Request**:
```json
{
  "key": "HISE_PATH",
  "value": "D:/Development/HISE"
}
```

---

## Sampler

Wraps the Sampler scripting API for sample map management, selection-based
editing, and complex group management.

### GET /api/sampler/maps

List available sample maps.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

**Response**:
```json
{
  "success": true,
  "result": {
    "maps": ["MySamples", "PadSamples", "DrumKit"],
    "currentMap": "MySamples"
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/load_map

Load a sample map.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `name`     | Yes      | Sample map name              |

---

### POST /api/sampler/save_map

Save the current sample map.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                    |
| `name`     | No       | Name to save as (default: current name)  |

---

### POST /api/sampler/clear_map

Clear the current sample map.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

---

### GET /api/sampler/info

Get current sample map statistics.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

**Response**:
```json
{
  "success": true,
  "result": {
    "currentMap": "MySamples",
    "numSamples": 48,
    "numRRGroups": 3,
    "keyRange": {"low": 36, "high": 96},
    "numMicPositions": 2
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/validate_maps

Validate sample maps for issues.

**JSON Body**:

| Field      | Required | Description |
|------------|----------|-------------|
| `moduleId` | No       | Validate one sampler map context (omit for all) |

---

### POST /api/sampler/import

Import audio files into the current sample map.

**JSON Body**:

| Field            | Required | Description                       |
|------------------|----------|-----------------------------------|
| `moduleId`       | Yes      | The sampler module ID             |
| `files`          | Yes      | Array of file paths               |
| `skipExisting`   | No       | Skip files already in map (default: `false`) |

---

### POST /api/sampler/import_sfz

Import an SFZ file.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `path`     | Yes      | Path to SFZ file             |

---

### POST /api/sampler/select

Select samples by regex. Selection syncs to the HISE sample map editor UI.

**JSON Body**:

| Field      | Required | Description                                    |
|------------|----------|------------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                          |
| `regex`    | No       | Regex to match filenames (omit for select all) |
| `mode`     | No       | `"SELECT"` (default), `"ADD"`, `"SUBTRACT"`    |

**Response**:
```json
{
  "success": true,
  "result": {"count": 16},
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/select_where

Select samples by property filter.

**JSON Body**:

| Field      | Required | Description                                                  |
|------------|----------|--------------------------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                                        |
| `filters`  | Yes      | Array of `{property, operator, value}` objects               |

**Request**:
```json
{
  "moduleId": "Sampler1",
  "filters": [
    {"property": "RRGroup", "operator": "=", "value": 1},
    {"property": "LoVel", "operator": ">", "value": 64}
  ]
}
```

Operators: `=`, `!=`, `>`, `<`, `>=`, `<=`

**Response**:
```json
{
  "success": true,
  "result": {"count": 8},
  "logs": [],
  "errors": []
}
```

---

### GET /api/sampler/get_selection

Get details of currently selected samples.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

**Response**:
```json
{
  "success": true,
  "result": {
    "count": 3,
    "samples": [
      {"FileName": "Piano_C4_pp.wav", "Root": 60, "LoKey": 58, "HiKey": 62, "LoVel": 0, "HiVel": 42, "RRGroup": 1, "Volume": 0},
      {"FileName": "Piano_C4_mf.wav", "Root": 60, "LoKey": 58, "HiKey": 62, "LoVel": 43, "HiVel": 95, "RRGroup": 1, "Volume": 0},
      {"FileName": "Piano_C4_ff.wav", "Root": 60, "LoKey": 58, "HiKey": 62, "LoVel": 96, "HiVel": 127, "RRGroup": 1, "Volume": 0}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/set_property

Set a sample property for the selection or all samples.

**JSON Body**:

| Field      | Required | Description                                   |
|------------|----------|-----------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                         |
| `property` | Yes      | Property name (e.g., `"HiVel"`, `"Volume"`)  |
| `value`    | Yes      | New value                                     |
| `scope`    | No       | `"selection"` (default) or `"all"`            |

**Response**:
```json
{
  "success": true,
  "result": {"affected": 16},
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/duplicate

Duplicate selected samples.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

---

### POST /api/sampler/delete

Delete selected samples.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

---

### POST /api/sampler/monolith

Convert a sample map to HLAC monolith format.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                    |
| `map`      | No       | Sample map name (default: current map)   |

This is a long-running operation — response may include progress.

---

### GET /api/sampler/mics

List mic positions and their purge state.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

**Response**:
```json
{
  "success": true,
  "result": {
    "positions": [
      {"name": "Close", "purged": false},
      {"name": "Room", "purged": true}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/purge_mic

Purge or unpurge a mic position.

**JSON Body**:

| Field      | Required | Description                     |
|------------|----------|---------------------------------|
| `moduleId` | Yes      | The sampler module ID           |
| `mic`      | Yes      | Mic position name               |
| `purge`    | Yes      | `true` to purge, `false` to unpurge |

---

## Sampler: Complex Groups

### GET /api/sampler/groups/list

List all complex group layers.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |

**Response**:
```json
{
  "success": true,
  "result": {
    "layers": [
      {"name": "Articulation", "type": "keyswitch", "bits": 2, "numGroups": 3, "cached": true, "ignore": false},
      {"name": "RR", "type": "rr", "bits": 4, "numGroups": 9, "cached": false, "ignore": true},
      {"name": "Legato", "type": "legato", "bits": 7, "numGroups": 128, "cached": false, "ignore": true}
    ],
    "totalBitsUsed": 13,
    "maxBits": 64
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/groups/add

Add a new complex group layer.

**JSON Body**:

| Field      | Required | Description                                              |
|------------|----------|----------------------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                                    |
| `type`     | Yes      | Layer type: `"rr"`, `"xfade"`, `"keyswitch"`, `"legato"`, `"custom"` |
| `name`     | Yes      | Layer name                                               |
| `bits`     | No       | Number of bits (auto-calculated from type if omitted)    |
| `cached`   | No       | Enable pre-caching (default depends on type)             |
| `ignore`   | No       | Enable ignore bit (default depends on type)              |

**Response**:
```json
{
  "success": true,
  "result": {"layerIndex": 2},
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/groups/remove

Remove a complex group layer.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `name`     | Yes      | Layer name to remove         |

---

### POST /api/sampler/groups/assign

Assign a group value to currently selected samples.

**JSON Body**:

| Field      | Required | Description                                          |
|------------|----------|------------------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                                |
| `layer`    | Yes      | Layer name or index                                  |
| `group`    | Yes      | Group value (int or string name), or `"ignore"` to set the ignore flag |

**Response**:
```json
{
  "success": true,
  "result": {"affected": 24},
  "logs": [],
  "errors": []
}
```

---

### POST /api/sampler/groups/filter

Set the active group for a layer (controls which samples play).

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `moduleId` | Yes      | The sampler module ID                    |
| `layer`    | Yes      | Layer name or index                      |
| `group`    | Yes      | Group value to activate                  |

---

### POST /api/sampler/groups/set_property

Set a property on a layer.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `layer`    | Yes      | Layer name or index          |
| `property` | Yes      | Property name                |
| `value`    | Yes      | New value                    |

---

### POST /api/sampler/groups/volume

Set the volume for a specific layer/group combination.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `layer`    | Yes      | Layer name or index          |
| `group`    | Yes      | Group index                  |
| `gainDb`   | Yes      | Volume in decibels           |

---

### POST /api/sampler/groups/delay

Add a start offset to events matching a layer/group.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `layer`    | Yes      | Layer name or index          |
| `group`    | Yes      | Group index                  |
| `samples`  | Yes      | Delay in samples             |

---

### POST /api/sampler/groups/fade_in

Add a fade-in to events matching a layer/group.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `layer`    | Yes      | Layer name or index          |
| `group`    | Yes      | Group index                  |
| `timeMs`   | Yes      | Fade-in time in milliseconds |
| `targetDb` | No       | Target gain in dB            |

---

### POST /api/sampler/groups/fade_out

Fade out all voices matching a layer/group.

**JSON Body**:

| Field      | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | Yes      | The sampler module ID        |
| `layer`    | Yes      | Layer name or index          |
| `group`    | Yes      | Group index                  |
| `timeMs`   | Yes      | Fade-out time in milliseconds |

---

## DSP (Scriptnode)

Wraps the DspNetwork and Node scripting APIs for scriptnode graph editing.
Follows the same `GET /tree` + `POST /apply` pattern as builder and UI modes.
All mutations go through `POST /api/dsp/apply` as a batched operations array
(single undo transaction via the cross-domain `/api/undo/*` system).

### GET /api/dsp/list

Returns available DspNetwork names. Scans the project's `DspNetworks/` folder
for `.xml` files.

**Response**:
```json
{
  "success": true,
  "result": ["MyDSP", "MyEffect", "Reverb"],
  "logs": [],
  "errors": []
}
```

The result is a flat string array of network names (without `.xml` extension).
These names can be passed to `POST /api/dsp/init` or used as the `network`
parameter in `GET /api/dsp/tree` and `POST /api/dsp/apply`.

---

### POST /api/dsp/init

Creates or loads a DspNetwork. Maps to `DspNetwork::Holder::getOrCreate()` on
the C++ side. If the network XML file does not exist, it is created. If it
already exists, it is loaded.

**JSON Body**:

| Field      | Required | Description                                              |
|------------|----------|----------------------------------------------------------|
| `name`     | Yes      | Network name (sanitized to valid C++ identifier)         |
| `embedded` | No       | Create as embedded network (default: `false`)            |

**Response** — returns the initial tree (same shape as `GET /api/dsp/tree`):
```json
{
  "success": true,
  "result": {
    "id": "MyDSP",
    "path": "container.chain",
    "bypassed": false,
    "parameters": [],
    "connections": [],
    "children": []
  },
  "logs": [],
  "errors": []
}
```

**Notes**:
- The `name` is sanitized to a valid C++ identifier (same as
  `snex::cppgen::StringHelpers::makeValidCppName()`).
- For file-based networks, the XML is created at
  `DspNetworks/<name>.xml` if it doesn't exist.
- For embedded networks, the ID is derived from the parent processor name.
- The builder `set_effect` / `load ... into` command can later alias to
  this endpoint.

---

### GET /api/dsp/tree

Returns the scriptnode network hierarchy for a given network.

**Query Parameters**:

| Parameter | Required | Description                                        |
|-----------|----------|----------------------------------------------------|
| `network` | Yes      | DspNetwork ID (e.g., `"MyDSP"`)                   |
| `verbose` | No       | Include full parameter ranges/metadata (default: `false`) |

**Response**:
```json
{
  "success": true,
  "result": {
    "id": "MyDSP",
    "path": "container.chain",
    "bypassed": false,
    "parameters": [
      {"id": "Value", "value": 1.0}
    ],
    "children": [
      {
        "id": "Osc1",
        "path": "core.oscillator",
        "bypassed": false,
        "parameters": [
          {"id": "Frequency", "value": 440},
          {"id": "Mode", "value": 0}
        ],
        "connections": [],
        "children": []
      },
      {
        "id": "Filter1",
        "path": "filters.svf",
        "bypassed": false,
        "parameters": [
          {"id": "Frequency", "value": 2000},
          {"id": "Q", "value": 0.5}
        ],
        "connections": [
          {"source": "lfo1", "sourceOutput": "Value", "parameter": "Frequency"}
        ],
        "children": []
      }
    ]
  },
  "logs": [],
  "errors": []
}
```

Each node in the tree:

| Field         | Type      | Description                                               |
|---------------|-----------|-----------------------------------------------------------|
| `id`          | `string`  | Node instance ID (unique within network)                  |
| `path`        | `string`  | Factory path (e.g., `"core.oscillator"`, `"filters.svf"`) |
| `bypassed`    | `boolean` | Whether the node is bypassed                              |
| `parameters`  | `array`   | Parameter array (see below)                               |
| `connections` | `array`   | Incoming modulation connections (see below)                |
| `children`    | `array`   | Child nodes (empty array for leaf nodes)                  |

Each parameter object:

| Field          | Type     | Description                                             |
|----------------|----------|---------------------------------------------------------|
| `id`           | `string` | Parameter ID (e.g., `"Frequency"`)                      |
| `value`        | `number` | Current value                                           |

With `?verbose=true`, each parameter additionally includes range metadata
using the canonical REST ID set:

| Field            | Type     | Description                                           |
|------------------|----------|-------------------------------------------------------|
| `min`            | `number` | Minimum value                                         |
| `max`            | `number` | Maximum value                                         |
| `stepSize`       | `number` | Step size (0 = continuous)                             |
| `middlePosition` | `number` | Value at 50% of the range (omitted if linear / skew = 1.0) |
| `defaultValue`   | `number` | Default value                                         |

Each connection object (per-node, representing incoming modulation):

| Field          | Type     | Description                                             |
|----------------|----------|---------------------------------------------------------|
| `source`       | `string` | Source node ID                                          |
| `sourceOutput` | `string` | Source output name (e.g., `"Value"`)                    |
| `parameter`    | `string` | Target parameter name on this node                      |

**Error cases**:
- 404: `network` is not a valid DspNetwork ID

---

### POST /api/dsp/apply

Apply a batch of scriptnode operations. Returns a diff of what changed,
scoped to a single undo transaction (same envelope as `POST /api/builder/apply`
and `POST /api/ui/apply`).

**JSON Body**:

| Field        | Required | Description                                     |
|--------------|----------|-------------------------------------------------|
| `network`    | Yes      | DspNetwork ID                                   |
| `operations` | Yes      | Array of operation objects (see below)           |

**Operation types**:

Each operation object requires an `op` field.

#### `add` — Add a node

| Field    | Required | Description                                       |
|----------|----------|---------------------------------------------------|
| `op`     | —        | `"add"`                                           |
| `path`   | Yes      | Factory path (e.g., `"core.oscillator"`)          |
| `parent` | Yes      | Parent container node ID                          |
| `id`     | No       | Custom node ID (auto-generated if omitted)        |
| `index`  | No       | Position within parent (appended if omitted)      |

#### `remove` — Remove a node

| Field | Required | Description  |
|-------|----------|--------------|
| `op`  | —        | `"remove"`   |
| `id`  | Yes      | Node ID      |

#### `move` — Move a node to a different container

| Field    | Required | Description                       |
|----------|----------|-----------------------------------|
| `op`     | —        | `"move"`                          |
| `id`     | Yes      | Node ID to move                   |
| `parent` | Yes      | Target container node ID          |
| `index`  | No       | Position within target container  |

#### `connect` — Connect a modulation source to a parameter

| Field          | Required | Description                                   |
|----------------|----------|-----------------------------------------------|
| `op`           | —        | `"connect"`                                   |
| `source`       | Yes      | Source node ID                                |
| `target`       | Yes      | Target node ID                                |
| `parameter`    | Yes      | Target parameter name                         |
| `sourceOutput` | No       | Source output name (default: first output)    |

The synthetic parameter name `"Bypass"` connects to the node's bypass button
(maps to `Node.connectToBypass()` on the C++ side). Example:
`{"op": "connect", "source": "lfo1", "target": "Filter1", "parameter": "Bypass"}`

#### `disconnect` — Disconnect a modulation source

| Field       | Required | Description              |
|-------------|----------|--------------------------|
| `op`        | —        | `"disconnect"`           |
| `source`    | Yes      | Source node ID           |
| `target`    | Yes      | Target node ID           |
| `parameter` | Yes      | Target parameter name    |

#### `set` — Set a parameter value or node property

Works for both parameters and properties — HISE resolves which one. No
collision between parameter IDs and property names.

| Field   | Required | Description                               |
|---------|----------|-------------------------------------------|
| `op`    | —        | `"set"`                                   |
| `node`  | Yes      | Node ID                                   |
| `id`    | Yes      | Parameter or property name                |
| `value` | Yes      | New value                                 |

#### `bypass` — Set bypass state

| Field      | Required | Description           |
|------------|----------|-----------------------|
| `op`       | —        | `"bypass"`            |
| `node`     | Yes      | Node ID               |
| `bypassed` | Yes      | `true` or `false`     |

#### `create_parameter` — Create a dynamic parameter on a container

Used for containers that support user-defined parameters (e.g., `container.chain`).
Maps to `Node.getOrCreateParameter()` on the C++ side.

| Field  | Required | Description                                          |
|--------|----------|------------------------------------------------------|
| `op`   | —        | `"create_parameter"`                                 |
| `node` | Yes      | Container node ID                                    |
| `id`   | Yes      | Parameter name                                       |
| `min`  | No       | Minimum value (default: `0.0`)                       |
| `max`  | No       | Maximum value (default: `1.0`)                       |
| `defaultValue` | No | Default value (default: `0.0`)                    |
| `stepSize`     | No | Step size, 0 = continuous (default: `0.0`)         |
| `middlePosition` | No | Value at 50% of the range — computes skew so this value sits at 50%. Mutually exclusive with `skewFactor` |
| `skewFactor`   | No | Raw skew factor (default: `1.0`). Mutually exclusive with `middlePosition` |

**Range property naming**: The canonical REST spelling uses the `ScriptComponents`
ID set: `min`, `max`, `stepSize`, `middlePosition`, `defaultValue`. Domain-native
IDs are also accepted — the C++ layer auto-detects the ID set via
`RangeHelpers::getIdSetForJSON()`:

| Canonical (REST) | scriptnode | MidiAutomation |
|------------------|------------|----------------|
| `min`            | `MinValue` | `Start`        |
| `max`            | `MaxValue` | `End`          |
| `stepSize`       | `StepSize` | `Interval`     |
| `middlePosition` | `SkewFactor` | `Skew`       |

When `middlePosition` is provided, HISE computes the `SkewFactor` internally.
When `SkewFactor` or `Skew` is provided directly, it is used as-is. Do not
mix ID sets in a single operation — the auto-detector picks the first match.

#### `clear` — Clear all nodes from the network

| Field | Required | Description |
|-------|----------|-------------|
| `op`  | —        | `"clear"`   |

**Response** — diff summary:
```json
{
  "success": true,
  "result": {
    "actions": [
      {"type": "+", "id": "Osc1", "path": "core.oscillator", "parent": "Main"},
      {"type": "+", "id": "Filter1", "path": "filters.svf", "parent": "Main"},
      {"type": "*", "id": "Filter1", "message": "set parameter Frequency to 2000"},
      {"type": "*", "id": "lfo1", "message": "connect lfo1.Value -> Filter1.Frequency"},
      {"type": "-", "id": "OldNode"}
    ]
  },
  "logs": [],
  "errors": []
}
```

Each diff action:

| Field     | Type     | Description                                              |
|-----------|----------|----------------------------------------------------------|
| `type`    | `string` | `"+"` (add), `"-"` (remove), `"*"` (modify)             |
| `id`      | `string` | Affected node ID                                         |
| `path`    | `string` | Factory path (on `+` actions)                            |
| `parent`  | `string` | Parent node ID (on `+` actions)                          |
| `message` | `string` | Human-readable description (on `*` actions)              |

The `message` field on `*` actions distinguishes parameter vs property changes
(e.g., `"set parameter Frequency to 2000"` vs `"set property FilterMode to Ramp"`)
and describes connection changes (e.g., `"connect lfo1.Value -> Filter1.Frequency"`).

**Error cases**:
- 404: `network` is not a valid DspNetwork ID
- 400: invalid operation (unknown node ID, invalid factory path, etc.)
- Partial failure: if one operation in the batch fails, the entire batch is
  rolled back (undo transaction) and the error is returned

---

## Workspace

### GET /api/workspace/list

List all modules with their types and associated HISE workspace.

**Response**:
```json
{
  "success": true,
  "result": {
    "modules": [
      {"name": "Interface", "type": "ScriptProcessor", "workspace": "scripting"},
      {"name": "Sampler1", "type": "StreamingSampler", "workspace": "sampler"},
      {"name": "MyDSP", "type": "HardcodedSynth", "workspace": "scriptnode"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/workspace/switch

Switch HISE IDE to the workspace for a given module.

**JSON Body**:

| Field    | Required | Description    |
|----------|----------|----------------|
| `module` | Yes      | Module name    |

**Response**:
```json
{
  "success": true,
  "result": {
    "module": "Sampler1",
    "moduleType": "StreamingSampler",
    "workspace": "sampler"
  },
  "logs": [],
  "errors": []
}
```

---

## Inspect

### GET /api/inspect/cpu

Get CPU and performance metrics.

**Response**:
```json
{
  "success": true,
  "result": {
    "cpuUsage": 12.3,
    "activeVoices": 8,
    "maxVoices": 256,
    "sampleRate": 44100,
    "bufferSize": 512
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/inspect/voices

Get active voice details.

**Response**:
```json
{
  "success": true,
  "result": {
    "voices": [
      {"note": 60, "velocity": 100, "module": "Sampler1", "ageMs": 120},
      {"note": 64, "velocity": 80, "module": "Sampler1", "ageMs": 120}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/inspect/modules

Get the module tree with runtime state (CPU, bypass, voice count).

**Response**: Same structure as `GET /api/builder/tree` but with additional
runtime fields: `cpuUsage`, `activeVoices`.

---

### GET /api/inspect/module

Get detailed information about a specific module.

**Query Parameters**:

| Parameter | Required | Description    |
|-----------|----------|----------------|
| `name`    | Yes      | Module name    |

**Response**:
```json
{
  "success": true,
  "result": {
    "name": "Sampler1",
    "type": "StreamingSampler",
    "bypassed": false,
    "cpuUsage": 8.1,
    "activeVoices": 3,
    "parameters": {
      "Volume": -6.0,
      "Balance": 0.0,
      "PreloadSize": 8192
    },
    "chains": {
      "gain": [{"name": "GainAHDSR", "type": "AHDSR"}],
      "fx": [{"name": "SimpleGain1", "type": "SimpleGain", "bypassed": true}],
      "pitch": [],
      "midi": []
    }
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/inspect/connections

Get all modulation connections.

**Response**:
```json
{
  "success": true,
  "result": {
    "connections": [
      {"source": "GainAHDSR", "target": "Sampler1", "chain": "gain", "intensity": 1.0},
      {"source": "LFO1", "target": "Sampler1", "chain": "pitch", "intensity": 0.5}
    ]
  },
  "logs": [],
  "errors": []
}
```

### GET /api/inspect/watch_variables

Get live variable state from a script processor's debug information.
Replicates the data shown by the HISE IDE's ScriptWatchTable.

The underlying C++ data source is `HiseSpecialData::getDebugInformation()`
which provides the `DebugInformationBase` entries used by the IDE's watch
table (see `ScriptWatchTable.cpp:194-227` for the equivalent desktop code).

**Query Parameters**:

| Parameter  | Required | Description                                        |
|------------|----------|----------------------------------------------------|
| `moduleId` | Yes      | Script processor ID (e.g., `"Interface"`)          |
| `filter`   | No       | Glob pattern for variable names (e.g., `"my*"`)    |
| `types`    | No       | Comma-separated type filter: `register`, `variable`, `constant`, `inlineFunction`, `globals`, `callback`, `apiClass`, `namespace` |
| `depth`    | No       | Max nesting depth for children (default: `1`). `0` = no children. |

**Response**:
```json
{
  "success": true,
  "result": {
    "moduleId": "Interface",
    "variables": [
      {
        "type": "register",
        "dataType": "int",
        "name": "reg myCounter",
        "value": "42",
        "children": []
      },
      {
        "type": "variable",
        "dataType": "Array",
        "name": "myArray",
        "value": "[1, 2, 3]",
        "children": [
          { "type": "variable", "dataType": "int", "name": "myArray[0]", "value": "1", "children": [] },
          { "type": "variable", "dataType": "int", "name": "myArray[1]", "value": "2", "children": [] },
          { "type": "variable", "dataType": "int", "name": "myArray[2]", "value": "3", "children": [] }
        ]
      },
      {
        "type": "constant",
        "dataType": "ScriptSlider",
        "name": "Knob1",
        "value": "ScriptSlider [0.5]",
        "children": []
      },
      {
        "type": "namespace",
        "dataType": "Namespace",
        "name": "Config",
        "value": "",
        "children": [
          { "type": "constant", "dataType": "double", "name": "Config.sampleRate", "value": "44100.0", "children": [] }
        ]
      }
    ]
  },
  "logs": [],
  "errors": []
}
```

**Implementation notes**:

The handler iterates `getNumDebugObjects()` / `getDebugInformation(i)` on
the processor's `HiseJavascriptEngine`, calling `getTextForName()`,
`getTextForDataType()`, `getTextForValue()`, `getType()`, and recursively
`getNumChildElements()` / `getChildElement(i)` up to the requested depth.

The `type` field maps from the `DebugInformation::Type` enum:
`RegisterVariable`→`"register"`, `Variables`→`"variable"`,
`Constant`→`"constant"`, `InlineFunction`→`"inlineFunction"`,
`Globals`→`"globals"`, `Callback`→`"callback"`, `ApiClass`→`"apiClass"`,
`ExternalFunction`→`"externalFunction"`, `Namespace`→`"namespace"`.

The `filter` and `types` parameters are applied server-side to reduce
payload size. Variable names are matched case-insensitively against the
glob pattern. If both `filter` and `types` are omitted, all watchable
variables are returned.

Performance: the HISE IDE polls this data at 500ms intervals. The REST
endpoint should be comparably lightweight. The debug information list
itself only changes on recompilation — between recompilations, only
`getTextForValue()` is re-evaluated (via the `ValueFunction` lambdas that
capture weak references to the data source).

---

## Compile

### POST /api/compile/plugin

Export as a plugin target.

**JSON Body**:

| Field    | Required | Description                                       |
|----------|----------|---------------------------------------------------|
| `type`   | Yes      | `"instrument"`, `"effect"`, `"midifx"`            |
| `config` | No       | `"debug"` or `"release"` (default: `"debug"`)     |

This is a long-running operation. The response arrives when compilation
completes or fails. Progress can be monitored via SSE (`GET /api/events`).

---

### POST /api/compile/standalone

Export as standalone application.

**JSON Body**:

| Field    | Required | Description                                       |
|----------|----------|---------------------------------------------------|
| `config` | No       | `"debug"` or `"release"` (default: `"debug"`)     |

---

### POST /api/compile/dsp_dll

Compile DSP networks as a DLL.

**JSON Body**:

| Field    | Required | Description                                       |
|----------|----------|---------------------------------------------------|
| `config` | No       | `"debug"` or `"release"` (default: `"debug"`)     |

---

### POST /api/compile/clean

Clean the build directory.

**JSON Body**: `{}` (empty)

---

### GET /api/compile/status

Get current compilation status.

**Response**:
```json
{
  "success": true,
  "result": {
    "running": false,
    "lastBuild": {
      "target": "vst3",
      "config": "release",
      "success": true,
      "timestamp": "2026-03-14T10:30:00Z"
    }
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/compile/cancel

Cancel a running compilation.

**JSON Body**: `{}` (empty)

---

## HISE Asset Manager

### GET /api/assets/list

List HISE asset payloads.

**Query Parameters**:

| Parameter | Required | Description                                        |
|-----------|----------|----------------------------------------------------|
| `filter`  | No       | `"installed"`, `"available"`, `"outdated"` (default: `"installed"`) |

**Response**:
```json
{
  "success": true,
  "result": {
    "assets": [
      {"name": "synth_building_blocks", "version": "1.2.0", "status": "up_to_date", "source": "store", "vendor": "HISE"},
      {"name": "my_ui_framework", "version": "2.0.1", "status": "update_available", "latestVersion": "2.1.0", "source": "local", "vendor": "Me"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/assets/install

Install an asset payload.

**JSON Body**:

| Field     | Required | Description                         |
|-----------|----------|-------------------------------------|
| `name`    | Yes      | Asset name                          |
| `version` | No       | Specific version (default: latest)  |

**Response**:
```json
{
  "success": true,
  "result": {
    "name": "synth_building_blocks",
    "version": "1.2.0",
    "filesInstalled": 12,
    "preprocessors": ["USE_DSP_LIB"],
    "infoText": "## Setup\n\nAdd `include(...)` to your script.",
    "clipboardContent": "include(\"DspLib/DspLib.js\")"
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/assets/update

Update an asset payload to the latest version.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Asset name     |

---

### POST /api/assets/uninstall

Uninstall an asset payload. Modified files are preserved.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Asset name     |

**Response**:
```json
{
  "success": true,
  "result": {
    "deleted": 11,
    "preserved": ["Scripts/DspLib/custom_config.js"],
    "needsCleanup": true
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/assets/cleanup

Force-delete preserved files from a previous uninstall.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Asset name     |

---

### GET /api/assets/versions

List available versions for an asset payload.

**Query Parameters**:

| Parameter | Required | Description    |
|-----------|----------|----------------|
| `name`    | Yes      | Asset name     |

**Response**:
```json
{
  "success": true,
  "result": {
    "versions": ["1.0.0", "1.1.0", "1.2.0"]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/assets/add_local

Add a local folder as an asset payload source.

**JSON Body**:

| Field  | Required | Description                      |
|--------|----------|----------------------------------|
| `path` | Yes      | Path to the local HISE project   |

---

### POST /api/assets/remove_local

Remove a local folder asset payload source.

**JSON Body**:

| Field  | Required | Description                      |
|--------|----------|----------------------------------|
| `path` | Yes      | Path to the local HISE project   |

---

### POST /api/assets/test

Dry-run install simulation.

**JSON Body**:

| Field     | Required | Description                               |
|-----------|----------|-------------------------------------------|
| `archive` | No       | Path to a zip to simulate against         |

**Response**:
```json
{
  "success": true,
  "result": {
    "actions": [
      {"type": "file", "target": "Scripts/DspLib/DspLib.js"},
      {"type": "file", "target": "DspNetworks/ThirdParty/src/dsp.h"},
      {"type": "preprocessor", "name": "USE_DSP_LIB", "value": "1"},
      {"type": "info", "text": "## Setup\n..."},
      {"type": "clipboard", "text": "include(\"DspLib/DspLib.js\")"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

## Meta

Static data dumps for bootstrapping CLI autocomplete datasets and validating
against ground-truth data.

### GET /api/meta/module_types

Returns all module types categorized by builder constant namespace.

**Response**:
```json
{
  "success": true,
  "result": {
    "SoundGenerators": ["SineSynth", "WaveSynth", "StreamingSampler", "SynthChain", "..."],
    "Modulators": ["AHDSR", "LFO", "Velocity", "SimpleEnvelope", "..."],
    "Effects": ["SimpleGain", "SimpleReverb", "Convolution", "Dynamics", "..."],
    "MidiProcessors": ["Arpeggiator", "Transposer", "MidiMuter", "..."]
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/meta/chain_indexes

Returns chain types and which module categories they accept.

**Response**:
```json
{
  "success": true,
  "result": {
    "chains": {
      "Direct": {"index": 0, "accepts": ["SoundGenerators"]},
      "Gain": {"index": 1, "accepts": ["Modulators"]},
      "Pitch": {"index": 2, "accepts": ["Modulators"]},
      "FX": {"index": 3, "accepts": ["Effects"]},
      "Midi": {"index": 4, "accepts": ["MidiProcessors"]}
    }
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/meta/scriptnode_nodes

Returns all scriptnode factories and their nodes.

**Response**:
```json
{
  "success": true,
  "result": {
    "container": ["chain", "split", "multi", "modchain", "..."],
    "core": ["gain", "oscillator", "peak", "ramp", "..."],
    "math": ["mul", "add", "clip", "..."],
    "filters": ["svf", "ladder", "moog", "..."],
    "...": ["..."]
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/meta/sample_properties

Returns sample property indexes and their types.

**Response**:
```json
{
  "success": true,
  "result": {
    "properties": [
      {"index": 0, "name": "FileName", "type": "string"},
      {"index": 1, "name": "Root", "type": "int"},
      {"index": 2, "name": "LoKey", "type": "int"},
      {"index": 3, "name": "HiKey", "type": "int"},
      {"index": 4, "name": "LoVel", "type": "int"},
      {"index": 5, "name": "HiVel", "type": "int"},
      {"index": 6, "name": "RRGroup", "type": "int"},
      {"index": 7, "name": "Volume", "type": "double"},
      {"index": 8, "name": "Pan", "type": "int"},
      {"index": 9, "name": "SampleStart", "type": "int"},
      {"index": 10, "name": "SampleEnd", "type": "int"},
      {"index": 11, "name": "LoopStart", "type": "int"},
      {"index": 12, "name": "LoopEnd", "type": "int"},
      {"index": 13, "name": "LoopEnabled", "type": "bool"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/meta/scripting_api

Returns scripting API namespaces and their method signatures.

**Response**:
```json
{
  "success": true,
  "result": {
    "Synth": [
      {"name": "addNoteOn", "params": ["int channel", "int noteNumber", "int velocity", "int timestamp"], "returns": "int"},
      {"name": "addNoteOff", "params": ["int channel", "int noteNumber", "int timestamp"], "returns": "int"},
      "..."
    ],
    "Engine": [
      {"name": "getSampleRate", "params": [], "returns": "double"},
      {"name": "getBufferSize", "params": [], "returns": "int"},
      "..."
    ],
    "...": ["..."]
  },
  "logs": [],
  "errors": []
}
```

---

## Project

Project lifecycle endpoints: listing, switching, saving/loading files, settings,
file tree with runtime cross-references, and snippet I/O.

### GET /api/project/list

List available HISE projects. Parses `project_info.xml` in each known project
folder to extract the project name.

**Response**:
```json
{
  "success": true,
  "result": {
    "projects": [
      { "name": "MyPlugin", "path": "/Users/foo/HISE Projects/MyPlugin" },
      { "name": "TestSynth", "path": "/Users/foo/HISE Projects/TestSynth" }
    ],
    "active": "MyPlugin"
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/project/tree

Project file structure with runtime cross-reference flags. Each file node
carries `referenced` to indicate whether HISE's runtime actively uses it
(included scripts, loaded samplemaps, referenced images, active DSP networks).
Unreferenced files are dimmed in the CLI sidebar.

**Response**:
```json
{
  "success": true,
  "result": {
    "projectName": "MyPlugin",
    "root": {
      "name": "MyPlugin",
      "type": "folder",
      "children": [
        {
          "name": "Scripts",
          "type": "folder",
          "children": [
            { "name": "Interface.js", "type": "file", "referenced": true },
            { "name": "Unused.js", "type": "file", "referenced": false }
          ]
        },
        {
          "name": "SampleMaps",
          "type": "folder",
          "children": [
            { "name": "MainSamples.xml", "type": "file", "referenced": true }
          ]
        },
        {
          "name": "Images",
          "type": "folder",
          "children": [
            { "name": "knob.png", "type": "file", "referenced": true },
            { "name": "old_bg.png", "type": "file", "referenced": false }
          ]
        },
        {
          "name": "DspNetworks",
          "type": "folder",
          "children": [
            { "name": "MyEffect.xml", "type": "file", "referenced": true }
          ]
        },
        {
          "name": "UserPresets",
          "type": "folder",
          "children": [
            { "name": "Default.preset", "type": "file", "referenced": true }
          ]
        },
        {
          "name": "Binaries",
          "type": "folder",
          "children": []
        }
      ]
    }
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/project/files

List saveable project files (XmlPresetBackups and HIP files).

**Response**:
```json
{
  "success": true,
  "result": {
    "files": [
      { "name": "MyPlugin.xml", "type": "xml", "path": "XmlPresetBackups/MyPlugin.xml", "modified": "2026-04-09T14:30:00Z" },
      { "name": "MyPlugin.hip", "type": "hip", "path": "MyPlugin.hip", "modified": "2026-04-10T09:15:00Z" },
      { "name": "Autosave_1.hip", "type": "hip", "path": "Autosave_1.hip", "modified": "2026-04-10T10:00:00Z" }
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### GET /api/project/settings/list

All project-scoped settings from `project_info.xml`.

**Response**:
```json
{
  "success": true,
  "result": {
    "settings": {
      "Name": "MyPlugin",
      "Version": "1.0.0",
      "Description": "",
      "BundleName": "",
      "PluginCode": "Mypl",
      "EmbedImageFiles": "1",
      "EmbedAudioFiles": "1",
      "SupportFullDynamicsHLAC": "0",
      "AdditionalDspLibraries": "",
      "VST3Support": "1",
      "AUSupport": "1",
      "AAXSupport": "0",
      "UseRawFrontend": "0",
      "ExtraDefinitionsWindows": "",
      "ExtraDefinitionsMacOS": "",
      "ExtraDefinitionsLinux": "",
      "ExtraDefinitionsIOS": ""
    }
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/project/settings/set

Update a project setting.

**JSON Body**:

| Field   | Required | Description     |
|---------|----------|-----------------|
| `key`   | Yes      | Setting key     |
| `value` | Yes      | New value       |

**Request**:
```json
{
  "key": "Version",
  "value": "1.1.0"
}
```

**Response**:
```json
{
  "success": true,
  "result": "OK",
  "logs": ["Updated Version to 1.1.0"],
  "errors": []
}
```

---

### POST /api/project/save

Save current state as XML or HIP. Optional filename override. Saving a HIP
with a custom filename renames the master chain to match (preexisting HISE
behaviour).

**JSON Body**:

| Field      | Required | Description                            |
|------------|----------|----------------------------------------|
| `format`   | Yes      | `"xml"` or `"hip"`                     |
| `filename` | No       | Override filename (without extension)   |

**Request**:
```json
{
  "format": "xml",
  "filename": "MyPlugin_v2"
}
```

**Response** (XML):
```json
{
  "success": true,
  "result": {
    "path": "XmlPresetBackups/MyPlugin_v2.xml"
  },
  "logs": ["Saved as MyPlugin_v2.xml"],
  "errors": []
}
```

**Response** (HIP with custom filename — master chain rename):
```json
{
  "success": true,
  "result": {
    "path": "QuickTest.hip",
    "masterChainRenamed": true,
    "newName": "QuickTest"
  },
  "logs": ["Saved as QuickTest.hip", "Renamed master chain to QuickTest"],
  "errors": []
}
```

---

### POST /api/project/load

Load an XML or HIP file into the current project.

**JSON Body**:

| Field  | Required | Description                                  |
|--------|----------|----------------------------------------------|
| `file` | Yes      | Relative path to XML or HIP file             |

**Request**:
```json
{
  "file": "XmlPresetBackups/MyPlugin.xml"
}
```

**Response**:
```json
{
  "success": true,
  "result": "OK",
  "logs": ["Loaded MyPlugin.xml"],
  "errors": []
}
```

---

### POST /api/project/switch

Switch active project by name or absolute path. HISE resolves: if `project`
matches a known project name (from `/api/project/list`), use that. Otherwise
treat it as an absolute path. Error if neither resolves.

**JSON Body**:

| Field     | Required | Description                              |
|-----------|----------|------------------------------------------|
| `project` | Yes      | Project name or absolute filesystem path |

**Request** (by name):
```json
{
  "project": "TestSynth"
}
```

**Request** (by path):
```json
{
  "project": "/Users/foo/HISE Projects/SomeOtherPlugin"
}
```

**Response**:
```json
{
  "success": true,
  "result": "OK",
  "logs": ["Switched to TestSynth"],
  "errors": []
}
```

---

### GET /api/project/export_snippet

Export the current project as a HISE snippet string.

**Response**:
```json
{
  "success": true,
  "result": {
    "snippet": "HiseSnippet 1234.abc..."
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/project/import_snippet

Import a HISE snippet.

**JSON Body**:

| Field     | Required | Description              |
|-----------|----------|--------------------------|
| `snippet` | Yes      | HISE snippet string      |

**Response**:
```json
{
  "success": true,
  "result": "OK",
  "logs": ["Imported snippet"],
  "errors": []
}
```

---

## Presets

### GET /api/presets/list

List user presets as a folder hierarchy mirroring the `UserPresets` directory.

**Query Parameters**:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path`    | No       | Subfolder path to list (default: root) |
| `flat`    | No       | `true` for flat list, `false` for tree (default: `false`) |

---

### POST /api/presets/load

Load a user preset by name or relative path.

**JSON Body**:

| Field    | Required | Description |
|----------|----------|-------------|
| `preset` | Yes      | Preset name or relative path under `UserPresets` |

---

### POST /api/presets/save

Save the current state as a user preset.

**JSON Body**:

| Field       | Required | Description |
|-------------|----------|-------------|
| `preset`    | Yes      | Preset name or relative path under `UserPresets` |
| `overwrite` | No       | Overwrite existing preset (default: `true`) |

---

### GET /api/presets/get_default

Get the configured default user preset.

---

### POST /api/presets/set_default

Set the default user preset.

**JSON Body**:

| Field    | Required | Description |
|----------|----------|-------------|
| `preset` | Yes      | Preset name or relative path under `UserPresets` |

---

### POST /api/presets/clear_default

Clear the configured default user preset.

**JSON Body**: `{}` (empty)

---

### POST /api/presets/reset_to_default

Load the configured default user preset.

**Behavior**:
- If no default user preset is configured, return an error.

**JSON Body**: `{}` (empty)

---

### POST /api/presets/validate

Validate a specific user preset.

**JSON Body**:

| Field    | Required | Description |
|----------|----------|-------------|
| `preset` | Yes      | Preset name or relative path under `UserPresets` |

---

### POST /api/presets/validate_all

Validate all user presets.

**JSON Body**: `{}` (empty)

---

## Tools

### POST /api/tools/sfz_to_samplemap

Batch convert SFZ files to HISE sample maps.

**JSON Body**:

| Field   | Required | Description             |
|---------|----------|-------------------------|
| `files` | Yes      | Array of SFZ file paths |

---

### POST /api/tools/create_rsa_keys

Generate an RSA key pair for the license system.

**JSON Body**: `{}` (empty)

**Response**:
```json
{
  "success": true,
  "result": {
    "publicKey": "...",
    "privateKey": "..."
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/tools/render_audio

Render HISE audio output to a file.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `duration` | No       | Duration in seconds (default: 1.0)      |
| `path`     | No       | Output file path                         |

---

### GET /api/tools/dsp_dll_info

Get information about the loaded DSP network DLL.

**Response**:
```json
{
  "success": true,
  "result": {
    "loaded": true,
    "path": "D:/Projects/MyPlugin/Binaries/dll/MyPlugin.dll",
    "networks": ["MyDSP", "MyEffect"]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/tools/wavetable_create

Create wavetable banks from sample maps.

**JSON Body**:

| Field     | Required | Description                              |
|-----------|----------|------------------------------------------|
| `map`     | Yes      | Sample map name                          |

---

### POST /api/tools/check_latency

Analyze and report signal chain latency.

**JSON Body**: `{}` (empty)

**Response**:
```json
{
  "success": true,
  "result": {
    "totalLatencySamples": 512,
    "totalLatencyMs": 11.6,
    "chain": [
      {"module": "Convolution1", "samples": 512}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

## UI Component Management

Two endpoints for reading and mutating UI components, mirroring the
`/api/builder/tree` + `/api/builder/apply` pattern. Complements the existing
read-only endpoints (`GET /api/list_components`, `GET /api/get_component_properties`,
`GET/POST /api/*_component_value`). Used by the `/ui` mode (Phase 6.3).

All mutations go through `POST /api/ui/apply` as an operations array so the
CLI can batch commands (e.g. comma-chained `add ScriptButton "A", add ScriptSlider "B"`)
into a single round-trip. Each apply call is a single undo transaction — the
cross-domain undo system (`/api/undo/*`) records it so `/undo back` reverses
the entire batch.

### GET /api/ui/tree

Return the component hierarchy for a script processor's interface.

**Query Parameters**:

| Parameter  | Required | Description                                      |
|------------|----------|--------------------------------------------------|
| `moduleId` | Yes      | Script processor ID (e.g., `"Interface"`)        |

**Response**:
```json
{
  "success": true,
  "result": {
    "id": "Content",
    "type": "ScriptPanel",
    "visible": true,
    "enabled": true,
    "saveInPreset": false,
    "x": 0, "y": 0, "width": 900, "height": 600,
    "childComponents": [
      {
        "id": "MainPanel",
        "type": "ScriptPanel",
        "visible": true,
        "enabled": true,
        "saveInPreset": false,
        "x": 0, "y": 0, "width": 900, "height": 500,
        "childComponents": [
          {
            "id": "GainKnob",
            "type": "ScriptSlider",
            "visible": true,
            "enabled": true,
            "saveInPreset": true,
            "x": 100, "y": 50, "width": 128, "height": 48,
            "childComponents": []
          },
          {
            "id": "PlayButton",
            "type": "ScriptButton",
            "visible": true,
            "enabled": true,
            "saveInPreset": true,
            "x": 300, "y": 50, "width": 128, "height": 32,
            "childComponents": []
          }
        ]
      },
      {
        "id": "DebugLabel",
        "type": "ScriptLabel",
        "visible": false,
        "enabled": true,
        "saveInPreset": false,
        "x": 0, "y": 550, "width": 400, "height": 30,
        "childComponents": []
      }
    ]
  },
  "logs": [],
  "errors": []
}
```

Each node in the tree has:

| Field             | Type       | Description                                        |
|-------------------|------------|----------------------------------------------------|
| `id`              | `string`   | Component ID (unique within the interface)         |
| `type`            | `string`   | Component type (`ScriptButton`, `ScriptPanel`, …)  |
| `visible`         | `boolean`  | Whether the component is visible                   |
| `enabled`         | `boolean`  | Whether the component is enabled                   |
| `saveInPreset`    | `boolean`  | Whether the component's value is saved in presets  |
| `x`               | `number`   | X position relative to parent                      |
| `y`               | `number`   | Y position relative to parent                      |
| `width`           | `number`   | Width in pixels                                    |
| `height`          | `number`   | Height in pixels                                   |
| `childComponents` | `array`    | Child component nodes (empty array for leaf nodes) |

The root node (`"Content"`) represents the interface content area.
Positions are relative to the parent component.

**Error cases**:
- 404: `moduleId` is not a valid script processor

**Implementation notes**: Builds the tree recursively from the Content
component's child list. Uses `getScriptComponentFor()` to query each
component's properties. Same data as `GET /api/list_components?hierarchy=true`
but with `saveInPreset` added and wrapped in the builder-style envelope.

---

### POST /api/ui/apply

Apply a batch of UI component operations. Returns a diff of what changed,
scoped to the current undo group (same envelope as `POST /api/builder/apply`).

**JSON Body**:

| Field        | Required | Description                                        |
|--------------|----------|----------------------------------------------------|
| `moduleId`   | Yes      | Script processor ID (e.g., `"Interface"`)          |
| `operations` | Yes      | Array of operation objects (see below)              |

**Operation types**:

Each operation object requires an `op` field (not `type`) to specify the
operation kind, matching the builder's `POST /api/builder/apply` convention.

#### `add` — Create a new component

| Field           | Required | Description                                               |
|-----------------|----------|-----------------------------------------------------------|
| `op`            | —        | `"add"`                                                   |
| `componentType` | Yes      | Component type (e.g., `"ScriptButton"`, `"ScriptPanel"`)  |
| `id`            | No       | Component ID (auto-generated if omitted)                  |
| `x`             | No       | X position (default: 0)                                   |
| `y`             | No       | Y position (default: 0)                                   |
| `width`         | No       | Width (default: type-dependent)                           |
| `height`        | No       | Height (default: type-dependent)                          |
| `parentId`      | No       | Parent panel ID (default: root content)                   |

Maps component types to `Content::add*` methods:
`ScriptButton` → `addButton()`, `ScriptSlider` → `addKnob()`,
`ScriptPanel` → `addPanel()`, `ScriptComboBox` → `addComboBox()`,
`ScriptLabel` → `addLabel()`, `ScriptImage` → `addImage()`,
`ScriptTable` → `addTable()`, `ScriptSliderPack` → `addSliderPack()`,
`ScriptAudioWaveform` → `addAudioWaveform()`,
`ScriptFloatingTile` → `addFloatingTile()`,
`ScriptWebView` → `addWebView()`,
`ScriptedViewport` → `addViewport()`.

#### `remove` — Delete a component

| Field    | Required | Description           |
|----------|----------|-----------------------|
| `op`     | —        | `"remove"`            |
| `target` | Yes      | Component ID          |

Removes the component and all children recursively.

#### `set` — Change component properties

| Field        | Required | Description                            |
|--------------|----------|----------------------------------------|
| `op`         | —        | `"set"`                                |
| `target`     | Yes      | Component ID                           |
| `properties` | Yes      | Object of `{ propertyName: value }`    |

Uses `set_component_properties` internally. Properties set in script are
protected — use `"force": true` in the operation to override.

#### `move` — Reparent a component

| Field          | Required | Description                                       |
|----------------|----------|---------------------------------------------------|
| `op`           | —        | `"move"`                                          |
| `target`       | Yes      | Component ID to reparent                          |
| `parent`       | Yes      | New parent panel ID (empty string for root)       |
| `index`        | No       | Z-order index within new parent (default: append) |
| `keepPosition` | No       | If true, preserve absolute screen position (default: false) |

Validates the target parent is a ScriptPanel (or root) and checks for
circular references.

#### `rename` — Change a component's ID

| Field    | Required | Description              |
|----------|----------|--------------------------|
| `op`     | —        | `"rename"`               |
| `target` | Yes      | Current component ID     |
| `newId`  | Yes      | New component ID         |

Validates uniqueness and character constraints.

**Request example** (batched — add + set in one call):
```json
{
  "moduleId": "Interface",
  "operations": [
    { "op": "add", "componentType": "ScriptPanel", "id": "MainPanel", "x": 0, "y": 0, "width": 900, "height": 500 },
    { "op": "add", "componentType": "ScriptButton", "id": "PlayButton", "x": 100, "y": 50, "width": 128, "height": 32, "parentId": "MainPanel" },
    { "op": "set", "target": "PlayButton", "properties": { "saveInPreset": true, "text": "Play" } }
  ]
}
```

**Response** (matches builder apply envelope):
```json
{
  "success": true,
  "result": {
    "scope": "root",
    "groupName": "",
    "diff": [
      { "domain": "ui", "action": "+", "target": "MainPanel" },
      { "domain": "ui", "action": "+", "target": "PlayButton" },
      { "domain": "ui", "action": "*", "target": "PlayButton" }
    ]
  },
  "logs": [],
  "errors": []
}
```

The diff uses the same `DiffEntry` shape as builder:
- `domain`: `"ui"` (enables cross-domain undo with builder's `"builder"` entries)
- `action`: `"+"` added, `"-"` removed, `"*"` modified
- `target`: component ID

**Error cases** (first failing operation aborts the batch):
- 400: unknown operation `type`
- 400: `add` with invalid component type
- 400: `add` with duplicate ID
- 400: `add` with empty ID or invalid characters
- 400: `move` to self or descendant (circular)
- 400: `rename` to existing ID
- 404: `moduleId` is not a valid script processor
- 404: `target` component does not exist
- 404: `parentId` / `parent` does not exist or is not a ScriptPanel

**Undo integration**: The entire `operations` array is one undo transaction.
`POST /api/undo/back` reverses the whole batch. When inside an undo group
(`POST /api/undo/push_group` … `POST /api/undo/pop_group`), UI operations
are grouped with builder operations — the cross-domain undo system handles
both `"builder"` and `"ui"` domains transparently.

**Implementation notes**: Iterates the operations array, executing each
against the Content API. Collects diff entries as operations succeed.
If any operation fails, all preceding operations in the batch are undone
(transactional rollback) and the error is returned.

---

### POST /api/ui/validate_parameters

Validate UI parameter bindings and ranges.

**JSON Body**:

| Field      | Required | Description |
|------------|----------|-------------|
| `moduleId` | Yes      | Script processor ID (e.g., `Interface`) |

---

## Expansion Management

Endpoints for listing, switching, creating, and encoding HISE expansions.
Wraps the `ExpansionHandler` C++ API (accessible via
`MainController::getExpansionHandler()`). Used by the `/expansions` mode
(Phase 6.4).

### GET /api/expansions/list

List all available expansions with their properties and active status.

**Query Parameters**: None.

**Response**:
```json
{
  "success": true,
  "expansions": [
    {
      "name": "Factory Content",
      "version": "1.0.0",
      "isActive": true,
      "properties": {
        "Name": "Factory Content",
        "Version": "1.0.0",
        "Description": "Default factory samples and presets",
        "Tags": "factory, default",
        "UUID": "abc123-def456"
      }
    },
    {
      "name": "Expansion Pack 1",
      "version": "1.2.0",
      "isActive": false,
      "properties": {
        "Name": "Expansion Pack 1",
        "Version": "1.2.0",
        "Description": "Additional sound library",
        "Tags": "expansion",
        "UUID": "ghi789-jkl012"
      }
    }
  ],
  "logs": [],
  "errors": []
}
```

**Implementation notes**: Uses `getExpansionHandler().getListOfAvailableExpansions()`
to enumerate expansions, `getCurrentExpansion()` to determine active state,
and `Expansion::getProperties()` for property data.

---

### POST /api/expansions/switch

Switch the active expansion.

**JSON Body**:

| Field  | Required | Description                                          |
|--------|----------|------------------------------------------------------|
| `name` | Yes      | Expansion name to activate (empty string to deactivate all) |

**Response**:
```json
{
  "success": true,
  "result": "Switched to expansion: Expansion Pack 1",
  "activeExpansion": "Expansion Pack 1",
  "logs": [],
  "errors": []
}
```

**Error cases**:
- 404: expansion `name` does not exist

**Implementation notes**: Uses `getExpansionHandler().setCurrentExpansion(name)`.

---

### POST /api/expansions/create

Create a new expansion.

**JSON Body**:

| Field         | Required | Description                              |
|---------------|----------|------------------------------------------|
| `name`        | Yes      | Expansion name                           |
| `version`     | No       | Version string (default: `"1.0.0"`)     |
| `description` | No       | Expansion description                    |

**Response**:
```json
{
  "success": true,
  "result": "Expansion created",
  "expansion": {
    "name": "My Expansion",
    "version": "1.0.0",
    "description": "A new expansion"
  },
  "logs": [],
  "errors": []
}
```

**Error cases**:
- 400: `name` is empty
- 400: expansion with `name` already exists
- 400: `name` contains invalid characters (filesystem-safe names only)

**Implementation notes**: Creates the expansion folder structure under
the project's Expansions directory. Writes the expansion properties XML.

---

### POST /api/expansions/encode

Encode expansion assets (monolith format, encrypted packages).

**JSON Body**:

| Field  | Required | Description                                               |
|--------|----------|-----------------------------------------------------------|
| `name` | Yes      | Expansion name to encode                                  |
| `type` | No       | Encode type: `"monolith"`, `"package"` (default: `"monolith"`) |

**Response**:
```json
{
  "success": true,
  "result": "Expansion encoded",
  "expansion": "My Expansion",
  "type": "monolith",
  "logs": [],
  "errors": []
}
```

**Error cases**:
- 400: invalid `type` value
- 404: expansion `name` does not exist

**Implementation notes**: Long-running operation. When SSE is available
(Phase 7), progress events should be emitted. Until then, the HTTP
request blocks until encoding completes (with the standard 30s timeout —
may need an extended timeout for large expansions).

---

### GET /api/expansions/assets

List assets grouped by type for a specific expansion.

**Query Parameters**:

| Parameter | Required | Description               |
|-----------|----------|---------------------------|
| `name`    | Yes      | Expansion name            |

**Response**:
```json
{
  "success": true,
  "expansion": "Factory Content",
  "assets": {
    "Images": [
      "background.png",
      "logo.png",
      "knob_filmstrip.png"
    ],
    "AudioFiles": [
      "impulse_hall.wav",
      "noise_layer.wav"
    ],
    "SampleMaps": [
      "Piano_Map.xml",
      "Strings_Map.xml"
    ],
    "MidiFiles": [
      "arp_pattern.mid"
    ],
    "UserPresets": [
      "Init.preset",
      "Bright Pad.preset"
    ]
  },
  "logs": [],
  "errors": []
}
```

**Error cases**:
- 404: expansion `name` does not exist

**Implementation notes**: Uses `Expansion::getAudioFileList()`,
`getImageFileList()`, `getSampleMapList()`, `getMidiFileList()`,
`getUserPresetList()`. Asset paths are relative to the expansion root.

---

### POST /api/expansions/refresh

Refresh the expansion list (re-scan the Expansions directory).

**JSON Body**: Empty (`{}`).

**Response**:
```json
{
  "success": true,
  "result": "Expansion list refreshed",
  "count": 3,
  "logs": [],
  "errors": []
}
```

**Implementation notes**: Uses `getExpansionHandler().refreshExpansions()`.
Returns the updated expansion count.

---

## Wizard Endpoints

Wizard endpoints support the hise-cli wizard framework (phase 5). Three
execution patterns exist:

1. **Sync** — HISE performs the work and returns immediately.
2. **Long-running job** — HISE starts a background thread, returns a `jobId`.
   The client polls `/api/wizard/status` for progress until completion.
3. **Prepare-only** — HISE generates build artifacts (Projucer project,
   build script). The client runs the system compiler locally.

All wizard endpoints use the standard response envelope.

---

### GET /api/wizard/initialise

Fetch pre-populated field defaults for a wizard form. Called before
displaying the form so HISE can inject environment-specific values.

**Query Parameters**:

| Parameter | Required | Description          |
|-----------|----------|----------------------|
| `id`      | Yes      | The wizard ID string |

**Response** (success):
```json
{
  "success": true,
  "result": {
    "FieldId1": "default value",
    "FieldId2": "/some/detected/path"
  },
  "logs": [],
  "errors": []
}
```

`result` is a flat `Record<string, string>` — keys are field IDs from the
wizard definition, values are detected defaults. Unknown keys are ignored
by the client. Fields not present in the response keep their YAML defaults.

**Response** (failure):
```json
{
  "success": false,
  "result": null,
  "logs": [],
  "errors": [{ "errorMessage": "No project loaded", "callstack": [] }]
}
```

Init failure is **non-fatal** — the client falls back to YAML defaults.

#### Per-wizard init contracts

**`new_project`** — Detects the default project folder location.

```json
// GET /api/wizard/initialise?id=new_project
// Response result:
{
  "DefaultProjectFolder": "/Users/foo/HISE Projects"
}
```

**`plugin_export`** — Returns current project settings relevant to export.

```json
// GET /api/wizard/initialise?id=plugin_export
// Response result:
{
  "ExportType": "Plugin",
  "projectType": "Instrument",
  "pluginType": "VST"
}
```

**`audio_export`** — Suggests default output path.

```json
// GET /api/wizard/initialise?id=audio_export
// Response result:
{
  "Location": "/Users/foo/HISE Projects/MyProject/Exports/output.wav"
}
```

**`install_package_maker`** — Loads existing `install_package.json` if
present, returns its values as field defaults.

```json
// GET /api/wizard/initialise?id=install_package_maker
// Response result:
{
  "InfoText": "Existing info text from file",
  "PositiveWildcard": "Scripts/,*.hip",
  "NegativeWildcard": "*.txt",
  "FileTypeFilter": "AudioFiles,Scripts",
  "Preprocessors": "Raw Processor",
  "UseClipboard": "0",
  "ClipboardContent": ""
}
```

**`recompile`** — No init needed. The client does not call initialise.

**`compile_networks`** — No init needed.

**`setup`** — Init is `type: "internal"` (handled in TypeScript). No HTTP
init call.

---

### POST /api/wizard/execute

Execute a wizard task. The request body identifies the wizard, provides
all form answers, and names the task function to run.

**JSON Body**:

| Field      | Type                      | Required | Description                        |
|------------|---------------------------|----------|------------------------------------|
| `wizardId` | `string`                  | Yes      | Wizard ID                          |
| `answers`  | `Record<string, string>`  | Yes      | All field values from the form     |
| `tasks`    | `string[]`                | Yes      | Task function names to execute     |

The `tasks` array always contains exactly one function name. HISE
dispatches internally based on `wizardId` + `tasks[0]`. For wizards with
multiple alternative tasks (e.g. `new_project`), HISE uses the `answers`
to determine which operation to perform — non-matching tasks return
success with a no-op.

#### Sync response

For fast operations that complete immediately:

```json
{
  "success": true,
  "result": "Project created at /Users/foo/HISE Projects/MyProject",
  "logs": ["Created directory structure", "Wrote project_info.xml"],
  "errors": []
}
```

#### Long-running job response

For operations that take significant wall-clock time (audio rendering,
future monolith encoding, expansion encoding). HISE starts the operation
on a background thread and returns a job handle:

```json
{
  "success": true,
  "result": {
    "jobId": "audio_export_1717600000",
    "async": true
  },
  "logs": [],
  "errors": []
}
```

The client detects a job response by checking `result.async === true` and
switches to polling `/api/wizard/status`.

#### Error response

```json
{
  "success": false,
  "result": null,
  "logs": ["Attempted to create project folder"],
  "errors": [
    { "errorMessage": "Folder already exists: /path/to/MyProject", "callstack": [] }
  ]
}
```

---

### GET /api/wizard/status

Poll progress of a long-running wizard job. Only used for async tasks
(where execute returned `async: true`).

**Query Parameters**:

| Parameter | Required | Description                  |
|-----------|----------|------------------------------|
| `jobId`   | Yes      | Job ID from execute response |

**Response** (in progress):
```json
{
  "success": true,
  "result": {
    "finished": false,
    "progress": 0.45,
    "message": "Rendering audio: 3.6s / 8.0s"
  },
  "logs": [],
  "errors": []
}
```

**Response** (completed):
```json
{
  "success": true,
  "result": {
    "finished": true,
    "progress": 1.0,
    "message": "Export complete"
  },
  "logs": ["Rendered 8.0 seconds of audio", "Written to /path/to/output.wav"],
  "errors": []
}
```

**Response** (failed):
```json
{
  "success": false,
  "result": {
    "finished": true,
    "progress": 0.6,
    "message": "Audio engine error"
  },
  "logs": ["Rendered 4.8 seconds before failure"],
  "errors": [{ "errorMessage": "Buffer underrun in audio callback", "callstack": [] }]
}
```

**Response** (unknown job):
```json
{
  "success": false,
  "result": null,
  "logs": [],
  "errors": [{ "errorMessage": "No active job with ID: invalid_id", "callstack": [] }]
}
```

**Polling interval**: The client polls every 500ms. HISE does not need to
rate-limit — the `requestSerializationLock` naturally throttles.

**Job lifecycle**: A job is queryable from the moment `execute` returns
until the client has retrieved a `finished: true` response. After that,
HISE may discard the job state. Only one job runs at a time (HISE is
single-threaded for REST).

---

### Per-Wizard Execute Contracts

#### `new_project` — Sync

HISE dispatches internally based on `answers.Template`:
- `"0"` → create empty project
- `"1"` → import HXI archive (uses `answers.hxiFile`)
- `"2"` → extract Rhapsody template

All three task functions are sent sequentially by the client. HISE
executes only the one matching the Template value; the others return
success as no-ops.

**Request** (empty project):
```json
{
  "wizardId": "new_project",
  "answers": {
    "ProjectName": "MyPlugin",
    "DefaultProjectFolder": "/Users/foo/HISE Projects",
    "UseDefault": "1",
    "Template": "0"
  },
  "tasks": ["createEmptyProject"]
}
```

**Response**:
```json
{
  "success": true,
  "result": "Project created at /Users/foo/HISE Projects/MyPlugin",
  "logs": [
    "Created directory structure",
    "Generated project_info.xml",
    "Switched active project to MyPlugin"
  ],
  "errors": []
}
```

**Request** (import HXI):
```json
{
  "wizardId": "new_project",
  "answers": {
    "ProjectName": "ImportedPlugin",
    "DefaultProjectFolder": "/Users/foo/HISE Projects",
    "UseDefault": "1",
    "Template": "1",
    "hxiFile": "/Users/foo/Downloads/MyLibrary.hxi"
  },
  "tasks": ["importHxiTask"]
}
```

**Response**:
```json
{
  "success": true,
  "result": "Imported MyLibrary.hxi into /Users/foo/HISE Projects/ImportedPlugin",
  "logs": [
    "Extracted archive (14 files)",
    "Generated project_info.xml",
    "Switched active project to ImportedPlugin"
  ],
  "errors": []
}
```

---

#### `recompile` — Sync

Triggers F5-style recompile with optional cache clearing. Completes in
seconds.

**Request**:
```json
{
  "wizardId": "recompile",
  "answers": {
    "clearGlobals": "1",
    "clearFonts": "0",
    "clearAudioFiles": "0",
    "clearImages": "0"
  },
  "tasks": ["task"]
}
```

**Response**:
```json
{
  "success": true,
  "result": "Recompilation complete",
  "logs": [
    "Cleared global variables",
    "Compiled 3 script processors",
    "Compilation time: 1.2s"
  ],
  "errors": []
}
```

---

#### `plugin_export` — Sync (prepare only)

HISE generates the Projucer project file and platform build script. The
actual compilation is handled by hise-cli internally (runs the system
compiler via `PhaseExecutor`, reusing the setup wizard's compile
infrastructure).

The existing `export_ci` command-line codepath is reused — this endpoint
is a thin wrapper that writes the same build artifacts without launching
the compiler.

**Request**:
```json
{
  "wizardId": "plugin_export",
  "answers": {
    "ExportType": "Plugin",
    "projectType": "Instrument",
    "pluginType": "VST"
  },
  "tasks": ["compileTask"]
}
```

**Response**:
```json
{
  "success": true,
  "result": {
    "projectFile": "/Users/foo/HISE Projects/MyPlugin/Binaries/MyPlugin.jucer",
    "buildScript": "/Users/foo/HISE Projects/MyPlugin/Binaries/build.sh",
    "buildDirectory": "/Users/foo/HISE Projects/MyPlugin/Binaries",
    "configuration": "Release"
  },
  "logs": [
    "Generated Projucer file",
    "Created build script for macOS/arm64",
    "Export type: VST Instrument"
  ],
  "errors": []
}
```

The `result` object provides paths the client needs to invoke the
compiler. The client reads `buildScript` and `buildDirectory` to execute
the build step internally.

---

#### `compile_networks` — Sync (prepare only)

Same pattern as `plugin_export`. HISE generates the DLL C++ project from
scriptnode network graphs. The client compiles locally.

**Request**:
```json
{
  "wizardId": "compile_networks",
  "answers": {
    "replaceScriptModules": "1",
    "openIDE": "0"
  },
  "tasks": ["compileTask"]
}
```

**Response**:
```json
{
  "success": true,
  "result": {
    "projectFile": "/Users/foo/HISE Projects/MyPlugin/DspNetworks/Binaries/MyPlugin_ScriptNodes.jucer",
    "buildScript": "/Users/foo/HISE Projects/MyPlugin/DspNetworks/Binaries/build.sh",
    "buildDirectory": "/Users/foo/HISE Projects/MyPlugin/DspNetworks/Binaries",
    "configuration": "Release",
    "networks": ["MyFilter", "MySynth", "MyEffect"]
  },
  "logs": [
    "Found 3 networks with C++ source",
    "Generated Projucer file for DLL",
    "Created build script"
  ],
  "errors": []
}
```

---

#### `audio_export` — Long-running job

Renders live audio output to WAV. Uses realtime rendering by default, so
wall-clock duration equals render length. This is the test balloon for
the async job pattern.

**Request**:
```json
{
  "wizardId": "audio_export",
  "answers": {
    "Location": "/Users/foo/Desktop/render.wav",
    "Length": "8 seconds",
    "Realtime": "1",
    "MidiInput": "0",
    "OpenInEditor": "1"
  },
  "tasks": ["onExport"]
}
```

**Response** (job started):
```json
{
  "success": true,
  "result": {
    "jobId": "audio_export_1717600000",
    "async": true
  },
  "logs": [],
  "errors": []
}
```

Then the client polls `GET /api/wizard/status?jobId=audio_export_1717600000`:

**Status** (in progress):
```json
{
  "success": true,
  "result": {
    "finished": false,
    "progress": 0.45,
    "message": "Rendering: 3.6s / 8.0s"
  },
  "logs": [],
  "errors": []
}
```

**Status** (complete):
```json
{
  "success": true,
  "result": {
    "finished": true,
    "progress": 1.0,
    "message": "Rendered 8.0s to /Users/foo/Desktop/render.wav"
  },
  "logs": [
    "Sample rate: 44100 Hz",
    "Channels: 2",
    "File size: 2.7 MB"
  ],
  "errors": []
}
```

**Offline rendering** (`Realtime: "0"`): HISE renders faster than
realtime. The job pattern is the same — progress updates reflect
buffer-level advancement rather than wall-clock time.

**Wait for MIDI** (`MidiInput: "1"`): The job enters a waiting state
until the first MIDI event. Progress message reflects this:
`"Waiting for MIDI input..."` with `progress: 0.0`.

---

#### `install_package_maker` — Sync

Validates the form fields against the current project settings (checks
that selected preprocessors match `project_info.xml`) and writes the
`install_package.json` file.

**Request**:
```json
{
  "wizardId": "install_package_maker",
  "answers": {
    "LoadSettings": "true",
    "InfoText": "Install this package to add the piano samples.",
    "PositiveWildcard": "Scripts/,*.hip",
    "NegativeWildcard": "*.txt,Binaries/",
    "FileTypeFilter": "AudioFiles,Scripts",
    "Preprocessors": "Raw Processor,Convolution",
    "UseClipboard": "0",
    "ClipboardContent": "",
    "ExternalZipSelector": ""
  },
  "tasks": ["writePackageJson"]
}
```

**Response** (success):
```json
{
  "success": true,
  "result": "Written install_package.json",
  "logs": [
    "Validated 2 preprocessors against project settings",
    "Matched 47 files with wildcards",
    "Written to /Users/foo/HISE Projects/MyPlugin/install_package.json"
  ],
  "errors": []
}
```

**Response** (validation failure):
```json
{
  "success": false,
  "result": null,
  "logs": [],
  "errors": [
    { "errorMessage": "Preprocessor 'Convolution' not enabled in project settings", "callstack": [] }
  ]
}
```

**Implementation notes**: The task function name `writePackageJson` needs
to be added to the wizard YAML (currently `tasks: []`). HISE validates
`Preprocessors` against `project_info.xml` before writing.

---

### Future long-running wizards (job pattern)

These wizards do not exist yet but will reuse the same async job
infrastructure as `audio_export`:

- **Monolith encoding** — HLAC-compresses sample maps into `.ch1` files.
  Long-running (minutes for large sample libraries). Progress: per-sample-map.
- **Expansion encoding** — Packages expansion packs with optional
  encryption. Long-running. Progress: per-expansion.

No new endpoints needed — they use `POST /api/wizard/execute` (returns
`async: true`) and `GET /api/wizard/status` (polling).

---

## Server-Sent Events (SSE)

### GET /api/events

Subscribe to push events from HISE. Uses the standard SSE protocol
(`text/event-stream` content type). The connection is **modal** - while
active, no other REST requests are processed.

**Event format**:
```
event: progress
data: {"operation": "monolith", "percent": 45, "message": "Compressing Piano_C4.wav"}

event: console
data: {"message": "Compilation successful", "level": "info"}

event: cpu
data: {"usage": 12.3, "voices": 8}

event: midi
data: {"type": "noteOn", "note": 60, "velocity": 100, "channel": 1}
```

**Event types**:

| Event      | When emitted                                         |
|------------|------------------------------------------------------|
| `progress` | Long-running operations (monolith, export, compile)  |
| `console`  | Console output from HISE                             |
| `cpu`      | CPU usage updates (periodic during monitoring)       |
| `midi`     | MIDI activity (during monitoring)                    |
| `complete` | Operation finished                                   |
| `error`    | Operation failed                                     |

**Client disconnection** is detected via `sink.is_writable()` in
cpp-httplib, which cleanly ends the stream.

**Implementation note**: cpp-httplib supports SSE natively via
`Response::set_chunked_content_provider()`. The HISE `RestServer` wrapper
needs a new streaming route handler type that gives the handler direct
access to the chunked sink instead of returning a flat `Response` struct.
The existing `requestSerializationLock` stays held for the duration of the
stream (modal behavior).
```
