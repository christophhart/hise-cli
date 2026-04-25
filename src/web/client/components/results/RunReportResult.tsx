import type { CommandResult } from "../../../../engine/result.js";

export function RunReportResult({
	result,
}: {
	result: Extract<CommandResult, { type: "run-report" }>;
}) {
	const r = result.runResult;
	return (
		<div className={`result-run-report ${r.ok ? "ok" : "fail"}`}>
			<header>
				<strong>{r.ok ? "✓" : "✗"} run</strong>{" "}
				<span className="muted">
					{r.linesExecuted} line{r.linesExecuted === 1 ? "" : "s"}
				</span>
			</header>
			{r.error && (
				<p className="error-line">
					<code>line {r.error.line}</code>: {r.error.message}
				</p>
			)}
			{r.expects.length > 0 && (
				<ul className="expects">
					{r.expects.map((e, i) => (
						<li key={i} className={e.passed ? "pass" : "fail"}>
							<code>line {e.line}</code> {e.passed ? "✓" : "✗"} {e.command} →{" "}
							<code>{e.actual}</code>
							{!e.passed && (
								<>
									{" "}(expected <code>{e.expected}</code>)
								</>
							)}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
