# hise-cli

[![Latest release](https://img.shields.io/github/v/release/christophhart/hise-cli?label=latest&sort=semver)](https://github.com/christophhart/hise-cli/releases/latest)
[![Release build](https://img.shields.io/github/actions/workflow/status/christophhart/hise-cli/release.yml?branch=master&label=build)](https://github.com/christophhart/hise-cli/actions/workflows/release.yml)

Official command-line interface for [HISE](https://hise.dev) — a modal REPL
and automation tool for building audio plugins.

## What it does

`hise-cli` connects to a running HISE instance and gives you a fast, modal
shell for editing modules, UI, scriptnode graphs, and HiseScript without
leaving the terminal. Guided wizards cover the longer chores (HISE setup,
plugin export, network compilation, audio rendering, installer packaging),
and every command also runs one-shot from your shell with structured JSON
output — so the same tool drives interactive workflows, CI pipelines, and
LLM agents.

## Install

### Standalone binary (no Node.js required)

**macOS** (universal, Apple Silicon + Intel — signed + notarized):

```bash
curl -fsSL -o /tmp/hise-cli.pkg https://github.com/christophhart/hise-cli/releases/latest/download/hise-cli.pkg \
  && sudo installer -pkg /tmp/hise-cli.pkg -target /
```

Installs to `/usr/local/bin/hise-cli` (already on `PATH`).

**Windows** (PowerShell, x64):

```powershell
irm https://github.com/christophhart/hise-cli/releases/latest/download/hise-cli-setup.exe -OutFile $env:TEMP\hise-cli-setup.exe
& $env:TEMP\hise-cli-setup.exe /VERYSILENT /NORESTART
```

Per-user install (no UAC). Adds `hise-cli` to your `PATH`. Open a new shell
after install so the updated `PATH` is picked up.

**Linux** (x64):

```bash
curl -fsSL https://github.com/christophhart/hise-cli/releases/latest/download/install.sh | sh
hise-cli
```

Installs to `~/.local/bin/hise-cli` and verifies the release checksum. Override
the destination with `HISE_CLI_INSTALL_DIR`. Node.js users can alternatively
run `npm i -g @hise/cli` or use `npx @hise/cli` without installing.

The automated `/setup` flow supports Debian, Ubuntu, and compatible systems
with `apt-get` on x64. Other distributions can use hise-cli, but their HISE
build dependencies must currently be installed manually. Linux ARM64 is not
currently supported by the HISE build setup.

Run `/setup` as your normal user. On Linux, the wizard requests administrator
authorization only while installing missing apt packages; the HISE checkout
and build remain owned by your user account.

## Get HISE building on your machine — `/setup`

If you've never compiled HISE from source, this is your starting line.
The `/setup` wizard is a fully automated replacement for the manual
toolchain setup that has historically blocked new HISE developers — it
detects what your system already has, installs only what's missing, then
clones, configures, and builds HISE end-to-end.

```bash
hise-cli              # then
> /setup
```

What the wizard takes care of for you:

- Platform compiler toolchain (Xcode CLT on macOS, Visual Studio Build
  Tools on Windows, gcc/clang + dev headers on Linux)
- Optional tools: IPP (Windows), Faust
- FFTW development libraries on Linux (enabled by default for projects using
  `AUDIOFFT_FFTW3=1`; review FFTW licensing before distribution)
- HISE source clone, SDK archive extraction, and initialization of its JUCE submodule (including the submodule's Projucer)
- First full build, verification of the resulting binary and compiler settings, then export and compilation of the bundled demo project as a standalone application

By default, `/setup` selects the latest CI-green `develop` commit. To use a particular revision, enter its Git SHA in the wizard's **Target Commit** field. If the CI lookup fails, setup stops; you can enter `HEAD` to bypass the check and use the latest `develop` commit, which [may not have passed CI](https://github.com/christophhart/HISE/actions/workflows/ci_mac.yml). If setup pauses to install macOS Command Line Tools, complete the system dialog and enter `/resume`. Other interrupted steps can be retried without redoing every completed task. Later, `/update` also selects the latest CI-green `develop` commit by default and rebuilds HISE.

## Quickstart

```bash
hise-cli                              # launch the interactive REPL
```

Inside the REPL:

```
/help                                 # list every mode and wizard
/setup                                # build HISE from source (see above)
/builder                              # enter a mode
/wizard plugin_export                 # run a guided workflow
```

Run any mode command one-shot from your shell (JSON output by default,
`--pretty` for terminal-friendly text):

```bash
hise-cli -builder "show tree"
hise-cli -script "Engine.getSampleRate()"
hise-cli -wizard run plugin_export --answers '{"projectType":"Instrument"}'
```

Connects to HISE at `http://127.0.0.1:1900` (REST API must be enabled in
HISE settings). Add `--mock` to test without a running HISE.

## Feature catalog

### REPL modes

Each mode has its own grammar, tab completion, and `/help` text. Enter with
`/<mode>` (TUI) or run one-shot with `hise-cli <mode> "<command>"` (the legacy `-<mode>` form also works).

| Mode        | What you do |
|-------------|-------------|
| `/builder`  | Add, remove, move, clone modules in the signal chain; set parameters |
| `/ui`       | Add, configure, reparent UI components (sliders, buttons, panels, …) |
| `/dsp`      | Edit Scriptnode graphs — add nodes, connect modulation, set parameters |
| `/script`   | Live HiseScript REPL with API completion and console capture |
| `/project`  | Project lifecycle — list, switch, save/load, settings, preprocessor defines |
| `/sequence` | Compose and play timed MIDI sequences for synth testing |
| `/inspect`  | Runtime monitor — HISE version, current project, processors |
| `/assets`   | Install, manage, and publish HISE asset packages (store + local sources) |
| `/undo`     | Undo/redo navigation, plan groups for atomic multi-step edits |
| `/hise`     | Control the HISE process — launch, shutdown, screenshot, profile, playground |
| `/publish`  | Build and sign installer packages from compiled binaries |
| `/export`   | Export targets and build artifacts |

### Wizards

Multi-step guided workflows. Same definition serves the TUI (inline form)
and the CLI (`hise-cli -wizard run <id> --answers '{…}'`).

| Wizard                  | What it does |
|-------------------------|-------------|
| `setup`                 | **Featured above** — fully automated HISE-from-source bootstrap (toolchain + Projucer + clone + build) |
| `update`                | Pull latest CI-green develop commit and rebuild HISE |
| `new_project`           | Create a HISE project from template (empty / HXI import / Rhapsody) |
| `plugin_export`         | Compile project as VST3 / AU / AAX plugin or standalone |
| `compile_networks`      | Compile Scriptnode networks to a C++ DLL |
| `recompile`             | F5-style recompile with optional cache clearing |
| `audio_export`          | Render audio output to WAV (realtime or offline) |
| `install_package_maker` | Author an installable asset package from the current project |
| `build_installer`       | Sign and package binaries into platform installers |

### Automation & integrations

- **Structured JSON output** — every one-shot command emits
  `{ ok, result, logs, errors }`. Exit code `0` on success, `1` on error.
  Designed for CI pipelines and LLM agents.
- **`.hsc` test scripts** — write multi-step scenarios with `/builder`,
  `/script`, and `/expect` assertions. Run with
  `hise-cli --run script.hsc [--mock] [--dry-run] [--verbosity=…]`.
- **`--mock` mode** — exercise commands and tests without a running HISE
  instance.
- **`hise-cli update`** — self-update to the latest signed/notarized
  GitHub release.
- **HiseScript diagnostics** — `hise-cli diagnose <file.js>` runs the
  shadow parser and emits errors as JSON or pretty text. Plugs into
  Claude Code as a post-edit hook (see below).

## Debug HiseScript in a DAP editor

`hise-cli --dap` is a [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/)
server over **stdio**. It attaches to an already-running HISE project; it does
not launch HISE, compile scripts, or stop HISE when you disconnect. Enable the
HISE REST API first (default `http://localhost:1900`).

In an editor that supports custom DAP adapters:

1. Register `hise-cli` as the adapter executable with `--dap` as its argument.
   Use `node /absolute/path/to/hise-cli/dist/index.js --dap` when running a
   local source build instead of an installed executable. Choose **stdio**, not
   TCP, and keep adapter stdout reserved for protocol messages.
2. Create an **attach** debug configuration (not launch). Set `moduleId` to
   the HISE script processor you want to debug. Optionally set `projectFolder`
   to your workspace's absolute project path to reject mismatched projects.
3. Open a script file HISE recognizes as that processor's merged callback file
   or a watched include, set a source breakpoint, and start debugging. The
   editor sends breakpoints after attach; HISE will stop at them when your
   script runs. Attaching does not trigger a script or recompile it.

The following shows the *values* to provide; each editor uses its own names
and layout for adapter registration versus attach configuration:

```json
{
  "adapterCommand": "hise-cli",
  "adapterArgs": ["--dap"],
  "request": "attach",
  "moduleId": "Interface",
  "projectFolder": "/absolute/path/to/HISE-project"
}
```

`moduleId` is optional if you supply a `sourceUri` (a `file://` URI) or want
HISE to select a processor from the first `setBreakpoints` source. Specify it
when a file may be watched by multiple processors. To use another REST address,
add `--hise-url http://host:port` to the adapter arguments. The optional
`--project-root` argument checks the workspace during DAP initialization
instead of attach. Run `hise-cli --dap --help` for the remaining adapter options.

Breakpoints, conditional breakpoints, stepping, stack navigation, and hover or
Debug Console evaluation are supported for one processor at a time. Variable
scopes and expandable values are **not yet available** in HISE's DAP REST
bridge. If your editor does not allow registering an arbitrary DAP executable
(for example, VS Code requires a debug-adapter extension), a debug adapter
registration or small editor extension is needed; a `launch.json` entry by
itself cannot register a new adapter type. The LSP and DAP modes are separate
processes and must not share a stdio stream.

## HiseScript diagnostics in Claude Code

`hise-cli diagnose` doubles as a lightweight LSP — wire it into Claude Code
so script errors surface after every file edit.

**1. Create `~/.claude/hise-lsp.sh`:**

```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
if [[ "$FILE" == */Scripts/*.js ]]; then
  DIAG=$(hise-cli diagnose "$FILE" --format=pretty --errors-only 2>&1)
  if [ -n "$DIAG" ]; then
    echo "" >&2
    echo "$DIAG" >&2
    exit 2
  fi
fi
```

**2. Add to `~/.claude/settings.json`:**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "bash ~/.claude/hise-lsp.sh"
          }
        ]
      }
    ]
  }
}
```

HISE must be running with the project open. Scripts must be included in a
ScriptProcessor and compiled at least once for diagnostics to work.

## Requirements

- Node.js 18+ (only for the `npm` install path; the standalone binary has none)
- A running HISE instance with the REST API enabled (default port `1900`) for commands that interact with HISE; installation, `/setup`, and offline commands do not require an already running instance.

## License

MIT
