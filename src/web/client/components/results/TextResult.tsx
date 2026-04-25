import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CommandResult } from "../../../../engine/result.js";

export function TextResult({ result }: { result: Extract<CommandResult, { type: "text" }> }) {
	return (
		<div className="result-markdown">
			<ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown>
		</div>
	);
}
