import type { CommandResult } from "../../../../engine/result.js";

export function TableResult({ result }: { result: Extract<CommandResult, { type: "table" }> }) {
	return (
		<table className="result-table">
			<thead>
				<tr>
					{result.headers.map((h, i) => (
						<th key={i}>{h}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{result.rows.map((row, i) => (
					<tr key={i}>
						{row.map((cell, j) => (
							<td key={j}>{cell}</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}
