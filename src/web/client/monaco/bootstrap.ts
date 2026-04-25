// ── Monaco loader ────────────────────────────────────────────────────
//
// Uses the AMD loader (vs/loader.js) shipped under dist/web/vs/ — this
// path handles its own worker bootstrapping. ESM-bundling Monaco with
// esbuild requires a worker-resolving plugin we don't have.

import type * as MonacoNS from "monaco-editor";

declare global {
	interface Window {
		MonacoEnvironment?: { getWorkerUrl(workerId: string, label: string): string };
		require: ((modules: string[], onLoad: () => void) => void) & {
			config(opts: { paths: Record<string, string> }): void;
		};
		monaco: typeof MonacoNS;
	}
}

let monacoPromise: Promise<typeof MonacoNS> | null = null;

export function loadMonaco(): Promise<typeof MonacoNS> {
	if (monacoPromise) return monacoPromise;
	monacoPromise = new Promise((resolve, reject) => {
		// Monaco's loader registers a global AMD `require` and resolves
		// vs/editor/editor.main on demand. Workers are spawned from the
		// `vs/base/worker/` tree it knows about.
		const script = document.createElement("script");
		script.src = "/vs/loader.js";
		script.onload = () => {
			try {
				window.require.config({ paths: { vs: "/vs" } });
				window.require(["vs/editor/editor.main"], () => {
					resolve(window.monaco);
				});
			} catch (err) {
				reject(err);
			}
		};
		script.onerror = () => reject(new Error("Failed to load /vs/loader.js"));
		document.head.appendChild(script);
	});
	return monacoPromise;
}
