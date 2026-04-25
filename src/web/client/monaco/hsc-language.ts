// ── Monaco languages: hise-hsc (file editor) + hise-repl (REPL) ─────
//
// Both share a mode-stack carrying TokensProvider. They differ only in
// the initial state:
//   - hise-hsc starts at ["root"] (matches a fresh .hsc file)
//   - hise-repl starts at the live session mode stack (set externally
//     via setReplModeStack on every mode change)

import type * as MonacoNS from "monaco-editor";
import { buildModeMap, tokenizerForLine } from "../../../engine/run/mode-map.js";
import type { TokenType } from "../../../engine/highlight/index.js";
import type { ModeId } from "../../../engine/modes/mode.js";

interface HscLineState {
	modeStack: string[];
}

class HscState implements HscLineState {
	constructor(public modeStack: string[]) {}
	clone(): HscState {
		return new HscState([...this.modeStack]);
	}
	equals(o: HscLineState | null): boolean {
		if (!o) return false;
		return (
			this.modeStack.length === o.modeStack.length &&
			this.modeStack.every((m, i) => m === o.modeStack[i])
		);
	}
}

// ── Mutable mode-stack for REPL initial state ──────────────────────
let replInitialStack: string[] = ["root"];

export function setReplModeStack(stack: string[]): void {
	replInitialStack = [...stack];
}

// ── Shared tokenization core ───────────────────────────────────────
function tokenizeLine(
	line: string,
	state: MonacoNS.languages.IState,
): MonacoNS.languages.ILineTokens {
	const carried = (state as unknown as HscLineState).modeStack;
	const stack = [...carried];

	const [entry] = buildModeMap([line]);
	if (!entry) {
		return {
			tokens: [{ startIndex: 0, scopes: "plain" }],
			endState: new HscState(stack) as unknown as MonacoNS.languages.IState,
		};
	}

	const current = (stack[stack.length - 1] ?? "root") as ModeId;
	const effectiveEntry = { ...entry, modeId: current };
	const tokenizer = tokenizerForLine(effectiveEntry, line);
	const spans = tokenizer
		? tokenizer(line)
		: [{ text: line, token: "plain" as TokenType }];

	const tokens: MonacoNS.languages.IToken[] = [];
	let pos = 0;
	for (const span of spans) {
		tokens.push({ startIndex: pos, scopes: span.token });
		pos += span.text.length;
	}

	if (entry.isModeEntry && !entry.isOneShot) stack.push(entry.modeId);
	if (entry.isModeExit && stack.length > 1) stack.pop();

	return {
		tokens,
		endState: new HscState(stack) as unknown as MonacoNS.languages.IState,
	};
}

function makeProvider(getInitial: () => string[]): MonacoNS.languages.TokensProvider {
	return {
		getInitialState: () =>
			new HscState(getInitial()) as unknown as MonacoNS.languages.IState,
		tokenize: tokenizeLine,
	};
}

export function registerHscLanguage(monaco: typeof MonacoNS): void {
	monaco.languages.register({ id: "hise-hsc" });
	monaco.languages.setTokensProvider(
		"hise-hsc",
		makeProvider(() => ["root"]),
	);

	monaco.languages.register({ id: "hise-repl" });
	monaco.languages.setTokensProvider(
		"hise-repl",
		makeProvider(() => replInitialStack),
	);
}
