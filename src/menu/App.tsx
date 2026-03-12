import { Box, Text, useApp, useInput } from "ink";
import { useState } from "react";
import { MONOKAI } from "../theme.js";

export type MenuChoice =
	| "setup"
	| "update"
	| "migrate"
	| "nuke"
	| "repl";

interface MenuOption {
	key: MenuChoice;
	label: string;
	description: string;
}

const MENU_OPTIONS: MenuOption[] = [
	{
		key: "setup",
		label: "Setup new machine",
		description: "Install HISE from source with all dependencies",
	},
	{
		key: "update",
		label: "Update existing HISE",
		description: "Pull latest changes and recompile",
	},
	{
		key: "migrate",
		label: "Migrate ZIP to Git",
		description: "Convert a ZIP-based install to a Git workflow",
	},
	{
		key: "nuke",
		label: "Nuke installation",
		description: "Remove HISE and clean up",
	},
	{
		key: "repl",
		label: "Connect to running HISE",
		description: "Open REPL console via named pipe",
	},
];

interface MainMenuAppProps {
	onSelect: (choice: MenuChoice) => void;
}

export function MainMenuApp({ onSelect }: MainMenuAppProps) {
	const { exit } = useApp();
	const [cursor, setCursor] = useState(0);

	useInput((input, key) => {
		if (key.upArrow) {
			setCursor((prev) => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow) {
			setCursor((prev) => Math.min(MENU_OPTIONS.length - 1, prev + 1));
			return;
		}

		if (key.return) {
			onSelect(MENU_OPTIONS[cursor].key);
			return;
		}

		if (input === "q" || (key.ctrl && input === "c")) {
			exit();
		}
	});

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1} flexDirection="column">
				<Text bold color={MONOKAI.cyan}>
					HISE CLI
				</Text>
				<Text color={MONOKAI.comment}>
					Development environment manager for HISE
				</Text>
			</Box>
			<Box flexDirection="column">
				{MENU_OPTIONS.map((option, index) => {
					const selected = index === cursor;
					return (
						<Box key={option.key}>
							<Text
								color={selected ? MONOKAI.orange : MONOKAI.foreground}
								bold={selected}
							>
								{selected ? "> " : "  "}
								{option.label}
							</Text>
							<Text color={MONOKAI.comment}>
								{"  "}
								{option.description}
							</Text>
						</Box>
					);
				})}
			</Box>
			<Box marginTop={1}>
				<Text color={MONOKAI.comment}>
					Arrow keys to navigate, Enter to select, q to quit
				</Text>
			</Box>
		</Box>
	);
}
