# MODE_DEVELOPMENT.md — hise-cli mode workflow

This file defines the required workflow for adding or upgrading modes in
`hise-cli`.

The short version:

1. define the response contract first
2. implement mock runtime support for that contract
3. build engine mode logic and tests against the mock contract
4. add live parity tests against a running HISE instance
5. only then consider the mode implementation complete

This is not optional process overhead. The shared mock runtime is a product
feature (`--mock`) and also the canonical contract layer that protects the CLI
from API drift.

## Principles

- **Mock-first**: every supported mode must work coherently in `--mock` mode.
- **Contract-first**: mock payloads define the shape the engine is built
  against.
- **Live parity**: real HISE responses must be checked against the same
  contract before and after mode work.
- **Thin frontends**: TUI and CLI reuse the same engine/session path. Mock vs
  live behavior belongs in the runtime/bootstrap layer, not in the mode logic.
- **Formatter parity matters**: compare rendered `CommandResult` output, not
  just raw endpoint fields.

## Runtime Layers

Keep these concerns separate:

- `MockHiseConnection`: programmable transport primitive for low-level tests
- `src/mock/runtime.ts`: shared mock runtime profile used by `repl --mock` and
  CLI `--mock`
- `src/mock/contracts/`: response normalizers / validators for canonical shapes
- `src/live-contract/`: parity tests that require a real HISE instance

Modes should not embed ad hoc dummy runtime data. If a mode needs fake runtime
data, it belongs in the shared mock runtime.

## Required workflow for new modes

### 1. Read the endpoint spec

Start from the endpoint contract in the HISE API docs / roadmap material.

Identify:

- happy-path request / response
- required fields
- optional fields
- known error response shapes
- fields that affect formatting / UX

### 2. Probe the live endpoint early

Before implementing the mode, query the live HISE endpoint with a few
representative inputs.

The goal is not heavy fuzzing. The goal is to sample the real response shape
and capture reality early.

At minimum collect:

- one valid happy-path response
- one minimal response if applicable
- one representative error response

Normalize the results into a stable contract. Do not copy volatile values
directly into assertions if they are not semantically important.

### 3. Define the contract module

Add a normalizer / validator in `src/mock/contracts/`.

The contract module should:

- validate required fields and types
- normalize the payload into a canonical shape
- throw explicit errors for invalid responses

Use this contract for both mock payload validation and live parity tests.

### 4. Add mock runtime support

Extend `src/mock/runtime.ts` so the new mode works in `--mock` mode.

Rules:

- mock behavior must be coherent enough for users to explore the mode
- mock responses should match the canonical contract shape
- do not add mode-local mock branches when the runtime layer can own them

For script mode, this is intentionally limited: emulate response envelopes and
representative outcomes, not a full scripting engine.

### 5. Build engine logic against the mock contract

Implement mode parsing / formatting against the normalized contract output, not
against guessed raw response blobs.

Regular tests (`npm test`) should use mock runtime or direct contract-valid mock
payloads only.

### 6. Add live parity tests

Add a live-only test in `src/live-contract/`.

These tests:

- require a running HISE instance
- are excluded from default `npm test`
- are run through `vitest.live.config.ts`

Each live parity test should verify both:

- **shape parity**: live response can be normalized by the contract module
- **formatter parity**: live response and mock response produce equivalent
  `CommandResult` structure after normalization / sanitization

Use targeted sanitization for volatile values like paths, versions, or numeric
measurements where exact equality is not the contract.

### 7. Mark completion only after both gates pass

A mode is not complete until:

- mock contract tests pass
- regular engine tests pass
- live parity tests pass

## Testing structure

### Regular tests

Run in default `npm test`.

Use for:

- parser behavior
- formatter behavior
- mode dispatch
- CLI/TUI integration through mock runtime
- contract validation of mock payloads

### Live contract tests

Run manually against HISE:

- `npm run test:live-contract`
- `npm run test:live-contract:<mode>`

Use for:

- checking live endpoint shape against the contract
- checking formatter parity against mock responses

These tests should be run:

- before implementing a new live-backed mode
- after implementing it
- before merging substantial changes to that mode

## Current examples

The current reference implementations are:

- `src/mock/contracts/status.ts`
- `src/mock/contracts/repl.ts`
- `src/live-contract/inspect.live.test.ts`
- `src/live-contract/script.live.test.ts`

These are the template for future mode work.

## Phase 4 builder workflow

Builder is the first mode expected to fully use this workflow end-to-end.

Expected sequence:

1. probe real builder endpoints from HISE
2. capture representative live responses
3. define builder contract normalizers in `src/mock/contracts/`
4. add builder mock runtime responses
5. implement engine builder behavior against those mock contracts
6. add live parity tests for the builder endpoints

The old builder dummy tree was removed from normal runtime behavior on purpose.
Builder mock data now belongs only to the mock runtime profile.

## Rules of thumb

- Prefer normalizers over loose object poking.
- Prefer shared runtime helpers over one-off mocks in feature code.
- Prefer comparing formatted output snapshots after sanitization over raw JSON
  equality when values are naturally variable.
- If live HISE does not expose a field yet, do not pretend it exists in the
  live contract. Keep the mode honest and grow it when the endpoint grows.

## Definition of done for a mode

A mode is done when:

- it works in `--mock`
- it works against live HISE
- its response contract is explicitly normalized / validated
- its live parity tests pass
- its TUI and CLI behavior both run through the same engine path
