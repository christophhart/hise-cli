// ── TokenRenderer — TokenSpan[] → styled <span>s ────────────────────
//
// Reuses the engine's tokenizers (already isomorphic, used by docs +
// TUI). Falls through to plain <code> when language not in the
// supported set.

import { tokenizeHise, TOKEN_COLORS, isHiseLanguage } from "../../../engine/highlight/index.js";

export function TokenRenderer({ language, source }: { language?: string; source: string }) {
	if (!language || !isHiseLanguage(language)) {
		return <>{source}</>;
	}
	const spans = tokenizeHise(language, source);
	if (!spans) return <>{source}</>;
	return (
		<>
			{spans.map((s, i) => (
				<span
					key={i}
					style={{
						color: s.color ?? TOKEN_COLORS[s.token],
						fontWeight: s.bold ? "bold" : undefined,
					}}
				>
					{s.text}
				</span>
			))}
		</>
	);
}
