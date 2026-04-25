// ── REPL input — single-line Monaco editor ──────────────────────────
//
// Reuses the `hise-hsc` language for live mode-aware syntax highlighting
// and the `CompletionItemProvider` for autocomplete (Ctrl+Space or
// trigger characters). Enter submits.

import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../state/store.js";
import { submitInput } from "../ws-client.js";
import type { ServerMsg } from "../../protocol.js";
import type * as MonacoNS from "monaco-editor";
import { loadMonaco as loadMonacoBase } from "../monaco/bootstrap.js";
import { setReplModeStack } from "../monaco/hsc-language.js";

let monacoReadyPromise: Promise<typeof MonacoNS> | null = null;

function loadMonaco(): Promise<typeof MonacoNS> {
	if (monacoReadyPromise) return monacoReadyPromise;
	monacoReadyPromise = (async () => {
		const monaco = await loadMonacoBase();
		const { registerHscLanguage } = await import("../monaco/hsc-language.js");
		const { registerHscCompletions } = await import("../monaco/hsc-completions.js");
		const { defineHiseDarkTheme } = await import("../monaco/hise-theme.js");
		registerHscLanguage(monaco);
		registerHscCompletions(monaco);
		defineHiseDarkTheme(monaco);
		return monaco;
	})();
	return monacoReadyPromise;
}

export function Input() {
	const sessionState = useStore((s) => s.sessionState);
	const value = useStore((s) => s.currentInput);
	const setCurrentInput = useStore((s) => s.setCurrentInput);
	const pushUserCommand = useStore((s) => s.pushUserCommand);

	const [busy, setBusy] = useState(false);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
	const valueRef = useRef(value);

	useEffect(() => {
		valueRef.current = value;
	}, [value]);

	const pushHistory = useStore((s) => s.pushHistory);

	const submit = useCallback(
		async (line: string) => {
			if (!line.trim()) return;
			// Capture the active mode BEFORE awaiting — by the time the
			// response resolves, session-state may already reflect a mode
			// transition triggered by this command (e.g. /script).
			const stack = useStore.getState().sessionState.modeStack;
			const modeId = stack[stack.length - 1] ?? "root";
			pushHistory(line);
			setBusy(true);
			try {
				const response = (await submitInput(line)) as ServerMsg;
				if (response.kind === "result") {
					pushUserCommand(line, response.result, modeId);
				} else if (response.kind === "error") {
					pushUserCommand(line, {
						type: "error",
						message: response.message,
						detail: response.detail,
					}, modeId);
				} else {
					pushUserCommand(line, {
						type: "error",
						message: `Unexpected response: ${response.kind}`,
					}, modeId);
				}
				setCurrentInput("");
				editorRef.current?.setValue("");
			} catch (err) {
				pushUserCommand(line, {
					type: "error",
					message: "Submit failed",
					detail: String(err),
				}, modeId);
			} finally {
				setBusy(false);
			}
		},
		[pushHistory, pushUserCommand, setCurrentInput],
	);

	const submitRef = useRef(submit);
	useEffect(() => {
		submitRef.current = submit;
	}, [submit]);

	useEffect(() => {
		if (!containerRef.current) return;
		let disposed = false;
		let cleanup: (() => void) | null = null;

		void loadMonaco().then((monaco) => {
			if (disposed || !containerRef.current) return;
			// Seed REPL initial mode-stack from the live session before
			// the editor starts tokenizing.
			setReplModeStack(useStore.getState().sessionState.modeStack);
			const inst = monaco.editor.create(containerRef.current, {
				value: valueRef.current,
				language: "hise-repl",
				theme: "hise-dark",
				automaticLayout: true,
				lineNumbers: "off",
				glyphMargin: false,
				folding: false,
				lineDecorationsWidth: 0,
				lineNumbersMinChars: 0,
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				renderLineHighlight: "none",
				wordWrap: "off",
				overviewRulerLanes: 0,
				overviewRulerBorder: false,
				hideCursorInOverviewRuler: true,
				scrollbar: {
					vertical: "hidden",
					horizontal: "hidden",
					handleMouseWheel: false,
					alwaysConsumeMouseWheel: false,
					useShadows: false,
				},
				fontSize: 14,
				fontFamily:
					'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
				contextmenu: false,
				links: false,
				renderValidationDecorations: "off",
				occurrencesHighlight: "off",
				selectionHighlight: false,
				renderWhitespace: "none",
				roundedSelection: false,
				padding: { top: 4, bottom: 4 },
			});
			editorRef.current = inst;

			inst.focus();

			const contentSub = inst.onDidChangeModelContent(() => {
				const v = inst.getValue();
				// Strip newlines — single-line input.
				if (v.includes("\n")) {
					inst.setValue(v.replace(/\n/g, ""));
					return;
				}
				setCurrentInput(v);
			});

			// All editor commands below are scoped to the REPL language so
			// they don't fire on the file-editor pane (which uses
			// `hise-hsc`). Monaco's keybinding service is global; the
			// context expression gates execution per-editor.
			const replOnly = "editorLangId == 'hise-repl'";

			// Enter: submit (and override the default new-line insert)
			inst.addCommand(
				monaco.KeyCode.Enter,
				() => {
					const line = inst.getValue();
					void submitRef.current(line);
				},
				replOnly,
			);

			// Shift+Enter: ignore (no multiline for now)
			inst.addCommand(
				monaco.KeyMod.Shift | monaco.KeyCode.Enter,
				() => {
					/* no-op */
				},
				replOnly,
			);

			// Up/Down: history navigation when the suggest popup is closed.
			const setEditorTo = (line: string) => {
				inst.setValue(line);
				const lineNum = 1;
				const col = line.length + 1;
				inst.setPosition({ lineNumber: lineNum, column: col });
			};
			inst.addCommand(
				monaco.KeyCode.UpArrow,
				() => {
					const next = useStore.getState().historyUp(inst.getValue());
					if (next !== null) setEditorTo(next);
				},
				`${replOnly} && !suggestWidgetVisible`,
			);
			inst.addCommand(
				monaco.KeyCode.DownArrow,
				() => {
					const next = useStore.getState().historyDown();
					if (next !== null) setEditorTo(next);
				},
				`${replOnly} && !suggestWidgetVisible`,
			);

			cleanup = () => {
				contentSub.dispose();
				inst.dispose();
			};
		});

		return () => {
			disposed = true;
			cleanup?.();
			editorRef.current = null;
		};
	}, [setCurrentInput]);

	// Disable editing while a command is in-flight.
	useEffect(() => {
		const inst = editorRef.current;
		if (!inst) return;
		inst.updateOptions({ readOnly: busy });
	}, [busy]);

	// Push session mode changes into the REPL tokenizer + force retokenize.
	const modeStackKey = sessionState.modeStack.join(">");
	useEffect(() => {
		setReplModeStack(sessionState.modeStack);
		const inst = editorRef.current;
		if (!inst) return;
		const model = inst.getModel();
		if (!model) return;
		void loadMonaco().then((monaco) => {
			// Toggle language to retrigger getInitialState().
			monaco.editor.setModelLanguage(model, "plaintext");
			monaco.editor.setModelLanguage(model, "hise-repl");
		});
	}, [modeStackKey, sessionState.modeStack]);

	return (
		<div className="input-row">
			<span className={`prompt mode-${sessionState.modeStack[sessionState.modeStack.length - 1]}`}>
				{sessionState.prompt}
			</span>
			<div ref={containerRef} className="input-monaco" />
		</div>
	);
}
