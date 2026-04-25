import type { CommandResult } from "../../../../engine/result.js";
import { TokenRenderer } from "../../highlight/token-renderer.js";

export function CodeResult({ result }: { result: Extract<CommandResult, { type: "code" }> }) {
	return (
		<pre className={`result-code lang-${result.language ?? "text"}`}>
			<code>
				<TokenRenderer language={result.language} source={result.content} />
			</code>
		</pre>
	);
}
