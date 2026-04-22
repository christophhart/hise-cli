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

## HiseScript diagnostics in Claude Code

hise-cli can act as a lightweight LSP replacement — run `hise-cli diagnose`
as a post-edit hook so Claude Code sees script errors after every file change.

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

## Syntax highlighter export

The tokenizers in `src/engine/highlight/` double as the syntax
highlighter for the HISE docs website. They are fully self-contained
(zero imports outside the directory) and are mirrored verbatim into
`highlight-export/` for consumption by external projects (Nuxt.js
docs site, etc.).

### Sync command

After any change in `src/engine/highlight/`, regenerate the export:

```bash
just export-highlight
# or: npm run export-highlight
```

Copies all non-test `.ts` files from `src/engine/highlight/` into
`highlight-export/` (excluding `split.ts`, which is terminal-only).
No patches — source of truth is the CLI.

### Adding to the highlighter

- **New HiseScript scoped statement** — add to `SCOPED_STATEMENTS` in
  `src/engine/highlight/hisescript.ts`
- **New CLI mode** — add id to `SLASH_MODE_IDS` and color to
  `MODE_ACCENTS` in `src/engine/highlight/constants.ts`; extend
  `TokenType` union + `TOKEN_COLORS` in `src/engine/highlight/tokens.ts`
- **New tokenizer file** — add source file, wire into
  `src/engine/highlight/index.ts` (`HiseLanguage` union + `TOKENIZERS`
  map)
- **New keyword in a mode DSL** — add to the matching `_KEYWORDS` set
  in the tokenizer file (`builder.ts`, `dsp.ts`, `ui.ts`, etc.)

After any of the above, run `just export-highlight` and commit both
the source change and the regenerated export side-by-side.

See [highlight-export/README.md](highlight-export/README.md) for
consumer-side integration (Nuxt ProsePre.vue override, fence table).

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
