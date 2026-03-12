# @hise/cli

Official command-line interface for HISE setup and REPL workflows.

`@hise/cli` lets you:
- connect to a running HISE REPL server
- launch guided setup/update/migrate/nuke flows in a terminal UI
- run without global install via `npx`

## Install

### Global install

```bash
npm i -g @hise/cli
hise-cli
```

### Run without installing

```bash
npx @hise/cli
```

## Usage

### Main menu

```bash
hise-cli
```

### Direct commands

```bash
hise-cli repl
hise-cli setup
hise-cli update
hise-cli migrate
hise-cli nuke
```

### REPL discovery flags

```bash
hise-cli --list
hise-cli repl --list
hise-cli repl --pipe hise_repl_1900
```

## Windows REPL convenience

If no running HISE instance is found, the CLI can launch `HISE Debug.exe start_server` (when available on `PATH`) and then connect automatically.

## Setup flow

The setup flow:
- detects your local environment
- checks required dependencies
- fetches latest passing HISE CI commit metadata
- runs platform-specific setup phases
- writes full phase logs to a temp log file for troubleshooting

## Troubleshooting

- If setup fails, check the printed log file path at the end of the run.
- On Windows, ensure Visual Studio C++ toolsets are installed for your selected exporter.
- If `hise-cli repl` cannot connect, verify HISE REPL server is enabled and running.

## Requirements

- Node.js 18+ (recommended)
- Internet connection for setup metadata fetches (GitHub APIs)

## License

MIT
