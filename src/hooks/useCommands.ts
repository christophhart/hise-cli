import { useCallback, useRef, useState } from "react";

type SubmitHandler = (input: string) => boolean;

export function useCommands(onSubmitCommand: SubmitHandler) {
	const [value, setValue] = useState("");
	const [history, setHistory] = useState<string[]>([]);
	const [cursor, setCursor] = useState<number | null>(null);
	const draftRef = useRef("");

	const submit = useCallback(
		(rawValue?: string) => {
			const candidate = (rawValue ?? value).trim();
			if (!candidate) {
				return;
			}

			const accepted = onSubmitCommand(candidate);
			if (!accepted) {
				return;
			}

			setHistory((previous: string[]) => {
				if (previous[previous.length - 1] === candidate) {
					return previous;
				}

				return previous.concat(candidate);
			});

			setValue("");
			setCursor(null);
			draftRef.current = "";
		},
		[onSubmitCommand, value]
	);

	const historyUp = useCallback(() => {
		if (history.length === 0) {
			return;
		}

		if (cursor === null) {
			draftRef.current = value;
			const nextCursor = history.length - 1;
			setCursor(nextCursor);
			setValue(history[nextCursor]);
			return;
		}

		if (cursor <= 0) {
			setValue(history[0]);
			return;
		}

		const nextCursor = cursor - 1;
		setCursor(nextCursor);
		setValue(history[nextCursor]);
	}, [cursor, history, value]);

	const historyDown = useCallback(() => {
		if (history.length === 0 || cursor === null) {
			return;
		}

		if (cursor >= history.length - 1) {
			setCursor(null);
			setValue(draftRef.current);
			return;
		}

		const nextCursor = cursor + 1;
		setCursor(nextCursor);
		setValue(history[nextCursor]);
	}, [cursor, history]);

	const updateValue = useCallback((nextValue: string) => {
		setValue(nextValue);
		if (cursor === null) {
			draftRef.current = nextValue;
		}
	}, [cursor]);

	return {
		historyDown,
		historyUp,
		submit,
		value,
		setValue: updateValue,
	};
}
