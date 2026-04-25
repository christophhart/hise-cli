import type { CommandResult } from "../../../../engine/result.js";

export function PreformattedResult({
	result,
}: {
	result: Extract<CommandResult, { type: "preformatted" }>;
}) {
	return (
		<pre className="result-preformatted" style={result.accent ? { color: result.accent } : undefined}>
			{result.content}
		</pre>
	);
}
