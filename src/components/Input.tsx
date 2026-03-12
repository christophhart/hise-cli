import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { MONOKAI } from "../theme.js";

interface InputProps {
	width: number;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	onHistoryUp: () => void;
	onHistoryDown: () => void;
}

export function Input({
	width,
	value,
	disabled,
	onChange,
	onSubmit,
	onHistoryUp,
	onHistoryDown,
}: InputProps) {
	useInput((_input: string, key: { upArrow?: boolean; downArrow?: boolean }) => {
		if (disabled) {
			return;
		}

		if (key.upArrow) {
			onHistoryUp();
		}

		if (key.downArrow) {
			onHistoryDown();
		}
	});

	return (
		<Box width={width} paddingX={2} backgroundColor={MONOKAI.backgroundRaised}>
			<Text color={MONOKAI.orange} backgroundColor={MONOKAI.backgroundRaised}>
				&gt; 
			</Text>
			<TextInput
				value={value}
				onChange={onChange}
				onSubmit={onSubmit}
				focus={!disabled}
				showCursor={!disabled}
			/>
			{disabled && (
				<Text color={MONOKAI.comment} backgroundColor={MONOKAI.backgroundRaised}>
					  waiting for response...
				</Text>
			)}
		</Box>
	);
}
