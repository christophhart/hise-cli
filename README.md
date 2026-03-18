# @hise/cli

Official command-line interface for [HISE](https://hise.dev) — a modal REPL
and automation tool for building audio plugins.

## What it does

**Interactive REPL** — connect to a running HISE instance and work in
domain-specific modes (builder, script, DSP, sampler, inspect, project,
compile, import). Each mode has its own grammar, tab completion, and
contextual help powered by shipped static datasets.

**Smart client** — validates commands locally using shipped JSON datasets
(`data/moduleList.json`, `data/scriptnodeList.json`, `data/scripting_api.json`)
before sending them to HISE. Catches typos, invalid parameters, and wrong
chain placements instantly without a round-trip.

**Dual frontend** — humans use the TUI (Ink/React terminal UI with colors,
tab completion, progress bars). LLMs and automation use the CLI (structured
JSON output).

## Install

```bash
npm i -g @hise/cli
hise-cli
```

Or run without installing:

```bash
npx @hise/cli
```

## Usage

```bash
# Launch REPL
hise-cli
```

## Architecture

Three-layer design sharing one engine:

```
src/engine/    Shared core — zero UI deps, zero node: imports (isomorphic)
src/tui/       TUI frontend — Ink/React terminal
src/cli/       CLI frontend — structured JSON output
```

The engine layer is isomorphic (runs in Node.js and browsers) to enable
a future web frontend.

## Requirements

- Node.js 18+
- Internet connection for commands that depend on remote APIs

## Documentation

- [DESIGN.md](DESIGN.md) — full architecture specification
- [ROADMAP.md](ROADMAP.md) — implementation plan with phase gates
- [docs/TUI_STYLE.md](docs/TUI_STYLE.md) — visual design system
- [docs/CODE_STYLE.md](docs/CODE_STYLE.md) — code conventions

## License

MIT
