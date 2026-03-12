import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import { useEffect, useState } from "react";
import type { DetectedEnvironment, PrereqCheckResult } from "../../setup-core/types.js";
import { MONOKAI } from "../../theme.js";
import { checkPrerequisites, detectEnvironment } from "../detect.js";

interface DetectScreenProps {
	includeFaust: boolean;
	includeIPP: boolean;
	onComplete: (env: DetectedEnvironment, prereqs: PrereqCheckResult[]) => void;
}

type DetectState = "detecting" | "done";

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

export function DetectScreen({ includeFaust, includeIPP, onComplete }: DetectScreenProps) {
	const [state, setState] = useState<DetectState>("detecting");
	const [env, setEnv] = useState<DetectedEnvironment | null>(null);
	const [prereqs, setPrereqs] = useState<PrereqCheckResult[]>([]);

	useEffect(() => {
		// Run detection asynchronously so UI renders first
		const timer = setTimeout(() => {
			const detected = detectEnvironment();
			const checks = checkPrerequisites(detected, { includeFaust, includeIPP });
			setEnv(detected);
			setPrereqs(checks);
			setState("done");

			// Auto-advance after a brief delay so user can see results
			setTimeout(() => {
				onComplete(detected, checks);
			}, 1500);
		}, 100);

		return () => clearTimeout(timer);
	}, [includeFaust, includeIPP, onComplete]);

	if (state === "detecting") {
		return (
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				<Box marginBottom={1}>
					<Text bold color={MONOKAI.cyan}>
						Environment Detection
					</Text>
				</Box>
				<Box>
					<Text color={MONOKAI.yellow}>
						<Spinner type="dots" />
					</Text>
					<Text color={MONOKAI.comment}> Scanning system...</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" paddingX={2} paddingY={1}>
			<Box marginBottom={1}>
				<Text bold color={MONOKAI.cyan}>
					Environment Detection
				</Text>
			</Box>

			{env && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={MONOKAI.comment}>
						Platform: <Text color={MONOKAI.foreground}>{env.platform} ({env.architecture})</Text>
					</Text>
					{env.hiseInstallations.length > 0 && (
						<Text color={MONOKAI.comment}>
							Existing HISE:{" "}
							<Text color={MONOKAI.foreground}>
								{env.hiseInstallations.map((i) => i.path).join(", ")}
							</Text>
						</Text>
					)}
				</Box>
			)}

			<Box flexDirection="column">
				{prereqs.map((p) => (
					<Box key={p.id}>
						<Text color={statusColor(p.status)}>
							[{statusIcon(p.status)}]
						</Text>
						<Text color={MONOKAI.foreground}>
							{" "}
							{p.name}
						</Text>
						{p.detail && (
							<Text color={MONOKAI.comment}>
								{"  "}
								{p.detail}
							</Text>
						)}
						{!p.required && p.status === "missing" && (
							<Text color={MONOKAI.comment}> (optional)</Text>
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
}
