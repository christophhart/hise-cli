import { useStore } from "../state/store.js";

export interface CompletionPopupProps {
	highlightIndex: number;
	onPick(index: number): void;
}

export function CompletionPopup({ highlightIndex, onPick }: CompletionPopupProps) {
	const completion = useStore((s) => s.completion);
	if (!completion || completion.items.length === 0) return null;
	return (
		<div className="completion-popup">
			{completion.label && <div className="completion-label">{completion.label}</div>}
			<ul>
				{completion.items.slice(0, 12).map((item, i) => (
					<li
						key={`${item.label}-${i}`}
						className={i === highlightIndex ? "active" : undefined}
						onMouseDown={(e) => {
							e.preventDefault();
							onPick(i);
						}}
					>
						<span className="label">{item.label}</span>
						{item.detail && <span className="detail">{item.detail}</span>}
					</li>
				))}
			</ul>
		</div>
	);
}
