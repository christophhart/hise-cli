// ── Ink shim — runtime renderer dispatch ────────────────────────────
//
// Detects terminal capabilities at startup and re-exports from either
// @rezi-ui/ink-compat (truecolor terminals) or stock ink (256-color
// terminals like macOS Terminal.app).
//
// All TUI components import from this module instead of "ink" directly.
// Both packages are externalized in the build; no esbuild alias needed.

// Types always come from stock Ink (tsc can resolve "ink" normally).
// The esbuild alias (ink → rezi) only affects the bundle, not tsc.
import type * as InkTypes from "ink";

// "ink-stock" is an esbuild alias pointing to the real "ink" package,
// bypassing the "ink" → "@rezi-ui/ink-compat" alias that third-party
// packages (e.g. ScrollBar) need.
// @ts-ignore — virtual alias, resolved by esbuild and vitest
import * as stockInk from "ink-stock";
import * as reziInk from "@rezi-ui/ink-compat";

function shouldUseRezi(): boolean {
	// Test environment — always use stock Ink (ink-testing-library expects it)
	if (process.env.VITEST || process.env.NODE_ENV === "test") return false;

	// Explicit opt-in/out via env var
	if (process.env.HISE_RENDERER === "ink") return false;
	if (process.env.HISE_RENDERER === "rezi") return true;

	// macOS Terminal.app — no truecolor, Rezi's FORCED_TRUECOLOR breaks it
	if (process.env.TERM_PROGRAM === "Apple_Terminal") return false;

	// Generic truecolor check
	const ct = process.env.COLORTERM ?? "";
	if (ct === "truecolor" || ct === "24bit") return true;

	// Default: prefer Rezi for modern terminals
	return true;
}

/** True when Rezi is the active renderer. */
export const isRezi = shouldUseRezi();

const active = isRezi ? reziInk : stockInk;

// Re-export with explicit types from stock Ink
export const render: typeof InkTypes.render = active.render as typeof InkTypes.render;
export const Box: typeof InkTypes.Box = active.Box as typeof InkTypes.Box;
export const Text: typeof InkTypes.Text = active.Text as typeof InkTypes.Text;
export const useApp: typeof InkTypes.useApp = active.useApp as typeof InkTypes.useApp;
export const useInput: typeof InkTypes.useInput = active.useInput as typeof InkTypes.useInput;
export const useStdout: typeof InkTypes.useStdout = active.useStdout as typeof InkTypes.useStdout;

// Type re-exports
export type { DOMElement } from "ink";
