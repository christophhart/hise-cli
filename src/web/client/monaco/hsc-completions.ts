// ── Monaco autocomplete: hise-hsc ───────────────────────────────────
//
// Sends the full document + cursor over WS; server reconstructs mode at
// cursor and delegates to the existing CompletionEngine.

import type * as MonacoNS from "monaco-editor";
import { request } from "../ws-client.js";
import type { ServerMsg } from "../../protocol.js";

let counter = 0;
const newId = () => `mc-${++counter}`;

export function registerHscCompletions(monaco: typeof MonacoNS): void {
	const provider: MonacoNS.languages.CompletionItemProvider = {
		triggerCharacters: [" ", "/", ".", "-"],
		async provideCompletionItems(model, position) {
			const document = model.getValue();
			let response: ServerMsg;
			try {
				response = (await request({
					kind: "complete-document",
					id: newId(),
					path: model.uri.toString(),
					document,
					line: position.lineNumber,
					column: position.column,
				})) as ServerMsg;
			} catch {
				return { suggestions: [] };
			}
			if (response.kind !== "completion" || !response.payload) {
				return { suggestions: [] };
			}

			// CompletionEngine returns 0-indexed character offsets within
			// the current line. Monaco columns are 1-indexed. Using these
			// (instead of Monaco's word range) lets the engine include
			// non-word characters like the leading `/` in the replacement,
			// avoiding `//builder`-style double-prefix bugs.
			const range: MonacoNS.IRange = {
				startLineNumber: position.lineNumber,
				endLineNumber: position.lineNumber,
				startColumn: response.payload.from + 1,
				endColumn: response.payload.to + 1,
			};

			const suggestions: MonacoNS.languages.CompletionItem[] = response.payload.items.map(
				(item) => ({
					label: item.label,
					kind: monaco.languages.CompletionItemKind.Function,
					insertText: item.insertText ?? item.label,
					detail: item.detail,
					range,
				}),
			);

			return { suggestions };
		},
	};
	monaco.languages.registerCompletionItemProvider("hise-hsc", provider);
	monaco.languages.registerCompletionItemProvider("hise-repl", provider);
}
