// ── EditorPane — on-demand Monaco editor for .hsc files ─────────────

import { useEffect, useRef } from "react";
import { useStore } from "../state/store.js";
import { request } from "../ws-client.js";
import type { ServerMsg } from "../../protocol.js";
import type * as MonacoNS from "monaco-editor";
import { loadMonaco as loadMonacoBase } from "../monaco/bootstrap.js";
import { buildModeMap } from "../../../engine/run/mode-map.js";

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

export function EditorPane() {
	const editor = useStore((s) => s.editor);
	const setEditorState = useStore((s) => s.setEditorState);
	const pushUserCommand = useStore((s) => s.pushUserCommand);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<import("monaco-editor").editor.IStandaloneCodeEditor | null>(null);
	const editorContentRef = useRef<string>(editor.content);

	useEffect(() => {
		editorContentRef.current = editor.content;
	}, [editor.content]);

	// Mount monaco once when pane becomes visible
	useEffect(() => {
		if (!editor.visible || !containerRef.current) return;
		let disposed = false;
		let modelDispose: (() => void) | null = null;
		void loadMonaco().then((monaco) => {
			if (disposed || !containerRef.current) return;
			const model = monaco.editor.createModel(editor.content, "hise-hsc");
			const inst = monaco.editor.create(containerRef.current, {
				model,
				theme: "hise-dark",
				automaticLayout: true,
				fontSize: 14,
				fontFamily:
					'ui-monospace, SFMono-Regular, Menlo, "JetBrains Mono", monospace',
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				wordWrap: "on",
				scrollbar: { useShadows: false },
				overviewRulerBorder: false,
				overviewRulerLanes: 0,
				renderLineHighlight: "all",
				lineDecorationsWidth: 0,
				glyphMargin: true,
			});
			editorRef.current = inst;
			modelDispose = () => {
				inst.dispose();
				model.dispose();
			};

			// Per-line mode color strip — mirrors the TUI's gutter strip.
			let decorationIds: string[] = [];
			const updateModeStrips = () => {
				const lines = model.getLinesContent();
				const map = buildModeMap(lines);
				const decorations: MonacoNS.editor.IModelDeltaDecoration[] = map.map(
					(entry, i) => ({
						range: new monaco.Range(i + 1, 1, i + 1, 1),
						options: {
							isWholeLine: true,
							glyphMarginClassName: `mode-strip mode-strip-${entry.modeId}`,
						},
					}),
				);
				decorationIds = inst.deltaDecorations(decorationIds, decorations);
			};
			updateModeStrips();

			inst.onDidChangeModelContent(() => {
				const current = inst.getValue();
				editorContentRef.current = current;
				updateModeStrips();
			});

			const editorOnly = "editorLangId == 'hise-hsc'";
			// F5: save + run
			inst.addCommand(
				monaco.KeyCode.F5,
				() => {
					const path = useStore.getState().editor.path;
					if (!path) return;
					void runScript(path, editorContentRef.current, false, pushUserCommand);
				},
				editorOnly,
			);
			// F7: save + dry-run
			inst.addCommand(
				monaco.KeyCode.F7,
				() => {
					const path = useStore.getState().editor.path;
					if (!path) return;
					void runScript(path, editorContentRef.current, true, pushUserCommand);
				},
				editorOnly,
			);
		});
		return () => {
			disposed = true;
			modelDispose?.();
			editorRef.current = null;
		};
	}, [editor.visible, editor.path, pushUserCommand, editor.content]);

	if (!editor.visible) return null;

	const displayPath = editor.path === "<scratch>"
		? "untitled.hsc"
		: editor.path ?? "untitled.hsc";

	return (
		<aside className="editor-pane">
			<header className="editor-header">
				<span className="path">{displayPath}</span>
				<span className="hint muted">F5 run · F7 dry-run · Esc close</span>
				<button
					type="button"
					className="close"
					onClick={() => setEditorState({ visible: false, path: null, content: "" })}
				>
					×
				</button>
			</header>
			<div ref={containerRef} className="editor-host" />
		</aside>
	);
}

async function runScript(
	path: string,
	content: string,
	dryRun: boolean,
	pushUserCommand: (command: string, result: import("../../../engine/result.js").CommandResult) => void,
): Promise<void> {
	// run-script / dry-run-script handle the save themselves on the
	// server (and skip it for scratch buffers).
	try {
		const response = (await request({
			kind: dryRun ? "dry-run-script" : "run-script",
			id: `run-${Date.now()}`,
			path,
			content,
		})) as ServerMsg;
		if (response.kind === "run-result") {
			pushUserCommand(dryRun ? "F7 dry-run" : "F5 run", response.result);
		} else if (response.kind === "error") {
			pushUserCommand(dryRun ? "F7 dry-run" : "F5 run", {
				type: "error",
				message: response.message,
				detail: response.detail,
			});
		}
	} catch (err) {
		pushUserCommand(dryRun ? "F7 dry-run" : "F5 run", {
			type: "error",
			message: "Run failed",
			detail: String(err),
		});
	}
}
