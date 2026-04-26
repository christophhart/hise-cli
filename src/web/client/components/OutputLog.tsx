import { useEffect, useRef } from "react";
import { useStore } from "../state/store.js";
import { ResultRenderer } from "./results/ResultRenderer.js";
import { buildModeMap, tokenizerForLine } from "../../../engine/run/mode-map.js";
import { TOKEN_COLORS } from "../../../engine/highlight/index.js";
import type { ModeId } from "../../../engine/modes/mode.js";
import { CustomScrollbar } from "./CustomScrollbar.js";
import { LandingLogoWeb } from "./LandingLogo.js";

export function OutputLog() {
	const output = useStore((s) => s.output);
	const ref = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.scrollTop = el.scrollHeight;
	}, [output.length]);

	if (output.length === 0) {
		return (
			<div className="output-log-wrap">
				<div className="output-log output-log-landing">
					<LandingLogoWeb />
				</div>
			</div>
		);
	}

	return (
		<div className="output-log-wrap">
			<div ref={ref} className="output-log">
				{output.map((entry) => (
					<article
						key={entry.id}
						className={`output-entry source-${entry.source} mode-of-${entry.modeId ?? "root"}`}
					>
						{entry.command && (
							<header className="entry-header">
								<span className="badge">
									{entry.source === "llm" ? "LLM" : "›"}
								</span>
								<code>
									<HighlightedLine line={entry.command} modeId={entry.modeId} />
								</code>
							</header>
						)}
						<div className="entry-body">
							<ResultRenderer result={entry.result} />
						</div>
					</article>
				))}
			</div>
			<CustomScrollbar target={ref} />
		</div>
	);
}

function HighlightedLine({ line, modeId }: { line: string; modeId?: string }) {
	const [entry] = buildModeMap([line]);
	if (!entry) return <>{line}</>;
	const effective = { ...entry, modeId: ((modeId ?? "root") as ModeId) };
	const tokenizer = tokenizerForLine(effective, line);
	const spans = tokenizer ? tokenizer(line) : null;
	if (!spans) return <>{line}</>;
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
