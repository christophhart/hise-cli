// ── App — top-level shell ───────────────────────────────────────────

import { useEffect } from "react";
import { useStore } from "./state/store.js";
import { startWsClient } from "./ws-client.js";
import { ReplPane } from "./components/ReplPane.js";
import { StatusBar } from "./components/StatusBar.js";
import { Toast } from "./components/Toast.js";
import { TreeSidebar } from "./components/TreeSidebar.js";

export function App() {
	const connected = useStore((s) => s.connected);

	useEffect(() => {
		const dispose = startWsClient();
		return dispose;
	}, []);

	return (
		<div className="app">
			<StatusBar />
			<main className="main">
				<TreeSidebar />
				<ReplPane />
			</main>
			<Toast />
			{!connected && <div className="overlay-loading">Connecting…</div>}
		</div>
	);
}
