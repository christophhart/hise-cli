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
