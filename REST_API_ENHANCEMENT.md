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
> - Categories match mode names: `builder`, `sampler`, `dsp`, etc.

---

## Builder

Wraps the HiseScript Builder API for programmatic module tree construction.

### GET /api/builder/tree

Returns the current module tree as a hierarchical structure.

**Query Parameters**:

| Parameter  | Required | Description                  |
|------------|----------|------------------------------|
| `moduleId` | No       | Root module (default: master) |

**Response**:
```json
{
  "success": true,
  "result": {
    "name": "Master Chain",
    "type": "SynthChain",
    "bypassed": false,
    "chains": {
      "midi": [
        {"name": "Interface", "type": "ScriptProcessor", "bypassed": false, "chains": {}}
      ],
      "gain": [],
      "pitch": [],
      "fx": [
        {"name": "Reverb1", "type": "SimpleReverb", "bypassed": false, "chains": {}}
      ],
      "direct": [
        {
          "name": "Sampler1",
          "type": "StreamingSampler",
          "bypassed": false,
          "chains": {
            "gain": [
              {"name": "GainAHDSR", "type": "AHDSR", "bypassed": false, "chains": {}}
            ],
            "pitch": [],
            "fx": [],
            "midi": []
          }
        }
      ]
    }
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/builder/add

Add a module to the module tree.

**JSON Body**:

| Field      | Required | Description                                                   |
|------------|----------|---------------------------------------------------------------|
| `type`     | Yes      | Module type (e.g., `"SimpleGain"`, `"AHDSR"`, `"LFO"`)       |
| `parent`   | No       | Parent module name (default: root)                            |
| `chain`    | No       | Chain name: `"direct"`, `"gain"`, `"pitch"`, `"fx"`, `"midi"` |
| `name`     | No       | Custom name for the new module (auto-generated if omitted)    |
| `validate` | No       | If `true`, validate without executing (default: `false`)      |

**Request**:
```json
{
  "type": "SimpleGain",
  "parent": "Sampler1",
  "chain": "fx",
  "name": "MyGain"
}
```

**Response (success)**:
```json
{
  "success": true,
  "result": {
    "name": "MyGain",
    "type": "SimpleGain",
    "buildIndex": 3
  },
  "logs": [],
  "errors": []
}
```

**Response (validation error)**:
```json
{
  "success": false,
  "result": null,
  "logs": [],
  "errors": [
    {
      "errorMessage": "SimpleGain (effect) cannot be added to MIDI chain. Valid chains for effects: fx",
      "hints": {"validChains": ["fx"]}
    }
  ]
}
```

**Validate mode**: when `validate: true`, the command runs through the same
code path but stops before creating the module. Returns success/error without
side effects. This mirrors how `compile: false` works on `POST /api/set_script`.

---

### POST /api/builder/remove

Remove a module from the module tree.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `name`     | Yes      | Name of the module to remove             |
| `validate` | No       | Validate without executing               |

---

### POST /api/builder/clear

Clear the module tree (preserves the Interface script processor).

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `validate` | No       | Validate without executing               |

---

### POST /api/builder/clear_children

Clear all children from a specific chain.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `parent`   | Yes      | Parent module name                       |
| `chain`    | Yes      | Chain to clear                           |
| `validate` | No       | Validate without executing               |

---

### POST /api/builder/set_attributes

Set parameters on a module.

**JSON Body**:

| Field        | Required | Description                              |
|--------------|----------|------------------------------------------|
| `target`     | Yes      | Module name                              |
| `attributes` | Yes      | Object of `{paramName: value}` pairs     |

**Request**:
```json
{
  "target": "GainAHDSR",
  "attributes": {"Attack": 8000, "Release": 100}
}
```

---

### POST /api/builder/connect_to_script

Attach an external script to a script processor.

**JSON Body**:

| Field      | Required | Description                              |
|------------|----------|------------------------------------------|
| `target`   | Yes      | Script processor name                    |
| `path`     | Yes      | Script path (supports `{PROJECT_FOLDER}`) |

---

### POST /api/builder/clone

Clone a module (deep copy including children and parameters).

**JSON Body**:

| Field      | Required | Description                                     |
|------------|----------|-------------------------------------------------|
| `source`   | Yes      | Name of the module to clone                     |
| `count`    | Yes      | Number of copies to create                      |
| `template` | No       | Name template with `{n}` placeholder            |
| `validate` | No       | Validate without executing                      |

**Request**:
```json
{
  "source": "Sampler1",
  "count": 4,
  "template": "Sampler {n}"
}
```

**Response**:
```json
{
  "success": true,
  "result": {
    "created": ["Sampler 2", "Sampler 3", "Sampler 4", "Sampler 5"]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/builder/flush

Apply pending UI updates after builder operations.

**JSON Body**: `{}` (empty)

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

### GET /api/dsp/graph

Returns the current node graph as a hierarchical structure.

**Query Parameters**:

| Parameter | Required | Description           |
|-----------|----------|-----------------------|
| `network` | Yes      | DspNetwork module ID  |

**Response**:
```json
{
  "success": true,
  "result": {
    "root": {
      "id": "Main",
      "path": "container.chain",
      "bypassed": false,
      "parameters": {"Value": 1.0},
      "children": [
        {"id": "Osc1", "path": "core.oscillator", "parameters": {"Frequency": 440, "Mode": "Sine"}, "children": []},
        {"id": "Filter1", "path": "filters.svf", "parameters": {"Frequency": 2000, "Q": 0.5}, "children": []}
      ]
    },
    "connections": [
      {"source": "lfo1", "sourceOutput": "Value", "target": "Filter1", "parameter": "Frequency"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/dsp/create_and_add

Add a node to the scriptnode graph.

**JSON Body**:

| Field      | Required | Description                                            |
|------------|----------|--------------------------------------------------------|
| `network`  | Yes      | DspNetwork module ID                                   |
| `path`     | Yes      | Node factory path (e.g., `"core.oscillator"`)          |
| `parent`   | Yes      | Parent container node ID                               |
| `id`       | No       | Custom node ID (auto-generated if omitted)             |
| `validate` | No       | Validate without executing (default: `false`)          |

---

### POST /api/dsp/remove

Remove a node from the graph.

**JSON Body**:

| Field     | Required | Description          |
|-----------|----------|----------------------|
| `network` | Yes      | DspNetwork module ID |
| `id`      | Yes      | Node ID to remove    |

---

### POST /api/dsp/move

Move a node to a different container.

**JSON Body**:

| Field     | Required | Description                    |
|-----------|----------|--------------------------------|
| `network` | Yes      | DspNetwork module ID           |
| `id`      | Yes      | Node ID to move                |
| `parent`  | Yes      | Target container node ID       |
| `index`   | No       | Position within the container  |

---

### POST /api/dsp/connect

Connect a node output to a parameter.

**JSON Body**:

| Field          | Required | Description                    |
|----------------|----------|--------------------------------|
| `network`      | Yes      | DspNetwork module ID           |
| `source`       | Yes      | Source node ID                 |
| `sourceOutput` | No       | Source output name (default: first output) |
| `target`       | Yes      | Target node ID                 |
| `parameter`    | Yes      | Target parameter name          |

---

### POST /api/dsp/disconnect

Disconnect a node from a parameter.

**JSON Body**:

| Field       | Required | Description                    |
|-------------|----------|--------------------------------|
| `network`   | Yes      | DspNetwork module ID           |
| `source`    | Yes      | Source node ID                 |
| `target`    | Yes      | Target node ID                 |
| `parameter` | Yes      | Target parameter name          |

---

### POST /api/dsp/set

Set a property on a node.

**JSON Body**:

| Field      | Required | Description                    |
|------------|----------|--------------------------------|
| `network`  | Yes      | DspNetwork module ID           |
| `node`     | Yes      | Node ID                        |
| `property` | Yes      | Property name                  |
| `value`    | Yes      | New value                      |

---

### POST /api/dsp/bypass

Set the bypass state of a node.

**JSON Body**:

| Field      | Required | Description                    |
|------------|----------|--------------------------------|
| `network`  | Yes      | DspNetwork module ID           |
| `node`     | Yes      | Node ID                        |
| `bypassed` | Yes      | `true` or `false`              |

---

### POST /api/dsp/undo

Undo the last scriptnode operation.

**JSON Body**:

| Field     | Required | Description          |
|-----------|----------|----------------------|
| `network` | Yes      | DspNetwork module ID |

---

### POST /api/dsp/clear

Clear all nodes from the network.

**JSON Body**:

| Field     | Required | Description          |
|-----------|----------|----------------------|
| `network` | Yes      | DspNetwork module ID |

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

---

## Compile

### POST /api/compile/start

Start compiling a plugin target.

**JSON Body**:

| Field    | Required | Description                                      |
|----------|----------|--------------------------------------------------|
| `target` | Yes      | `"vst3"`, `"au"`, `"standalone"`, `"aax"`, `"dll"` |
| `config` | No       | `"debug"` or `"release"` (default: `"debug"`)    |

This is a long-running operation. The response arrives when compilation
completes or fails.

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

## Packages (Asset Manager)

### GET /api/packages/list

List packages.

**Query Parameters**:

| Parameter | Required | Description                                        |
|-----------|----------|----------------------------------------------------|
| `filter`  | No       | `"installed"`, `"available"`, `"outdated"` (default: `"installed"`) |

**Response**:
```json
{
  "success": true,
  "result": {
    "packages": [
      {"name": "synth_building_blocks", "version": "1.2.0", "status": "up_to_date", "source": "store", "vendor": "HISE"},
      {"name": "my_ui_framework", "version": "2.0.1", "status": "update_available", "latestVersion": "2.1.0", "source": "local", "vendor": "Me"}
    ]
  },
  "logs": [],
  "errors": []
}
```

---

### POST /api/packages/install

Install a package.

**JSON Body**:

| Field     | Required | Description                         |
|-----------|----------|-------------------------------------|
| `name`    | Yes      | Package name                        |
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

### POST /api/packages/update

Update a package to the latest version.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Package name   |

---

### POST /api/packages/uninstall

Uninstall a package. Modified files are preserved.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Package name   |

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

### POST /api/packages/cleanup

Force-delete preserved files from a previous uninstall.

**JSON Body**:

| Field  | Required | Description    |
|--------|----------|----------------|
| `name` | Yes      | Package name   |

---

### GET /api/packages/versions

List available versions for a package.

**Query Parameters**:

| Parameter | Required | Description    |
|-----------|----------|----------------|
| `name`    | Yes      | Package name   |

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

### POST /api/packages/add_local

Add a local folder as a package source.

**JSON Body**:

| Field  | Required | Description                      |
|--------|----------|----------------------------------|
| `path` | Yes      | Path to the local HISE project   |

---

### POST /api/packages/remove_local

Remove a local folder package source.

**JSON Body**:

| Field  | Required | Description                      |
|--------|----------|----------------------------------|
| `path` | Yes      | Path to the local HISE project   |

---

### POST /api/packages/test

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
