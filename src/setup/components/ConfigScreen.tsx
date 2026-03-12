import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { useState } from "react";
import type {
	Architecture,
	DetectedEnvironment,
	Platform,
	SetupConfig,
} from "../../setup-core/types.js";
import { DEFAULT_INSTALL_PATHS } from "../../setup-core/types.js";
import { MONOKAI } from "../../theme.js";

interface ConfigScreenProps {
	env: DetectedEnvironment;
	targetCommit?: string;
	faustVersion?: string;
	onConfirm: (config: SetupConfig) => void;
	onBack: () => void;
}

type Field = "installPath" | "faust" | "ipp" | "confirm" | "back";

function fieldsForPlatform(platform: Platform): Field[] {
	const fields: Field[] = ["installPath", "faust"];
	if (platform === "windows") {
		fields.push("ipp");
	}
	fields.push("confirm", "back");
	return fields;
}

export function ConfigScreen({
	env,
	targetCommit,
	faustVersion,
	onConfirm,
	onBack,
}: ConfigScreenProps) {
	const fields = fieldsForPlatform(env.platform);
	const [cursor, setCursor] = useState(0);
	const [installPath, setInstallPath] = useState(
		DEFAULT_INSTALL_PATHS[env.platform]
	);
	const [includeFaust, setIncludeFaust] = useState(false);
	const [includeIPP, setIncludeIPP] = useState(false);
	const [editingPath, setEditingPath] = useState(false);

	const currentField = fields[cursor];

	useInput((input, key) => {
		if (editingPath) {
			if (key.return || key.escape) {
				setEditingPath(false);
			}
			return;
		}

		if (key.upArrow) {
			setCursor((prev) => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setCursor((prev) => Math.min(fields.length - 1, prev + 1));
			return;
		}

		if (key.return || input === " ") {
			switch (currentField) {
				case "installPath":
					setEditingPath(true);
					break;
				case "faust":
					setIncludeFaust((prev) => !prev);
					break;
				case "ipp":
					setIncludeIPP((prev) => !prev);
					break;
				case "confirm":
					onConfirm({
						platform: env.platform,
						architecture: env.architecture,
						installPath,
						includeFaust,
						includeIPP,
						targetCommit,
						faustVersion,
					});
					break;
				case "back":
					onBack();
					break;
			}
		}
	});

	const commitLabel = targetCommit
		? `${targetCommit.substring(0, 7)} (latest passing CI)`
		: "develop HEAD";

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color={MONOKAI.cyan}>
					Setup Configuration
				</Text>
			</Box>

			<Box marginBottom={1} flexDirection="column">
				<Text color={MONOKAI.comment}>
					Platform: <Text color={MONOKAI.foreground}>{env.platform} ({env.architecture})</Text>
				</Text>
				<Text color={MONOKAI.comment}>
					Target: <Text color={MONOKAI.foreground}>{commitLabel}</Text>
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				{/* Install path */}
				<Box>
					<Text
						color={cursor === fields.indexOf("installPath") ? MONOKAI.orange : MONOKAI.foreground}
						bold={cursor === fields.indexOf("installPath")}
					>
						{cursor === fields.indexOf("installPath") ? "> " : "  "}
						Install path:{" "}
					</Text>
					{editingPath ? (
						<TextInput
							value={installPath}
							onChange={setInstallPath}
							onSubmit={() => setEditingPath(false)}
							focus={editingPath}
						/>
					) : (
						<Text color={MONOKAI.cyan}>{installPath}</Text>
					)}
				</Box>

				{/* Faust toggle */}
				<Box>
					<Text
						color={cursor === fields.indexOf("faust") ? MONOKAI.orange : MONOKAI.foreground}
						bold={cursor === fields.indexOf("faust")}
					>
						{cursor === fields.indexOf("faust") ? "> " : "  "}
						Include Faust:{" "}
					</Text>
					<Text color={includeFaust ? MONOKAI.green : MONOKAI.comment}>
						{includeFaust ? "Yes" : "No"}
					</Text>
				</Box>

				{/* IPP toggle (Windows only) */}
				{env.platform === "windows" && (
					<Box>
						<Text
							color={cursor === fields.indexOf("ipp") ? MONOKAI.orange : MONOKAI.foreground}
							bold={cursor === fields.indexOf("ipp")}
						>
							{cursor === fields.indexOf("ipp") ? "> " : "  "}
							Include Intel IPP:{" "}
						</Text>
						<Text color={includeIPP ? MONOKAI.green : MONOKAI.comment}>
							{includeIPP ? "Yes" : "No"}
						</Text>
					</Box>
				)}
			</Box>

			{/* Action buttons */}
			<Box flexDirection="column">
				<Box>
					<Text
						color={currentField === "confirm" ? MONOKAI.orange : MONOKAI.foreground}
						bold={currentField === "confirm"}
					>
						{currentField === "confirm" ? "> " : "  "}
						Start Setup
					</Text>
				</Box>
				<Box>
					<Text
						color={currentField === "back" ? MONOKAI.orange : MONOKAI.foreground}
						bold={currentField === "back"}
					>
						{currentField === "back" ? "> " : "  "}
						Back
					</Text>
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={MONOKAI.comment}>
					{editingPath
						? "Type path, Enter to confirm"
						: "Arrow keys to navigate, Space to toggle, Enter to select"}
				</Text>
			</Box>
		</Box>
	);
}
