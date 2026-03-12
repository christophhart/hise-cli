import { Box } from "ink";
import { useCallback, useState } from "react";
import type {
	DetectedEnvironment,
	PhaseResult,
	PrereqCheckResult,
	SetupConfig,
} from "../setup-core/types.js";
import type { PhaseContext } from "./phases.js";
import { CompleteScreen } from "./components/CompleteScreen.js";
import { ConfigScreen } from "./components/ConfigScreen.js";
import { DetectScreen } from "./components/DetectScreen.js";
import { PrereqScreen } from "./components/PrereqScreen.js";
import { RunScreen } from "./components/RunScreen.js";

type SetupStep =
	| "detect"
	| "prereqs"
	| "config"
	| "run"
	| "complete";

interface SetupAppProps {
	targetCommit?: string;
	faustVersion?: string;
	onExit: () => void;
}

export function SetupApp({ targetCommit, faustVersion, onExit }: SetupAppProps) {
	const [step, setStep] = useState<SetupStep>("detect");
	const [env, setEnv] = useState<DetectedEnvironment | null>(null);
	const [prereqs, setPrereqs] = useState<PrereqCheckResult[]>([]);
	const [config, setConfig] = useState<SetupConfig | null>(null);
	const [results, setResults] = useState<PhaseResult[]>([]);
	const [logPath, setLogPath] = useState<string | undefined>(undefined);

	// Temporary config for detection pass (before user configures)
	const [detectFaust, setDetectFaust] = useState(false);
	const [detectIPP, setDetectIPP] = useState(false);

	const handleDetectComplete = useCallback(
		(detected: DetectedEnvironment, checks: PrereqCheckResult[]) => {
			setEnv(detected);
			setPrereqs(checks);

			// If required prereqs are missing, show prereq screen
			const hasMissing = checks.some(
				(c) => c.required && c.status !== "found"
			);
			if (hasMissing) {
				setStep("prereqs");
			} else {
				setStep("config");
			}
		},
		[]
	);

	const handlePrereqContinue = useCallback(() => {
		setStep("config");
	}, []);

	const handlePrereqRecheck = useCallback(() => {
		setStep("detect");
	}, []);

	const handlePrereqBack = useCallback(() => {
		onExit();
	}, [onExit]);

	const handleConfigConfirm = useCallback(
		(cfg: SetupConfig) => {
			setConfig(cfg);
			setDetectFaust(cfg.includeFaust);
			setDetectIPP(cfg.includeIPP);
			setStep("run");
		},
		[]
	);

	const handleConfigBack = useCallback(() => {
		onExit();
	}, [onExit]);

	const handleRunComplete = useCallback((phaseResults: PhaseResult[], phaseLogPath: string) => {
		setResults(phaseResults);
		setLogPath(phaseLogPath);
		setStep("complete");
	}, []);

	const handleRunAbort = useCallback(() => {
		setStep("config");
	}, []);

	const phaseContext: PhaseContext | null = env
		? {
				hasGit: env.hasGit,
				hasCompiler: env.hasCompiler,
				hasFaust: env.hasFaust,
				hasIPP: env.hasIPP,
				hisePath: config?.installPath || "",
			}
		: null;

	return (
		<Box flexDirection="column">
			{step === "detect" && (
				<DetectScreen
					includeFaust={detectFaust}
					includeIPP={detectIPP}
					onComplete={handleDetectComplete}
				/>
			)}
			{step === "prereqs" && (
				<PrereqScreen
					prereqs={prereqs}
					onContinue={handlePrereqContinue}
					onRecheck={handlePrereqRecheck}
					onBack={handlePrereqBack}
				/>
			)}
			{step === "config" && env && (
				<ConfigScreen
					env={env}
					targetCommit={targetCommit}
					faustVersion={faustVersion}
					onConfirm={handleConfigConfirm}
					onBack={handleConfigBack}
				/>
			)}
			{step === "run" && config && phaseContext && (
				<RunScreen
					config={config}
					context={phaseContext}
					onComplete={handleRunComplete}
					onAbort={handleRunAbort}
				/>
			)}
			{step === "complete" && config && (
				<CompleteScreen
					config={config}
					results={results}
					logPath={logPath}
					onExit={onExit}
				/>
			)}
		</Box>
	);
}
