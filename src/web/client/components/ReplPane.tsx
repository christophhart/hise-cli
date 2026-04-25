import { OutputLog } from "./OutputLog.js";
import { Input } from "./Input.js";
import { EditorPane } from "./EditorPane.js";
import { useStore } from "../state/store.js";

export function ReplPane() {
	const editorVisible = useStore((s) => s.editor.visible);
	return (
		<section className="repl-pane">
			<OutputLog />
			{editorVisible ? <EditorPane /> : <Input />}
		</section>
	);
}
