import { useEffect } from "react";
import { useStore } from "../state/store.js";

export function Toast() {
	const toasts = useStore((s) => s.toasts);
	const dismiss = useStore((s) => s.dismissToast);

	useEffect(() => {
		if (toasts.length === 0) return;
		const timers = toasts.map((t) =>
			window.setTimeout(() => dismiss(t.id), t.level === "error" ? 6000 : 3000),
		);
		return () => {
			for (const id of timers) clearTimeout(id);
		};
	}, [toasts, dismiss]);

	return (
		<div className="toast-stack">
			{toasts.slice(-5).map((t) => (
				<div key={t.id} className={`toast level-${t.level}`} onClick={() => dismiss(t.id)}>
					{t.text}
				</div>
			))}
		</div>
	);
}
