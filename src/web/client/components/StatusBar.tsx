import { useStore } from "../state/store.js";

export function StatusBar() {
	const s = useStore((s) => s.sessionState);
	const connected = useStore((s) => s.connected);
	return (
		<header className="status-bar">
			<span className={`status-pill ${connected ? "ok" : "off"}`}>
				{connected ? "● online" : "○ offline"}
			</span>
			<span className="mode-stack">
				{s.modeStack.map((m, i) => (
					<span key={`${m}-${i}`} className={`mode mode-${m}`}>
						{m}
					</span>
				))}
			</span>
			<span className="project">{s.projectName ?? "no project"}</span>
		</header>
	);
}
