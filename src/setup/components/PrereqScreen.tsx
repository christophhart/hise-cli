import { Box, Text, useInput } from "ink";
import { useState } from "react";
import type { PrereqCheckResult } from "../../setup-core/types.js";
import { MONOKAI } from "../../theme.js";
import { openURL } from "../runner.js";

interface PrereqScreenProps {
	prereqs: PrereqCheckResult[];
	onContinue: () => void;
	onRecheck: () => void;
	onBack: () => void;
}

function statusIcon(status: string): string {
	switch (status) {
		case "found":
			return "+";
		case "missing":
			return "x";
		case "wrong-version":
			return "!";
		default:
			return "?";
	}
}

function statusColor(status: string): string {
	switch (status) {
		case "found":
			return MONOKAI.green;
		case "missing":
			return MONOKAI.red;
		case "wrong-version":
			return MONOKAI.yellow;
		default:
			return MONOKAI.comment;
	}
}

export function PrereqScreen({
	prereqs,
	onContinue,
	onRecheck,
	onBack,
}: PrereqScreenProps) {
	const hasBlockingMissing = prereqs.some(
		(p) => p.required && p.status !== "found"
	);
	const [cursor, setCursor] = useState(0);

	// Build action list for missing prereqs
	const allActions: Array<{
		label: string;
		handler: () => void;
	}> = [];

	for (const p of prereqs) {
		if (p.status === "found") continue;
		for (const action of p.actions) {
			if (action.action === "open-url" && action.url) {
				const url = action.url;
				allActions.push({
					label: `${p.name}: ${action.label}`,
					handler: () => openURL(url),
				});
			} else if (action.action === "run-command" && action.command) {
				const cmd = action.command;
				allActions.push({
					label: `${p.name}: ${action.label} (${cmd})`,
					handler: () => {
						// We just show the command - user runs it themselves
					},
				});
			}
		}
	}

	// Always add recheck and navigation
	allActions.push({ label: "Re-check prerequisites", handler: onRecheck });
	if (!hasBlockingMissing) {
		allActions.push({ label: "Continue", handler: onContinue });
	}
	allActions.push({ label: "Back", handler: onBack });

	useInput((input, key) => {
		if (key.upArrow) {
			setCursor((prev) => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setCursor((prev) => Math.min(allActions.length - 1, prev + 1));
			return;
		}
		if (key.return) {
			allActions[cursor].handler();
		}
	});

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color={MONOKAI.cyan}>
					Prerequisites
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				{prereqs.map((p) => (
					<Box key={p.id}>
						<Text color={statusColor(p.status)}>
							[{statusIcon(p.status)}]
						</Text>
						<Text color={MONOKAI.foreground}> {p.name}</Text>
						{p.detail && (
							<Text color={MONOKAI.comment}>
								{"  "}{p.detail}
							</Text>
						)}
						{!p.required && p.status === "missing" && (
							<Text color={MONOKAI.comment}> (optional)</Text>
						)}
					</Box>
				))}
			</Box>

			{hasBlockingMissing && (
				<Box marginBottom={1}>
					<Text color={MONOKAI.red}>
						Required prerequisites are missing. Install them before continuing.
					</Text>
				</Box>
			)}

			<Box flexDirection="column">
				{allActions.map((action, index) => {
					const selected = index === cursor;
					return (
						<Box key={action.label}>
							<Text
								color={selected ? MONOKAI.orange : MONOKAI.foreground}
								bold={selected}
							>
								{selected ? "> " : "  "}
								{action.label}
							</Text>
						</Box>
					);
				})}
			</Box>

			<Box marginTop={1}>
				<Text color={MONOKAI.comment}>
					Arrow keys to navigate, Enter to select
				</Text>
			</Box>
		</Box>
	);
}
