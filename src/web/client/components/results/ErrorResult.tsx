import type { CommandResult } from "../../../../engine/result.js";

export function ErrorResult({ result }: { result: Extract<CommandResult, { type: "error" }> }) {
	return (
		<div className="result-error">
			<strong>{result.message}</strong>
			{result.detail && (
				<details>
					<summary>details</summary>
					<pre>{result.detail}</pre>
				</details>
			)}
		</div>
	);
}
