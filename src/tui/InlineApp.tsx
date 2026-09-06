// ── InlineApp — sticky-bottom REPL Ink shell ────────────────────────
//
// No alt-screen, no full-screen layout. Output blocks committed via
// Ink's <Static> (appended to scrollback, never re-rendered). Below
// Static: status line + completion popup (when active) + input.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Static, Text, useApp, useInput, useStdout } from "ink";
import { MouseProvider } from "@ink-tools/ink-mouse";
import type { Session } from "../engine/session.js";
import type { HiseConnection } from "../engine/hise.js";
import type { DataLoader } from "../engine/data.js";
import { TuiAiSession, type AiThinkingLevel, type TuiAiEvent, type TuiAiStats } from "./ai-session.js";
import { completeAiSlash, type AiSessionChoice } from "./ai-completion.js";
import type { CommandResult } from "../engine/result.js";
import type { CompletionItem, CompletionResult } from "../engine/modes/mode.js";
import { MODE_ACCENTS } from "../engine/modes/mode.js";
import { startObserverServer, type ObserverEvent } from "./observer.js";
import type { TreeNode } from "../engine/result.js";
import { renderTreeBox } from "../engine/modes/builder-ops.js";
import { resolveNodeByPath } from "../engine/tree-utils.js";
import { Input, type InputHandle, buildVisualRowMap, offsetToLineCol, lineColToOffset } from "./Input.js";
import { formatScriptLog } from "./script-log.js";
import { buildModeMap } from "../engine/run/mode-map.js";
import { CompletionPopup } from "./CompletionPopup.js";
import {
	brand,
	defaultScheme,
	statusColor,
	type ColorScheme,
	type ConnectionStatus,
} from "./theme.js";

const HORIZONTAL_PAD = 2;
const COMPLETION_MAX_VISIBLE = 8;
const COMPACT = {
	horizontalPad: HORIZONTAL_PAD,
	completionMaxVisible: COMPLETION_MAX_VISIBLE,
} as const;
import {
	renderEcho,
	renderError,
	renderResult,
	fgHex,
	RESET,
	wrapAnsi,
	type PrerenderedBlock,
} from "./prerender.js";
import {
	renderWizardBlock,
	createInitialFormState,
	type WizardFormState,
} from "./wizard-render.js";
import { handleWizardKey } from "./wizard-keys.js";
import {
	WizardExecutor,
	WizardInitAbortError,
} from "../engine/wizard/executor.js";
import type { WizardDefinition } from "../engine/wizard/types.js";
import { mergeInitDefaults } from "../engine/wizard/types.js";
import { formatWithClause } from "../engine/commands/slash.js";
import { generateAiHelp } from "../engine/commands/help.js";
import { listPathCompletions } from "./wizard-files.js";
import {
	getProviderLabel,
	isAiCapableMode,
	runAiPrediction,
} from "./ai-prompt.js";
import type { IntentOutcome } from "../engine/llm/index.js";

interface CommittedBlock {
	id: number;
	text: string;
}

interface AiPreviewState {
	nl: string;
	pending: boolean;
	outcome?: IntentOutcome;
	preludeError?: string;
}

interface AiActivityState {
	kind: "thinking" | "tool";
	startedAt: number;
	toolName?: string;
	args?: unknown;
}

function createLoginWizard(providers: string[]): WizardDefinition {
	return {
		id: "ai_provider_login", header: "Configure AI provider", description: "Authenticate a built-in provider or add a custom endpoint",
		tabs: [{ label: "Authentication", fields: [
			{ id: "provider", type: "choice", label: "Provider", required: true, items: ["custom", ...providers], valueMode: "text" },
			{ id: "apiKey", type: "text", label: "API key", required: true, secret: true, emptyText: "Paste your provider key" },
			{ id: "newId", type: "text", label: "Provider ID", required: true, visibleIf: { fieldId: "provider", value: "custom" } },
			{ id: "baseUrl", type: "text", label: "Base URL", required: true, visibleIf: { fieldId: "provider", value: "custom" }, emptyText: "https://api.example.com/v1" },
			{ id: "newModelId", type: "text", label: "Model ID", required: true, visibleIf: { fieldId: "provider", value: "custom" } },
		] }], tasks: [], postActions: [], globalDefaults: {}, submitLabel: "Stores credentials securely and refreshes available models.",
	};
}

export function createModelPicker(models: string[], thinkingLevels: string[], currentModel: string, currentThinkingLevel: string): WizardDefinition {
	const providers = [...new Set(models.map((model) => model.split("/")[0]).filter((provider): provider is string => Boolean(provider)))];
	const selectedModel = models.includes(currentModel) ? currentModel : (models[0] ?? "");
	const selectedProvider = selectedModel.split("/")[0] ?? providers[0] ?? "";
	const selectedThinkingLevel = thinkingLevels.includes(currentThinkingLevel) ? currentThinkingLevel : (thinkingLevels[0] ?? "off");
	return {
		id: "ai_model_select", header: "Select AI model", description: "Choose a provider, then a model",
		tabs: [{ label: "Available models", fields: [
			{ id: "provider", type: "choice", label: "Provider", required: true, items: providers, valueMode: "text", defaultValue: selectedProvider },
			{ id: "modelId", type: "choice", label: "Model", required: true, items: models.filter((model) => model.startsWith(`${selectedProvider}/`)), allItems: models, valueMode: "text", defaultValue: selectedModel, emptyText: "Select a model" },
			{ id: "thinkingLevel", type: "choice", label: "Reasoning", required: true, items: thinkingLevels, valueMode: "text", defaultValue: selectedThinkingLevel },
		] }],
		tasks: [], postActions: [], globalDefaults: {}, submitLabel: "Switches the active AI model and reasoning level.",
	};
}

export function refreshWizardModelField(state: WizardFormState, getThinkingLevels: (modelId: string) => string[] = () => ["off"]): WizardFormState {
	if (state.definition.id !== "ai_model_select" && state.definition.id !== "ai_provider_select") return state;
	const provider = state.answers.provider ?? "";
	const providerId = provider.startsWith("provider:") ? provider.slice("provider:".length) : provider;
	const fields = state.definition.tabs[0]?.fields;
	if (!fields) return state;
	const modelField = fields.find((field) => field.id === "modelId");
	if (!modelField) return state;
	const allModels = modelField.allItems ?? modelField.items ?? [];
	// Model IDs are provider/model-id strings in the runtime catalog.
	const filtered = providerId ? allModels.filter((model) => model.startsWith(`${providerId}/`)) : [];
	const selected = state.answers.modelId;
	const validSelected = selected && filtered.includes(selected) ? selected : "";
	const thinkingLevels = validSelected ? getThinkingLevels(validSelected) : ["off"];
	const definition: WizardDefinition = {
		...state.definition,
		tabs: [{ ...state.definition.tabs[0]!, fields: fields.map((field) => {
			if (field.id === "modelId") return { ...field, items: filtered };
			if (field.id === "thinkingLevel") return { ...field, items: thinkingLevels };
			return field;
		}) }, ...state.definition.tabs.slice(1)],
	};
	const selectedThinking = state.answers.thinkingLevel ?? "off";
	return {
		...state,
		definition,
		answers: {
			...state.answers,
			modelId: validSelected,
			thinkingLevel: thinkingLevels.includes(selectedThinking) ? selectedThinking : (thinkingLevels[0] ?? "off"),
		},
		// Only reset the model list cursor after changing provider. Resetting it
		// for every keypress makes Up/Down appear not to work in the selector.
		choiceIndex: state.activeField === 0 && !state.editing ? 0 : state.choiceIndex,
	};
}

export interface InlineAppProps {
	session: Session;
	connection: HiseConnection | null;
	dataLoader: DataLoader;
}

export function InlineApp(props: InlineAppProps): React.ReactElement {
	return (
		<MouseProvider autoEnable={false}>
			<InlineAppInner {...props} scheme={defaultScheme} />
		</MouseProvider>
	);
}

interface InnerProps extends InlineAppProps {
	scheme: ColorScheme;
}

function InlineAppInner({ session, connection, dataLoader, scheme }: InnerProps): React.ReactElement {
	const { exit } = useApp();
	const { stdout } = useStdout();

	const [columns, setColumns] = useState<number>(stdout?.columns ?? 80);
	const [terminalRows, setTerminalRows] = useState<number>(stdout?.rows ?? 24);

	useEffect(() => {
		if (!stdout) return;
		let timer: NodeJS.Timeout | null = null;
		const handler = () => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				setColumns(stdout.columns ?? 80);
				setTerminalRows(stdout.rows ?? 24);
				timer = null;
			}, 300);
		};
		stdout.on("resize", handler);
		return () => {
			stdout.off("resize", handler);
			if (timer) clearTimeout(timer);
		};
	}, [stdout]);

	const innerW = Math.max(20, columns - 2 * COMPACT.horizontalPad);

	const [committed, setCommitted] = useState<CommittedBlock[]>([]);
	const blockIdRef = useRef(0);

	const [disabled, setDisabled] = useState(false);
	const disabledRef = useRef(false);

	const [completionState, setCompletionState] = useState<{
		result: CompletionResult;
		selectedIndex: number;
	} | null>(null);

	// Hold the popup row count after Enter dismissal so the reserved
	// region's height stays constant until the next keystroke. Prevents
	// input from jumping up when popup hides on submit.
	const [frozenPopupRows, setFrozenPopupRows] = useState(0);

	const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
		connection ? "warning" : "error",
	);

	const [treePanelVisible, setTreePanelVisible] = useState(false);

	const [terminalFocused, setTerminalFocused] = useState(true);
	const focusSeqTimestampRef = useRef(0);

	// Graceful exit: switch border to dimmed before unmount so the final
	// frame visually signals "not focused" (otherwise looks like hise-cli
	// is still active).
	const gracefulExit = useCallback(() => {
		setTerminalFocused(false);
		setTimeout(() => exit(), 50);
	}, [exit]);
	useEffect(() => {
		// DECSET 1004: focus reporting. Terminal emits \x1b[I on focus-in,
		// \x1b[O on focus-out. Used to colorize sticky borders + prompt.
		process.stdout.write("\x1b[?1004h");
		const onData = (data: Buffer) => {
			const s = data.toString("utf8");
			if (s.includes("\x1b[I")) {
				focusSeqTimestampRef.current = Date.now();
				setTerminalFocused(true);
			}
			if (s.includes("\x1b[O")) {
				focusSeqTimestampRef.current = Date.now();
				setTerminalFocused(false);
			}
		};
		process.stdin.on("data", onData);
		return () => {
			process.stdin.off("data", onData);
			process.stdout.write("\x1b[?1004l");
		};
	}, []);

	// F5/F7 detection: Ink's useInput cannot reliably distinguish these
	// across terminals, so we attach a raw stdin listener that parses the
	// escape sequences and flips a ref. The multiline useInput branch
	// checks the refs and fires the corresponding action.
	const f5PressedRef = useRef(false);
	const f7PressedRef = useRef(false);
	// Ink maps both Delete (\x1b[3~) and Backspace (\x7f) to key.delete/backspace,
	// so we sniff the raw sequence to distinguish forward-delete.
	const deleteForwardRef = useRef(false);
	useEffect(() => {
		const onData = (data: Buffer) => {
			const str = data.toString();
			if (str === "\x1b[15~" || str === "\x1b[[E") f5PressedRef.current = true;
			if (str === "\x1b[18~") f7PressedRef.current = true;
			if (str === "\x1b[3~") deleteForwardRef.current = true;
		};
		process.stdin.on("data", onData);
		return () => { process.stdin.off("data", onData); };
	}, []);

	const inputHandleRef = useRef<InputHandle | null>(null);

	const [modeRenderTick, forceModeRender] = useState(0);
	const bumpModeRender = useCallback(() => forceModeRender(v => v + 1), []);

	const [wizardForm, setWizardForm] = useState<WizardFormState | null>(null);
	const wizardFormRef = useRef<WizardFormState | null>(null);
	wizardFormRef.current = wizardForm;
	const providerWizardFormRef = useRef<"model" | "login" | false>(false);

	// Re-render the status bar when the active wizard changes (set in
	// session.setActiveWizard / clearActiveWizard).
	const [activeWizardTick, setActiveWizardTick] = useState(0);
	const activeWizard = session.activeWizard ?? null;
	useEffect(() => {
		// Poll the session-level tick (cheap) instead of plumbing a subscription.
		const id = setInterval(() => {
			if ((session.activeWizardTick ?? 0) !== activeWizardTick) {
				setActiveWizardTick(session.activeWizardTick ?? 0);
			}
		}, 80);
		return () => clearInterval(id);
	}, [session, activeWizardTick]);

	// Spinner frame counter — advances while a wizard is active.
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	useEffect(() => {
		if (!activeWizard) return;
		const id = setInterval(() => setSpinnerFrame(f => (f + 1) % 10), 80);
		return () => clearInterval(id);
	}, [activeWizard]);

	const [multilineMode, setMultilineMode] = useState(false);
	const multilineModeRef = useRef(false);
	multilineModeRef.current = multilineMode;
	const [editorFilePath, setEditorFilePath] = useState<string | null>(null);
	const [editorErrorLines, setEditorErrorLines] = useState<number[] | undefined>(undefined);
	const singleLineContentRef = useRef("");
	const editorContentRef = useRef("");
	const escTimestampRef = useRef(0);
	// Bumped on every editor value change so editorMaxLines memo recomputes.
	const [editorValueVersion, setEditorValueVersion] = useState(0);

	// AI prompt (?-prefix) state. When set, displays a confirmation block
	// above the input prompt; Enter executes, Esc cancels, R retries.
	const [aiPreview, setAiPreview] = useState<AiPreviewState | null>(null);
	const aiPreviewRef = useRef<AiPreviewState | null>(null);
	aiPreviewRef.current = aiPreview;
	const aiAbortRef = useRef<AbortController | null>(null);

	const MIN_EDITOR_LINES = 4;
	const editorMaxLines = useMemo(() => {
		if (!multilineMode) return 1;
		const value = inputHandleRef.current?.getValue() ?? "";
		const lines = value.split("\n");
		const lineCount = Math.max(lines.length, MIN_EDITOR_LINES);
		const lineNumberWidth = String(lineCount).length;
		const gutterChars = COMPACT.horizontalPad + lineNumberWidth + 1 + 1;
		const bodyWidth = Math.max(1, columns - gutterChars - 1 - COMPACT.horizontalPad);
		const vrMap = buildVisualRowMap(lines, bodyWidth);
		return Math.max(MIN_EDITOR_LINES, vrMap.length);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [multilineMode, columns, editorValueVersion]);

	const currentMode = session.currentMode();
	const wizardActive = activeWizard !== null;
	const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
	const modeLabel = wizardActive
		? `${spinnerFrames[spinnerFrame]} Running ${activeWizard}`
		: currentMode.name ?? "root";
	const modeAccent = wizardActive
		? "#e8a060"
		: currentMode.accent || scheme.foreground.muted;
	const contextLabel = wizardActive ? undefined : currentMode.contextLabel;

	const modeTokenizer = useMemo(() => {
		const inner = currentMode.tokenizeInput
			? (v: string) => currentMode.tokenizeInput!(v)
			: undefined;
		// Wrap to special-case ?-prefix (AI prompt): bypass mode highlight,
		// render `?` in signal color and rest as plain text.
		return (v: string) => {
			if (v.trimStart().startsWith("?")) {
				const leading = v.length - v.trimStart().length;
				const out = [];
				if (leading > 0) out.push({ token: "plain" as const, text: v.slice(0, leading) });
				out.push({ token: "aiPrefix" as const, text: "?", bold: true });
				const rest = v.slice(leading + 1);
				if (rest.length > 0) out.push({ token: "plain" as const, text: rest });
				return out;
			}
			return inner ? inner(v) : [{ token: "plain" as const, text: v }];
		};
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [currentMode]);

	const appendBlock = useCallback((block: PrerenderedBlock, indent = true, compact = false) => {
		const id = blockIdRef.current++;
		const prefix = indent ? "  " : "";
		const padded = block.lines.map(l => prefix + l).join("\n");
		// Default: surround with blank lines (wide spacing between command outputs).
		// Compact: no extra padding — Ink's <Text> already terminates each block
		// with a newline, so adjacent compact blocks stack as consecutive rows
		// with no blank line between, suitable for streaming progress.
		const text = compact ? padded : "\n" + padded + "\n";
		setCommitted(prev => [...prev, { id, text }]);
	}, []);

	const [aiActive, setAiActive] = useState(false);
	const [aiRunning, setAiRunning] = useState(false);
	const [aiActivity, setAiActivity] = useState<AiActivityState | null>(null);
	const [aiModel, setAiModel] = useState("no model");
	const [aiModels, setAiModels] = useState<string[]>([]);
	const [aiSessions, setAiSessions] = useState<AiSessionChoice[]>([]);
	const [aiStats, setAiStats] = useState<TuiAiStats | undefined>();
	const aiSessionRef = useRef<TuiAiSession | null>(null);
	const aiProjectRef = useRef<string | null>(null);
	useEffect(() => {
		if (!aiRunning) return;
		const id = setInterval(() => setSpinnerFrame((frame) => (frame + 1) % 10), 80);
		return () => clearInterval(id);
	}, [aiRunning]);
	const aiEventHandler = useCallback((event: TuiAiEvent) => {
		if (event.type === "stats") {
			setAiStats(event.stats);
		} else if (event.type === "research-progress" && event.progress) {
			const progress = event.progress;
			if (progress.type === "diagnostics") {
				const issues = progress.issues ?? [];
				const diagnosticsBlock = renderResult({
					type: "error",
					message: `${progress.label}${progress.detail ? ` · ${progress.detail}` : ""}\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
				}, scheme, innerW);
				if (diagnosticsBlock) appendBlock(diagnosticsBlock);
			} else if (progress.type === "start") {
				setAiActivity({ kind: "tool", toolName: `Research · ${progress.label}`, args: progress.detail ? { query: progress.detail } : undefined, startedAt: Date.now() });
			} else {
				const detail = progress.detail ? ` · ${progress.detail}` : "";
				const marker = progress.ok === false ? "✗" : "✓";
				const progressBlock = renderResult({ type: "text", content: `${marker} ${progress.label}${detail} · ${formatElapsed(progress.elapsedMs ?? 0)}` }, scheme, innerW);
				if (progressBlock) appendBlock(progressBlock, true, true);
			}
		} else if (event.type === "tool-start") {
			setAiActivity({ kind: "tool", toolName: event.toolName, args: event.args, startedAt: Date.now() });
			const args = event.args === undefined ? "" : ` ${formatToolArgs(event.args)}`;
			const block = renderResult({ type: "text", content: `→ ${event.toolName ?? "tool"}${args}` }, scheme, innerW);
			if (block) appendBlock(block, true, true);
		} else if (event.type === "tool-end") {
			setAiActivity({ kind: "thinking", startedAt: Date.now() });
			if (!event.isError && event.toolName === "hise_research") {
				const text = extractToolResultText(event.result);
				if (text) {
					const resultBlock = renderResult({ type: "markdown", content: `### Documentation research\n\n${text}` }, scheme, innerW);
					if (resultBlock) appendBlock(resultBlock);
				}
			}
			if (!event.isError && event.toolName === "hise_script") {
				const details = event.result && typeof event.result === "object" && "details" in event.result
					? (event.result as { details?: { diff?: string } }).details
					: undefined;
				if (details?.diff) {
					const diffBlock = renderResult({ type: "markdown", content: `\`\`\`diff\n${details.diff}\n\`\`\`` }, scheme, innerW);
					if (diffBlock) appendBlock(diffBlock);
				}
			}
			const block = event.isError
				? renderResult({ type: "error", message: formatToolFailure(event.toolName, event.result) }, scheme, innerW)
				: renderResult({ type: "text", content: `✓ ${event.toolName ?? "tool"}` }, scheme, innerW);
			if (block) appendBlock(block, true, true);
		} else if (event.type === "assistant" && event.text) {
			const block = renderResult({ type: "text", content: event.text }, scheme, innerW);
			if (block) appendBlock(block);
		} else if (event.type === "settled") {
			setAiRunning(false);
			setAiActivity(null);
		} else if (event.type === "error") {
			setAiRunning(false);
			setAiActivity(null);
			const block = renderResult({ type: "error", message: event.error ?? "AI request failed" }, scheme, innerW);
			if (block) appendBlock(block);
		}
	}, [appendBlock, innerW, scheme]);

	const ensureAiSession = useCallback(async (): Promise<TuiAiSession | null> => {
		if (!connection) return null;
		const projectDir = session.projectFolder ?? process.cwd();
		if (aiSessionRef.current && aiProjectRef.current === projectDir) return aiSessionRef.current;
		// Project discovery is asynchronous and may change cwd after the first
		// /ai entry. Rebuilding the Pi adapter must not reset the user's active
		// model to the first available provider.
		const previousModel = aiSessionRef.current?.hasModel ? aiSessionRef.current.modelLabel : undefined;
		const previousThinkingLevel = aiSessionRef.current?.hasModel
			? aiSessionRef.current.thinkingLevel as AiThinkingLevel
			: undefined;
		aiSessionRef.current?.dispose();
		const ai = new TuiAiSession({
			connection,
			dataLoader,
			projectDir,
			model: previousModel,
			thinkingLevel: previousThinkingLevel,
			onEvent: aiEventHandler,
		});
		await ai.start();
		aiSessionRef.current = ai;
		aiProjectRef.current = projectDir;
		setAiModel(ai.modelDisplayLabel);
		setAiModels(ai.modelChoices);
		setAiSessions(await ai.sessionChoices());
		return ai;
	}, [aiEventHandler, connection, dataLoader, session]);

	const handleAiPrompt = useCallback(async (prompt: string) => {
		const ai = await ensureAiSession();
		if (!ai) {
			const block = renderResult({ type: "error", message: "AI mode requires an active HISE connection." }, scheme, innerW);
			if (block) appendBlock(block);
			return;
		}
		if (!ai.hasModel) {
			setAiRunning(false);
			providerWizardFormRef.current = "login";
			setWizardForm(createInitialFormState(createLoginWizard(ai.providerChoices), {}));
			return;
		}
		appendBlock(renderEcho(prompt, brand.signal, scheme.backgrounds.raised, innerW), false);
		setAiActivity({ kind: "thinking", startedAt: Date.now() });
		setAiRunning(true);
		setAiModel(ai.modelDisplayLabel);
		await ai.prompt(prompt);
	}, [appendBlock, ensureAiSession, innerW, scheme]);

	const handleResearch = useCallback(async (query: string) => {
		const ai = await ensureAiSession();
		if (!ai) {
			const block = renderResult({ type: "error", message: "Research requires an active HISE connection." }, scheme, innerW);
			if (block) appendBlock(block);
			return;
		}
		appendBlock(renderEcho(`/research ${query}`, brand.signal, scheme.backgrounds.raised, innerW), false);
		setAiActivity({ kind: "tool", toolName: "Research", args: { query: "starting" }, startedAt: Date.now() });
		setAiRunning(true);
		try {
			const text = await ai.research(query, (progress) => {
				const detail = progress.detail ? ` · ${progress.detail}` : "";
				if (progress.type === "diagnostics") {
					const issues = progress.issues ?? [];
					const diagnosticsBlock = renderResult({
						type: "error",
						message: `${progress.label}${detail}\n${issues.map((issue) => `- ${issue}`).join("\n")}`,
					}, scheme, innerW);
					if (diagnosticsBlock) appendBlock(diagnosticsBlock);
					return;
				}
				if (progress.type === "start") {
					setAiActivity({
						kind: "tool",
						toolName: `Research · ${progress.label}`,
						args: progress.detail ? { query: progress.detail } : undefined,
						startedAt: Date.now(),
					});
					return;
				}
				const marker = progress.ok === false ? "✗" : "✓";
				const elapsed = formatElapsed(progress.elapsedMs ?? 0);
				const progressBlock = renderResult({ type: "text", content: `${marker} ${progress.label}${detail} · ${elapsed}` }, scheme, innerW);
				if (progressBlock) appendBlock(progressBlock, true, true);
			});
			const block = renderResult({ type: "text", content: text }, scheme, innerW);
			if (block) appendBlock(block);
		} catch (error) {
			appendBlock(renderError(error instanceof Error ? error.message : String(error), undefined, scheme.foreground.muted, innerW));
		} finally {
			setAiRunning(false);
			setAiActivity(null);
		}
	}, [appendBlock, ensureAiSession, innerW, scheme]);

	useEffect(() => () => { aiSessionRef.current?.dispose(); }, []);

	// Observer: HTTP server receives async events from the CLI runner
	// (LLM-triggered commands) and commits annotated blocks to scrollback.
	const observerCtxRef = useRef({ scheme, innerW, treePanelVisible });
	observerCtxRef.current = { scheme, innerW, treePanelVisible };

	const handleObserverEvent = useCallback((event: ObserverEvent) => {
		const { scheme: s, innerW: w, treePanelVisible: panelOpen } = observerCtxRef.current;

		if (event.type === "command.start") {
			const accent = MODE_ACCENTS[event.mode as keyof typeof MODE_ACCENTS] || s.foreground.default;
			appendBlock(
				renderEcho(event.command, accent, s.backgrounds.raised, w, undefined, {
					prefix: "[LLM] ",
					prefixColor: s.foreground.muted,
				}),
				false,
			);
			return;
		}

		if (event.type === "command.progress") {
			const parts = [event.phase, event.percent !== undefined ? `${event.percent}%` : undefined, event.message]
				.filter(Boolean)
				.join(" ");
			if (parts) {
				const block = renderResult({ type: "text", content: parts }, s, w);
				if (block) appendBlock(block);
			}
			return;
		}

		const block = renderResult(event.result, s, w);
		if (block) appendBlock(block);

		// command.end — external CLI call mutated HISE state. Invalidate
		// every cached tree so the panel and `show tree` reflect changes.
		// If the panel is open, eagerly refetch the active mode's tree.
		if (event.type === "command.end") {
			session.invalidateAllTrees();
			if (panelOpen) {
				const active = session.currentMode();
				if (active.onEnter) {
					void active.onEnter(session).then(() => bumpModeRender()).catch(() => { /* best-effort */ });
				} else {
					bumpModeRender();
				}
			} else {
				bumpModeRender();
			}
		}
	}, [appendBlock, session, bumpModeRender]);

	useEffect(() => {
		const server = startObserverServer(handleObserverEvent);
		return () => {
			server.close();
		};
	}, [handleObserverEvent]);

	useEffect(() => {
		if (!connection) {
			setConnectionStatus("error");
			return;
		}
		let cancelled = false;
		const probe = async () => {
			try {
				const alive = await connection.probe();
				if (cancelled) return;
				setConnectionStatus(alive ? "connected" : "error");
				if (alive && !session.projectFolder) {
					try {
						const resp = await connection.get("/api/status");
						const data = resp as unknown as Record<string, unknown>;
						if (data.success && data.project && typeof data.project === "object") {
							const proj = data.project as Record<string, unknown>;
							const name = typeof proj.name === "string" ? proj.name : undefined;
							const folder = typeof proj.projectFolder === "string" ? proj.projectFolder : undefined;
							if (name) session.projectName = name;
							if (folder) {
								session.projectFolder = folder;
								void session.refreshScriptFileCache();
							}
							if (typeof data.activeIsSnippetBrowser === "boolean") {
								session.playgroundActive = data.activeIsSnippetBrowser;
							}
							if (!cancelled) bumpModeRender();
						}
					} catch { /* project info optional */ }
				}
				if (!alive && !session.projectFolder && session.resolveHiseProjectFolder) {
					try {
						const folder = await session.resolveHiseProjectFolder();
						if (folder && !cancelled) {
							session.projectFolder = folder;
							void session.refreshScriptFileCache();
							bumpModeRender();
						}
					} catch { /* ignore */ }
				}
			} catch {
				if (!cancelled) setConnectionStatus("error");
			}
		};
		void probe();
		const id = setInterval(probe, 5000);
		return () => { cancelled = true; clearInterval(id); };
	}, [connection, session, bumpModeRender]);

	const acceptCompletion = useCallback((item: CompletionItem, result: CompletionResult) => {
		const handle = inputHandleRef.current;
		if (!handle) return;
		const current = handle.getValue();
		const insertText = item.insertText ?? item.label;
		const newValue = current.slice(0, result.from) + insertText + current.slice(result.to);
		handle.setValue(newValue);
		handle.setCursorAt(result.from + insertText.length);
		setCompletionState(null);
	}, []);

	const handleInputValueChange = useCallback((value: string, cursorPos: number) => {
		if (value.length < 1) {
			setCompletionState(null);
			return;
		}

		// AI prefix `?<request>` — suppress completion entirely.
		if (!multilineModeRef.current && value.trimStart().startsWith("?")) {
			setCompletionState(null);
			return;
		}

		let result: CompletionResult;
		if (multilineModeRef.current) {
			const { line: lineIdx, col } = offsetToLineCol(value, cursorPos);
			const lines = value.split("\n");
			const lineText = lines[lineIdx] ?? "";
			const trimmed = lineText.trim();
			if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//")) {
				setCompletionState(null);
				return;
			}
			if (col < lineText.length) {
				setCompletionState(null);
				return;
			}
			let lineResult: CompletionResult;
			if (lineText.startsWith("/")) {
				lineResult = session.complete(lineText, col);
			} else {
				const modeMap = buildModeMap(lines);
				const entry = modeMap[lineIdx];
				if (entry && entry.modeId !== "root") {
					try {
						const mode = session.getOrCreateMode(entry.modeId);
						if (mode.complete) {
							lineResult = mode.complete(lineText, col);
						} else {
							setCompletionState(null);
							return;
						}
					} catch {
						setCompletionState(null);
						return;
					}
				} else {
					lineResult = session.complete(lineText, col);
				}
			}
			const lineStart = lineColToOffset(value, lineIdx, 0);
			result = {
				...lineResult,
				from: lineResult.from + lineStart,
				to: lineResult.to + lineStart,
			};
		} else {
			if (cursorPos < value.length) {
				setCompletionState(null);
				return;
			}
			result = aiActive && value.startsWith("/")
				? completeAiSlash(value, cursorPos, aiModels, aiSessions)
				: session.complete(value, cursorPos);
		}

		if (result.items.length > 0) {
			const token = value.slice(result.from);
			if (token.length > 0 && result.items.some(item => (item.insertText ?? item.label) === token)) {
				setCompletionState(null);
				return;
			}
			setCompletionState({ result, selectedIndex: 0 });
		} else {
			setCompletionState(null);
		}
	}, [session, aiActive, aiModels, aiSessions]);

	const handleTab = useCallback(() => {
		if (!completionState) {
			const value = inputHandleRef.current?.getValue() ?? "";
			if (value.length === 0) return;
			const result = aiActive && value.startsWith("/")
				? completeAiSlash(value, value.length, aiModels, aiSessions)
				: session.complete(value, value.length);
			if (result.items.length === 1) {
				acceptCompletion(result.items[0]!, result);
			} else if (result.items.length > 1) {
				setCompletionState({ result, selectedIndex: 0 });
			}
			return;
		}
		const item = completionState.result.items[completionState.selectedIndex];
		if (item) acceptCompletion(item, completionState.result);
	}, [completionState, session, acceptCompletion]);

	const handleEscape = useCallback(() => {
		if (completionState) {
			setCompletionState(null);
			return;
		}
		const handle = inputHandleRef.current;
		if (!handle) return;
		const value = handle.getValue();
		const cursorPos = handle.getCursorPos();
		const query = (value.length === 0 && session.currentModeId === "root") ? "/" : value;
		const qCursor = (value.length === 0 && session.currentModeId === "root") ? 1 : cursorPos;
		const result = aiActive && query.startsWith("/")
			? completeAiSlash(query, qCursor, aiModels, aiSessions)
			: session.complete(query, qCursor);
		if (result.items.length > 0) {
			setCompletionState({ result, selectedIndex: 0 });
		}
	}, [completionState, session]);

	// Wizard progress: render each event as a one-line scrollback block.
	// Wired once into session.onWizardProgress below — this is the sole sink
	// for wizard streaming output in the TUI (CLI uses stderr).
	useEffect(() => {
		const dim = fgHex(scheme.foreground.muted);
		const warn = fgHex("#FFBA00");
		const err = fgHex("#BB3434");
		const ok = fgHex("#4E8E35");
		const accent = fgHex(scheme.foreground.default);
		const bold = "\x1b[1m";

		const pushLine = (line: string) => {
			const wrapped = wrapAnsi(line, innerW);
			// compact=true: single newline between progress lines, no leading/trailing
			// blank that the default block padding inserts.
			appendBlock({ lines: wrapped, height: wrapped.length }, true, true);
		};

		session.onWizardProgress = (progress) => {
			if (progress.message?.startsWith("__heading__")) {
				const heading = progress.message.slice("__heading__".length);
				pushLine(`${bold}${accent}${heading}${RESET}`);
				return;
			}
			if (!progress.message) return;
			const msg = progress.message;
			let line: string;
			if (msg.startsWith("✗ ")) line = `${err}✗ ${msg.slice(2)}${RESET}`;
			else if (msg.startsWith("⚠ ")) line = `${warn}⚠ ${msg.slice(2)}${RESET}`;
			else if (msg.startsWith("✓ ")) line = `${ok}✓ ${msg.slice(2)}${RESET}`;
			else line = `${dim}${msg}${RESET}`;
			pushLine(line);
		};
		return () => { session.onWizardProgress = undefined; };
	}, [session, scheme, innerW, appendBlock]);

	const handleEditCommand = useCallback(async (raw: string): Promise<boolean> => {
		const trimmed = raw.trim();
		if (trimmed !== "/edit" && !trimmed.startsWith("/edit ")) return false;
		let arg = trimmed.slice("/edit".length).trim();
		if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
			arg = arg.slice(1, -1);
		}
		const handle = inputHandleRef.current;
		if (arg && session.loadScriptFile) {
			try {
				const content = await session.loadScriptFile(arg);
				if (handle) singleLineContentRef.current = handle.getValue();
				setEditorFilePath(arg);
				setMultilineMode(true);
				if (handle) handle.setValue(content.replace(/\r\n/g, "\n").trimEnd());
				setEditorValueVersion(v => v + 1);
			} catch (err: unknown) {
				const errCode = (err as { code?: string })?.code;
				if (errCode === "ENOENT" && session.saveScriptFile) {
					try {
						await session.saveScriptFile(arg, "");
						if (handle) singleLineContentRef.current = handle.getValue();
						setEditorFilePath(arg);
						setMultilineMode(true);
						if (handle) handle.setValue("");
						setEditorValueVersion(v => v + 1);
					} catch (saveErr) {
						appendBlock(renderError(
							`Failed to create "${arg}": ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
							undefined, scheme.foreground.muted, innerW,
						));
					}
				} else {
					appendBlock(renderError(
						`Failed to load "${arg}": ${err instanceof Error ? err.message : String(err)}`,
						undefined, scheme.foreground.muted, innerW,
					));
				}
			}
		} else {
			if (handle) singleLineContentRef.current = handle.getValue();
			setMultilineMode(true);
			if (handle) handle.setValue(editorContentRef.current);
			setEditorValueVersion(v => v + 1);
		}
		return true;
	}, [session, scheme, innerW, appendBlock]);

	const submitScript = useCallback(async (source: string) => {
		disabledRef.current = true;
		setDisabled(true);
		try {
			const { parseScript } = await import("../engine/run/parser.js");
			const { validateScript, formatValidationReport } = await import("../engine/run/validator.js");
			const { executeScript } = await import("../engine/run/executor.js");

			setEditorErrorLines(undefined);

			if (editorFilePath && session.saveScriptFile) {
				try {
					await session.saveScriptFile(editorFilePath, source);
				} catch (err) {
					appendBlock(renderError(
						`Save failed: ${err instanceof Error ? err.message : String(err)}`,
						undefined, scheme.foreground.muted, innerW,
					));
					return;
				}
			}

			const script = parseScript(source);
			const validation = validateScript(script, session);
			if (!validation.ok) {
				if (validation.errors.length > 0) {
					setEditorErrorLines(validation.errors.map(e => e.line));
				}
				appendBlock(renderError(
					formatValidationReport(validation),
					undefined, scheme.foreground.muted, innerW,
				));
				return;
			}

			const echoText = editorFilePath
				? `Execute script "${editorFilePath.split(/[\\/]/).pop()}"`
				: source;
			const echoBlock = renderEcho(echoText, scheme.foreground.muted, scheme.backgrounds.raised, innerW);
			appendBlock(echoBlock, false);

			const result = await executeScript(script, session);
			if (result.error) {
				setEditorErrorLines([result.error.line]);
			}
			appendBlock(formatScriptLog(source, result, scheme));
			const hr = fgHex(scheme.foreground.muted) + "─".repeat(columns) + RESET;
			appendBlock({ lines: [hr], height: 1 }, false);

			// Script may have mutated module/component/dsp state — invalidate
			// every cached tree so cross-mode panels (or `show tree`) refetch
			// on next access.
			session.invalidateAllTrees();
			if (treePanelVisible) {
				const active = session.currentMode();
				if (active.onEnter) {
					try { await active.onEnter(session); } catch { /* refetch best-effort */ }
				}
			}
			bumpModeRender();
		} catch (err) {
			appendBlock(renderError(
				`Script error: ${err instanceof Error ? err.message : String(err)}`,
				undefined, scheme.foreground.muted, innerW,
			));
		} finally {
			disabledRef.current = false;
			setDisabled(false);
		}
	}, [session, scheme, innerW, columns, appendBlock, editorFilePath, treePanelVisible, bumpModeRender]);

	const validateAndSaveScript = useCallback(async (source: string) => {
		const { parseScript } = await import("../engine/run/parser.js");
		const { validateScript, formatValidationReport } = await import("../engine/run/validator.js");
		const { dryRunScript } = await import("../engine/run/executor.js");

		setEditorErrorLines(undefined);

		const script = parseScript(source);
		const staticResult = validateScript(script, session);
		if (!staticResult.ok) {
			setEditorErrorLines(staticResult.errors.map(e => e.line));
			const block = renderResult({ type: "error", message: formatValidationReport(staticResult) }, scheme, innerW);
			if (block) appendBlock(block);
			return;
		}

		if (session.connection) {
			const liveResult = await dryRunScript(script, session);
			if (!liveResult.ok) {
				setEditorErrorLines(liveResult.errors.map(e => e.line));
				const block = renderResult({ type: "error", message: formatValidationReport(liveResult) }, scheme, innerW);
				if (block) appendBlock(block);
				return;
			}
		}

		if (editorFilePath && session.saveScriptFile) {
			try {
				await session.saveScriptFile(editorFilePath, source);
				const block = renderResult({ type: "text", content: `Validation passed — saved "${editorFilePath.split(/[\\/]/).pop()}"` }, scheme, innerW);
				if (block) appendBlock(block);
			} catch (err) {
				appendBlock(renderError(
					`Save failed: ${err instanceof Error ? err.message : String(err)}`,
					undefined, scheme.foreground.muted, innerW,
				));
			}
		} else {
			const block = renderResult({ type: "text", content: "Validation passed — no errors found." }, scheme, innerW);
			if (block) appendBlock(block);
		}
	}, [session, scheme, innerW, appendBlock, editorFilePath]);

	const runAiPredict = useCallback(async (nl: string) => {
		const mode = session.currentMode();
		if (!isAiCapableMode(mode.id)) {
			setAiPreview({
				nl,
				pending: false,
				preludeError: `AI prediction available in builder/ui/dsp modes only (current: ${mode.id || "root"}).`,
			});
			disabledRef.current = true;
			setDisabled(true);
			return;
		}
		aiAbortRef.current?.abort();
		const ctl = new AbortController();
		aiAbortRef.current = ctl;
		setAiPreview({ nl, pending: true });
		disabledRef.current = true;
		setDisabled(true);
		try {
			const tree = mode.getTree?.() ?? null;
			const moduleList = session.getModuleList?.();
			const componentProperties = session.getComponentProperties?.();
			const outcome = await runAiPrediction({
				mode: mode.id,
				tree,
				nl,
				signal: ctl.signal,
				moduleList,
				componentProperties,
			});
			if (ctl.signal.aborted) return;
			setAiPreview({ nl, pending: false, outcome });
		} catch (e) {
			if (ctl.signal.aborted) return;
			setAiPreview({
				nl,
				pending: false,
				preludeError: e instanceof Error ? e.message : String(e),
			});
		}
	}, [session]);

	const handleSubmit = useCallback(async (input: string) => {
		if (input.trim().length === 0) return;
		setCompletionState(null);

		if (!multilineModeRef.current && input.trim().startsWith("/research ")) {
			const query = input.trim().slice("/research ".length).trim();
			if (query) await handleResearch(query);
			return;
		}
		if (!multilineModeRef.current && input.trim() === "/ai") {
			const ai = await ensureAiSession();
			if (!ai) {
				const block = renderResult({ type: "error", message: "AI mode requires an active HISE connection." }, scheme, innerW);
				if (block) appendBlock(block);
				return;
			}
			setAiActive(true);
			setAiModel(ai.modelDisplayLabel);
			setAiStats(ai.stats);
			if (!ai.hasModel) {
				providerWizardFormRef.current = "login";
				setWizardForm(createInitialFormState(createLoginWizard(ai.providerChoices), {}));
			}
			return;
		}
		if (!multilineModeRef.current && input.trim().startsWith("/ai ")) {
			setAiActive(true);
			await handleAiPrompt(input.trim().slice(4).trim());
			return;
		}
		if (!multilineModeRef.current && aiActive) {
			const aiCommand = input.trim();
			if (aiCommand === "/login") {
				const ai = await ensureAiSession();
				if (!ai) return;
				providerWizardFormRef.current = "login";
				setWizardForm(createInitialFormState(createLoginWizard(ai.providerChoices), {}));
				return;
			}
			if (aiCommand === "/stop") {
				setAiRunning(false);
				setAiActivity(null);
				aiSessionRef.current?.abort();
				return;
			}
			if (aiCommand === "/exit") {
				setAiActive(false);
				return;
			}
			if (aiCommand === "/clear") {
				const ai = aiSessionRef.current;
				if (ai) {
					await ai.clear();
					setAiStats(ai.stats);
					setAiModel(ai.modelDisplayLabel);
					setAiModels(ai.modelChoices);
					setAiSessions(await ai.sessionChoices());
				}
				setCommitted([]);
				const block = renderResult({ type: "text", content: "New session started" }, scheme, innerW);
				if (block) appendBlock(block);
				return;
			}
			if (aiCommand === "/nuke") {
				const ai = aiSessionRef.current;
				if (ai) {
					await ai.nukeModelConfig();
					setAiStats(ai.stats);
					setAiModel(ai.modelDisplayLabel);
					setAiModels(ai.modelChoices);
				}
				appendBlock(renderResult({
					type: "text",
					content: "Removed embedded AI credentials, custom models, model defaults, and catalog cache. Saved conversations were kept.",
				}, scheme, innerW)!);
				return;
			}
			if (aiCommand === "/model" || aiCommand.startsWith("/model ")) {
				const modelId = aiCommand.slice("/model".length).trim();
				if (!modelId) {
					const ai = await ensureAiSession();
					const models = ai ? await ai.refreshModels() : [];
					if (!ai || models.length === 0) {
						appendBlock(renderResult({ type: "text", content: `Current model: ${aiModel}\n\nNo authenticated models available. Use /login to configure one.` }, scheme, innerW)!);
					} else {
						setAiModels(models);
						providerWizardFormRef.current = "model";
						const selectedModel = models.includes(ai.modelLabel) ? ai.modelLabel : models[0]!;
						setWizardForm(createInitialFormState(createModelPicker(models, ai.getAvailableThinkingLevels(selectedModel), selectedModel, ai.thinkingLevel), {}));
					}
				} else {
					appendBlock(renderError("/model does not take arguments; choose a model in the selector.", undefined, scheme.foreground.muted, innerW));
				}
				return;
			}
			if (aiCommand === "/sessions" || aiCommand.startsWith("/sessions ")) {
				const sessionId = aiCommand.slice("/sessions".length).trim();
				try {
					if (sessionId) {
						await aiSessionRef.current?.openSession(sessionId);
						setAiModel(aiSessionRef.current?.modelDisplayLabel ?? aiModel);
					} else {
						const sessions = await aiSessionRef.current?.sessionChoices() ?? [];
						const text = sessions.length === 0 ? "No saved AI sessions." : sessions.map((item) => `${item.id}  ${item.detail ?? item.label}`).join("\\n");
						appendBlock(renderResult({ type: "text", content: text }, scheme, innerW)!);
					}
				} catch (error) {
					appendBlock(renderError(error instanceof Error ? error.message : String(error), undefined, scheme.foreground.muted, innerW));
				}
				return;
			}
			if (aiCommand === "/help") {
				const block = renderResult({ type: "markdown", content: generateAiHelp().content }, scheme, innerW);
				if (block) appendBlock(block);
				return;
			}
			if (aiCommand.startsWith("/")) {
				setAiActive(false);
				// Fall through to the normal HISE slash-command pipeline.
			} else {
				await handleAiPrompt(input);
				return;
			}
		}

		// AI prefix `?<request>` — run intent pipeline, show confirmation block
		if (!multilineModeRef.current && input.trim().startsWith("?")) {
			const nl = input.trim().slice(1).trim();
			if (nl.length === 0) return;
			await runAiPredict(nl);
			return;
		}

		// Multiline submit → execute script (no /edit detection here)
		if (multilineModeRef.current) {
			await submitScript(input);
			return;
		}

		// /edit toggles multiline
		if (await handleEditCommand(input)) return;

		const mode = session.currentMode();
		const currentAccent = mode.accent;
		const echoSpans = mode.tokenizeInput?.(input);

		disabledRef.current = true;
		setDisabled(true);

		try {
			const result: CommandResult = await session.handleInput(input);
			const accent = result.accent || currentAccent || scheme.foreground.default;

			const echoBlock = renderEcho(input, accent, scheme.backgrounds.raised, innerW, echoSpans);

			if (result.type === "wizard") {
				if (session.pendingWizard) session.clearPendingWizard();
				// Show wizard immediately with stub state so ephemeral live
				// region transitions away from the input box BEFORE init
				// awaits — prevents Ink from leaking stale input + status
				// rows into scrollback during the await gap.
				const stubState = createInitialFormState(result.definition, result.prefill);
				setWizardForm(stubState);
				appendBlock(echoBlock, false);
				const executor = new WizardExecutor({
					connection: session.connection,
					handlerRegistry: session.handlerRegistry,
				});
				let initDefaults: import("../engine/wizard/types.js").InitDefaultsResult;
				try {
					initDefaults = await executor.initialize(result.definition);
				} catch (e: unknown) {
					if (e instanceof WizardInitAbortError) {
						setWizardForm(null);
						appendBlock(renderError(e.message, undefined, scheme.foreground.muted, innerW));
						return;
					}
					throw e;
				}
				const mergedDef = mergeInitDefaults(result.definition, initDefaults);
				const formState = createInitialFormState(mergedDef, result.prefill);
				setWizardForm(formState);
			} else if (result.type === "run-report") {
				appendBlock(echoBlock, false);
				const { formatRunReport } = await import("../engine/run/executor.js");
				const summary = formatRunReport(result.runResult, result.verbosity);
				const rendered = renderResult({ type: "text", content: summary }, scheme, innerW);
				if (rendered) appendBlock(rendered);
			} else if (result.type === "empty" && input.trim() === "/clear") {
				setCommitted([]);
			} else if (result.type !== "empty") {
				appendBlock(echoBlock, false);
				const rendered = renderResult(result, scheme, innerW);
				if (rendered) appendBlock(rendered);
			} else {
				appendBlock(echoBlock, false);
			}

			if (session.shouldQuit) {
				gracefulExit();
				return;
			}

			// Cross-mode mutations (e.g. /script setting Component visibility)
			// invalidate every cached tree. If the tree panel is open, eagerly
			// refetch the active mode's tree so the panel renders fresh data
			// on the next paint. Otherwise fetch lazily on next parse.
			session.invalidateAllTrees();
			if (treePanelVisible) {
				const active = session.currentMode();
				if (active.onEnter) {
					try { await active.onEnter(session); } catch { /* refetch best-effort */ }
				}
			}
			bumpModeRender();
		} catch (err) {
			appendBlock(renderError(
				`Error: ${err instanceof Error ? err.message : String(err)}`,
				undefined, scheme.foreground.muted, innerW,
			));
		} finally {
			disabledRef.current = false;
			setDisabled(false);
		}
	}, [session, scheme, innerW, appendBlock, exit, bumpModeRender, treePanelVisible, aiActive, ensureAiSession, handleAiPrompt, handleResearch]);

	useInput((input, key) => {
		// DECSET 1004 focus reports: terminal emits \x1b[I / \x1b[O.
		// Stdin listener (in focus effect above) stamps timestamp; we
		// swallow the corresponding ESC + "[I"/"[O" events here.
		if (input === "[I" || input === "[O") return;
		if (key.escape && Date.now() - focusSeqTimestampRef.current < 50) return;

		// Stable bottom region: capture popup height on Enter, clear on
		// any other keystroke. Single-line mode only; multiline editor's
		// Enter inserts newline so it doesn't dismiss popup.
		if (!multilineModeRef.current && !wizardFormRef.current && !wizardActive) {
			if (key.return && completionState) {
				const itemRows = Math.min(completionState.result.items.length, COMPACT.completionMaxVisible);
				const headerRows = completionState.result.label ? 1 : 0;
				setFrozenPopupRows(itemRows + headerRows);
			} else if (frozenPopupRows > 0) {
				setFrozenPopupRows(0);
			}
		}

		// Wizard active: Esc aborts the run via the session-tracked controller.
		if (session.activeWizard) {
			if (key.escape) session.activeWizardAbort?.abort();
			return;
		}
		if (aiRunning && key.escape) {
			setAiRunning(false);
			setAiActivity(null);
			aiSessionRef.current?.abort();
			return;
		}

		// Wizard form active — route to wizard key handler
		if (wizardFormRef.current) {
			const result = handleWizardKey(wizardFormRef.current, input, key);
			if (!result) return;
			if (result.action === "cancel") {
				providerWizardFormRef.current = false;
				const form = wizardFormRef.current;
				const deactivated = { ...form, active: false };
				appendBlock(renderWizardBlock(deactivated, scheme, innerW, { flat: true }));
				appendBlock({ lines: [`${fgHex(scheme.foreground.muted)}Wizard cancelled.${RESET}`], height: 1 });
				setWizardForm(null);
				return;
			}
			if (result.action === "submit") {
				const form = wizardFormRef.current;
				if (form && providerWizardFormRef.current) {
					const wizardKind = providerWizardFormRef.current;
					providerWizardFormRef.current = false;
					setWizardForm(null);
					void (async () => {
						try {
							const ai = await ensureAiSession();
							if (!ai) throw new Error("AI mode requires an active HISE connection.");
							if (wizardKind === "login") {
								const provider = form.answers.provider;
								const apiKey = form.answers.apiKey;
								if (!provider || !apiKey) throw new Error("Provider and API key are required");
								if (provider === "custom") {
									await ai.addProvider({ id: form.answers.newId ?? "", baseUrl: form.answers.baseUrl ?? "", apiKey, modelId: form.answers.newModelId ?? "" });
									setAiModel(ai.modelDisplayLabel);
									appendBlock(renderResult({ type: "text", content: `Added provider and selected ${ai.modelDisplayLabel}.` }, scheme, innerW)!);
								} else {
									await ai.configureApiKey(provider, apiKey);
									setAiModels(ai.modelChoices);
									appendBlock(renderResult({ type: "text", content: `Authentication configured for ${provider}. Use /model to select a model.` }, scheme, innerW)!);
								}
								return;
							}
							if (wizardKind === "model") {
								const modelId = form.answers.modelId;
								if (!modelId) throw new Error("Select a model");
								await ai.selectModel(modelId, (form.answers.thinkingLevel ?? "off") as AiThinkingLevel);
								setAiModel(ai.modelDisplayLabel);
								appendBlock(renderResult({ type: "text", content: `Selected ${ai.modelDisplayLabel}.` }, scheme, innerW)!);
							}
						} catch (error) {
							appendBlock(renderError(error instanceof Error ? error.message : String(error), undefined, scheme.foreground.muted, innerW));
						}
					})();
					return;
				}
				const deactivated = { ...form, active: false };
				appendBlock(renderWizardBlock(deactivated, scheme, innerW, { flat: true }));
				setWizardForm(null);
				// Dispatch through the same path as a typed `/wizard run <id> with K=V`
				// so progress streaming and result handling go through the unified pipe.
				const withClause = formatWithClause(result.answers);
				const command = withClause
					? `/wizard run ${form.definition.id} with ${withClause}`
					: `/wizard run ${form.definition.id}`;
				void session.handleInput(command).then((res) => {
					if (res.type === "empty") return;
					const rendered = renderResult(res, scheme, innerW);
					if (rendered) appendBlock(rendered);
				});
				return;
			}
			let newState = refreshWizardModelField(result.state, (modelId) => aiSessionRef.current?.getAvailableThinkingLevels(modelId) ?? ["off"]);
			if (result.recomputeCompletions) {
				const def = newState.definition;
				const tab = def.tabs[newState.activeTab];
				const field = tab?.fields[newState.activeField];
				if (field?.type === "file") {
					const value = newState.answers[field.id] ?? "";
					const completions = listPathCompletions(value, {
						directory: field.directory,
						wildcard: field.wildcard,
					});
					newState = { ...newState, completions, completionIndex: 0 };
				}
			}
			setWizardForm(newState);
			return;
		}

		// AI preview block active — capture confirm/cancel/retry keys
		// before the disabled-gate (preview always disables Input).
		if (aiPreviewRef.current) {
			const preview = aiPreviewRef.current;
			if (preview.pending) {
				if (key.escape) {
					aiAbortRef.current?.abort();
					setAiPreview(null);
					disabledRef.current = false;
					setDisabled(false);
				}
				return;
			}
			if (key.return) {
				const cmd = preview.outcome?.ok ? preview.outcome.result.command : null;
				setAiPreview(null);
				disabledRef.current = false;
				setDisabled(false);
				if (cmd) void handleSubmit(cmd);
				return;
			}
			if (key.escape) {
				setAiPreview(null);
				disabledRef.current = false;
				setDisabled(false);
				return;
			}
			if (input === "r" || input === "R") {
				void runAiPredict(preview.nl);
				return;
			}
			return;
		}

		if (disabledRef.current) return;

		// Ctrl+B — toggle live tree panel above input
		if (key.ctrl && input === "b") {
			setTreePanelVisible(v => !v);
			return;
		}

		if (completionState) {
			if (key.tab || key.return) {
				const item = completionState.result.items[completionState.selectedIndex];
				if (item) acceptCompletion(item, completionState.result);
				return;
			} else if (input === " " && !key.ctrl && !key.meta) {
				setCompletionState(null);
				// Fall through so space inserts as printable char
			} else if (key.upArrow) {
				const next = completionState.selectedIndex > 0
					? completionState.selectedIndex - 1
					: completionState.result.items.length - 1;
				setCompletionState({ ...completionState, selectedIndex: next });
				return;
			} else if (key.downArrow) {
				const next = completionState.selectedIndex < completionState.result.items.length - 1
					? completionState.selectedIndex + 1
					: 0;
				setCompletionState({ ...completionState, selectedIndex: next });
				return;
			} else if (key.escape) {
				setCompletionState(null);
				// In multiline, fall through so the editor's Esc-Esc
				// timestamp tracker still sees this keystroke. Single-line
				// consumes (popup-close is the only effect).
				if (!multilineModeRef.current) return;
			}
		}

		const handle = inputHandleRef.current;
		if (!handle) return;

		// ── Multiline-specific dispatch ─────────────────────────
		if (multilineModeRef.current) {
			// F5 — run script (HISE compile shortcut)
			if (f5PressedRef.current) {
				f5PressedRef.current = false;
				setCompletionState(null);
				handle.submit();
				return;
			}
			// F7 — validate + dry-run + save (no execution)
			if (f7PressedRef.current) {
				f7PressedRef.current = false;
				setCompletionState(null);
				const value = handle.getValue();
				void validateAndSaveScript(value);
				return;
			}
			// Ctrl+Enter → submit
			if (key.ctrl && key.return) {
				setCompletionState(null);
				handle.submit();
				return;
			}
			// Plain Enter → newline
			if (key.return) {
				setCompletionState(null);
				handle.insertChar("\n");
				setEditorValueVersion(v => v + 1);
				return;
			}
			// Esc Esc within 500ms → exit multiline
			if (key.escape) {
				const now = Date.now();
				if (escTimestampRef.current > 0 && (now - escTimestampRef.current) < 500) {
					escTimestampRef.current = 0;
					setCompletionState(null);
					editorContentRef.current = handle.getValue();
					setMultilineMode(false);
					setEditorErrorLines(undefined);
					handle.setValue("");
					setEditorValueVersion(v => v + 1);
					void session.refreshScriptFileCache();
				} else {
					escTimestampRef.current = now;
					handleEscape();
				}
				return;
			}
			// Up/Down navigate cursor by line
			if (key.upArrow) { handle.moveCursor("up", key.shift); return; }
			if (key.downArrow) { handle.moveCursor("down", key.shift); return; }
			// Home/End → line-level
			if (key.home) { handle.moveCursor("lineHome", key.shift); return; }
			if (key.end) { handle.moveCursor("lineEnd", key.shift); return; }
			// Cursor left/right
			if (key.leftArrow) { handle.moveCursor("left", key.shift); return; }
			if (key.rightArrow) { handle.moveCursor("right", key.shift); return; }
			// Backspace / Delete (forward)
			if (key.backspace || key.delete) {
				if (deleteForwardRef.current) {
					deleteForwardRef.current = false;
					handle.deleteForward();
				} else {
					handle.deleteBackward();
				}
				setEditorValueVersion(v => v + 1);
				return;
			}
			// Ctrl+A / Ctrl+Z / Ctrl+Y / Ctrl+C / Ctrl+D — same as single-line
			if (key.ctrl && input === "a") { handle.selectAll(); return; }
			if (key.ctrl && input === "z") { handle.undo(); setEditorValueVersion(v => v + 1); return; }
			if (key.ctrl && input === "y") { handle.redo(); setEditorValueVersion(v => v + 1); return; }
			if (key.ctrl && input === "c") {
				const sel = handle.getSelection();
				if (sel) process.stdout.write(`\x1b]52;c;${Buffer.from(sel.text).toString("base64")}\x07`);
				return;
			}
			if (key.tab) { handleTab(); return; }
			// Printable
			if (input && !key.ctrl && !key.meta) {
				if (input.charCodeAt(0) < 0x20 && input !== "\n") return;
				const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
				const cleaned = normalized.replace(/[^\n\x20-\x7e\x80-￿]/g, "");
				if (cleaned) {
					handle.insertChar(cleaned);
					setEditorValueVersion(v => v + 1);
				}
				return;
			}
			return;
		}

		if (key.return) {
			setCompletionState(null);
			handle.submit();
			return;
		}
		if (key.escape) {
			handleEscape();
			return;
		}
		if (key.ctrl && input === "a") { handle.selectAll(); return; }
		if (key.ctrl && input === "c") {
			const sel = handle.getSelection();
			if (sel) {
				process.stdout.write(`\x1b]52;c;${Buffer.from(sel.text).toString("base64")}\x07`);
			} else if (handle.getValue().length === 0) {
				gracefulExit();
			} else {
				handle.setValue("");
			}
			return;
		}
		if (key.ctrl && input === "d") {
			if (handle.getValue().length === 0) { gracefulExit(); return; }
			handle.deleteForward();
			return;
		}
		if (key.ctrl && input === "z") { handle.undo(); return; }
		if (key.ctrl && input === "y") { handle.redo(); return; }
		if (key.ctrl && input === "e") { handle.moveCursor("end"); return; }
		if (key.meta && key.leftArrow) { handle.moveCursor("home", key.shift); return; }
		if (key.meta && key.rightArrow) { handle.moveCursor("end", key.shift); return; }
		if (key.meta && input === "b") { handle.moveCursor("wordLeft"); return; }
		if (key.meta && input === "f") { handle.moveCursor("wordRight"); return; }
		if (key.home) { handle.moveCursor("home", key.shift); return; }
		if (key.end) { handle.moveCursor("end", key.shift); return; }
		if (key.upArrow) { handle.historyUp(); return; }
		if (key.downArrow) { handle.historyDown(); return; }
		if (key.leftArrow) { handle.moveCursor("left", key.shift); return; }
		if (key.rightArrow) { handle.moveCursor("right", key.shift); return; }
		if (key.backspace || key.delete) {
			if (deleteForwardRef.current) {
				deleteForwardRef.current = false;
				handle.deleteForward();
			} else {
				handle.deleteBackward();
			}
			return;
		}
		if (key.tab) { handleTab(); return; }
		if (input && !key.ctrl && !key.meta) {
			const code = input.charCodeAt(0);
			if (code < 0x20 || code === 0x7f) return;
			handle.insertChar(input);
		}
	});

	const treePanelText = useMemo<string | null>(() => {
		if (!treePanelVisible) return null;
		const mode = session.currentMode();
		if (!mode.getTree) return null;
		const tree = mode.getTree();
		if (!tree) return null;

		const path = mode.getSelectedPath?.() ?? [];
		const root: TreeNode = path.length > 0 ? (resolveNodeByPath(tree, path) ?? tree) : tree;
		const maxRows = Math.max(6, Math.floor(terminalRows / 2));
		const compact = (mode as { compactView?: boolean }).compactView === true;
		// Panel is rooted at PWD, so its first row IS the PWD — skip the
		// signal-colour highlight inside the tree (kept for `show tree`
		// command which renders the full tree). Only the breadcrumb's last
		// segment carries the PWD highlight here.
		const opts = { mutedColor: scheme.foreground.muted, compact };

		// Breadcrumb (always visible, prefixed with mode-specific tree
		// context label). Walks tree root → PWD; muted segments + signal
		// final segment.
		const dim = fgHex(scheme.foreground.muted);
		const sig = fgHex(brand.signal);
		const sep = `${dim} / ${RESET}`;
		const segs: string[] = [];
		segs.push((path.length === 0 ? sig : dim) + tree.label + RESET);
		let cur: TreeNode = tree;
		for (let i = 0; i < path.length; i++) {
			if (!cur.children) break;
			const lower = path[i]!.toLowerCase();
			const child = cur.children.find((c) => c.id?.toLowerCase() === lower);
			if (!child) break;
			const isLast = i === path.length - 1;
			segs.push((isLast ? sig : dim) + child.label + RESET);
			cur = child;
		}
		let prefix: string;
		if (mode.id === "builder") {
			prefix = "Module-Tree";
		} else if (mode.id === "ui") {
			prefix = `Component-Tree (${tree.label})`;
		} else if (mode.id === "dsp") {
			const ctxLabel = mode.contextLabel ?? "";
			const moduleId = ctxLabel.split("/")[0] ?? "";
			prefix = `DspNetwork Tree (${moduleId}.${tree.label})`;
		} else if (mode.id === "script") {
			prefix = `Script Symbol Tree (${tree.label})`;
		} else {
			prefix = "Tree";
		}
		const breadcrumb = `${dim}${prefix}: ${RESET}` + segs.join(sep);

		let lines = renderTreeBox(root, opts).split("\n");
		if (lines.length > maxRows) {
			lines = renderTreeBox(root, { ...opts, maxDepth: 1 }).split("\n");
		}
		if (lines.length > maxRows) {
			lines = [
				...lines.slice(0, maxRows - 1),
				`${dim}… +${lines.length - maxRows + 1} more rows${RESET}`,
			];
		}
		return [breadcrumb, "", ...lines].join("\n");
		// modeRenderTick: re-runs after every command (bumpModeRender fires post-submit).
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [treePanelVisible, modeRenderTick, columns, terminalRows, scheme, session]);

	const popupLeftOffset = useMemo(() => {
		if (!completionState) return 0;
		if (multilineMode) {
			// Multiline editor: gutter = horizontalPad + lineNumberWidth + indicator + space.
			// result.from is absolute; need column within the current line.
			const val = inputHandleRef.current?.getValue() ?? "";
			const lines = val.split("\n");
			const maxLineNum = Math.max(lines.length, editorMaxLines);
			const lineNumberWidth = String(maxLineNum).length;
			const gutterW = COMPACT.horizontalPad + lineNumberWidth + 2;
			const { line: lineIdx } = offsetToLineCol(val, completionState.result.from);
			const lineStart = lineColToOffset(val, lineIdx, 0);
			const lineRelFrom = completionState.result.from - lineStart;
			return Math.min(columns - 4, gutterW + lineRelFrom);
		}
		// Flat single-line prompt: "> " = 2 chars, no left pad
		const promptW = 2;
		const lineRel = completionState.result.from;
		return Math.min(columns - 4, promptW + lineRel);
	}, [completionState, columns, multilineMode, editorMaxLines]);

	const wizardBlockText = useMemo(() => {
		if (!wizardForm) return null;
		return renderWizardBlock(wizardForm, scheme, columns - 4, { flat: true }).lines.join("\n");
	}, [wizardForm, scheme, columns]);

	return (
		<>
			<Static items={committed}>
				{(block) => <Text key={block.id}>{block.text}</Text>}
			</Static>
			<Box flexDirection="column" width={columns} overflow="hidden">
				{wizardBlockText && (
					<Box
						flexDirection="column"
						width={columns}
						borderStyle="single"
						borderColor={terminalFocused ? brand.signal : scheme.foreground.muted}
						paddingX={1}
					>
						<Text>{wizardBlockText}</Text>
					</Box>
				)}
				{!wizardForm && !wizardActive && treePanelText && (
					<>
						<Text color={scheme.foreground.muted} wrap="truncate-end">{"─".repeat(columns)}</Text>
						<Text wrap="truncate-end">{treePanelText}</Text>
					</>
				)}
				{!wizardForm && !wizardActive && aiPreview && (
					<Box
						flexDirection="column"
						width={columns}
						borderStyle="single"
						borderColor={brand.signal}
						paddingX={1}
					>
						<Text color={scheme.foreground.muted}>{"? "}<Text color={scheme.foreground.default}>{aiPreview.nl}</Text></Text>
						{aiPreview.pending ? (
							<Text color={brand.signal}>{spinnerFrames[spinnerFrame]} thinking via {getProviderLabel()}…  <Text color={scheme.foreground.muted}>(esc cancel)</Text></Text>
						) : aiPreview.preludeError ? (
							<>
								<Text color={brand.error}>{aiPreview.preludeError}</Text>
								<Text color={scheme.foreground.muted}>esc dismiss</Text>
							</>
						) : aiPreview.outcome?.ok ? (
							<>
								<Text color={scheme.foreground.bright}>{"→ "}{aiPreview.outcome.result.command}</Text>
								<Text color={scheme.foreground.muted}>↵ execute   esc cancel   r retry   <Text color={scheme.foreground.muted}>({aiPreview.outcome.result.durationMs}ms via {getProviderLabel()})</Text></Text>
							</>
						) : aiPreview.outcome ? (
							<>
								<Text color={brand.error}>error: {aiPreview.outcome.error}</Text>
								<Text color={scheme.foreground.muted}>esc dismiss   r retry</Text>
							</>
						) : null}
					</Box>
				)}
				{!wizardForm && !wizardActive && aiRunning && aiActivity && (
					<Box paddingX={2}>
						<Text color={brand.signal}>{spinnerFrames[spinnerFrame]} </Text>
						<Text color={scheme.foreground.bright}>{formatAiActivity(aiActivity)}</Text>
						<Text color={scheme.foreground.muted}>  {formatElapsed(Date.now() - aiActivity.startedAt)} · esc cancel</Text>
					</Box>
				)}
				{!wizardForm && !wizardActive && (
					<Input
						modeLabel={multilineMode ? (editorFilePath?.split(/[\\/]/).pop() ?? "scratch") : (aiActive ? "ai" : "root")}
						modeAccent={modeAccent}
						contextLabel={multilineMode ? (editorFilePath ?? undefined) : undefined}
						columns={columns}
						disabled={disabled || aiRunning}
						focused={terminalFocused && !aiPreview}
						flat={!multilineMode}
						multiline={multilineMode}
						maxLines={editorMaxLines}
						errorLines={multilineMode ? editorErrorLines : undefined}
						onSubmit={(v) => { void handleSubmit(v); }}
						onValueChange={(value, cursorPos) => {
							if (multilineModeRef.current) {
								setEditorValueVersion(v => v + 1);
								if (editorErrorLines !== undefined) setEditorErrorLines(undefined);
							}
							handleInputValueChange(value, cursorPos);
						}}
						inputRef={inputHandleRef}
						tokenize={modeTokenizer}
					/>
				)}
				{(() => {
					if (wizardForm || wizardActive || multilineMode) return null;
					const popupScheme: ColorScheme = {
						...scheme,
						backgrounds: { ...scheme.backgrounds, overlay: undefined as unknown as string },
					};
					const dim = terminalFocused ? brand.signal : scheme.foreground.muted;
					const blank = " ".repeat(Math.max(1, columns));
					return (
						<Box flexDirection="column" width={columns}>
							{completionState ? (
								<CompletionPopup
									items={completionState.result.items}
									selectedIndex={completionState.selectedIndex}
									onSelect={(i) => setCompletionState((p) => p ? { ...p, selectedIndex: i } : null)}
									onAccept={(item) => acceptCompletion(item, completionState.result)}
									onDismiss={() => setCompletionState(null)}
									scheme={popupScheme}
									leftOffset={popupLeftOffset}
									label={completionState.result.label}
									maxVisible={COMPACT.completionMaxVisible}
									columns={columns}
								/>
							) : frozenPopupRows > 0 ? (
								Array.from({ length: frozenPopupRows }).map((_, i) => (
									<Text key={`frozen-${i}`}>{blank}</Text>
								))
							) : null}
							<Text>{" "}</Text>
							<StatusLine
								modeLabel={aiActive ? formatAiStatus(aiModel, aiRunning, aiStats) : modeLabel}
								modeAccent={modeAccent}
								contextLabel={contextLabel}
								connectionStatus={connectionStatus}
								columns={columns}
								scheme={scheme}
								projectName={session.projectName}
								projectFolder={session.projectFolder}
							/>
							<Text color={dim} wrap="truncate-end">{"─".repeat(columns)}</Text>
						</Box>
					);
				})()}
				{!wizardForm && !wizardActive && multilineMode && (
					<>
						{completionState && (
							<CompletionPopup
								items={completionState.result.items}
								selectedIndex={completionState.selectedIndex}
								onSelect={(i) => setCompletionState((p) => p ? { ...p, selectedIndex: i } : null)}
								onAccept={(item) => acceptCompletion(item, completionState.result)}
								onDismiss={() => setCompletionState(null)}
								scheme={scheme}
								leftOffset={popupLeftOffset}
								label={completionState.result.label}
								maxVisible={COMPACT.completionMaxVisible}
								columns={columns}
							/>
						)}
						<StatusLine
							modeLabel={aiActive ? formatAiStatus(aiModel, aiRunning, aiStats) : modeLabel}
							modeAccent={modeAccent}
							contextLabel={contextLabel}
							connectionStatus={connectionStatus}
							columns={columns}
							scheme={scheme}
						/>
					</>
				)}
				{(wizardForm || wizardActive) && (
					<StatusLine
						modeLabel={aiActive ? formatAiStatus(aiModel, aiRunning, aiStats) : modeLabel}
						modeAccent={modeAccent}
						contextLabel={contextLabel}
						connectionStatus={connectionStatus}
						columns={columns}
						scheme={scheme}
					/>
				)}
			</Box>
		</>
	);
}

const POPUP_RESERVED_ROWS = COMPACT.completionMaxVisible + 2;

interface StatusLineProps {
	modeLabel: string;
	modeAccent: string;
	contextLabel?: string;
	connectionStatus: ConnectionStatus;
	columns: number;
	scheme: ColorScheme;
	projectName?: string | null;
	projectFolder?: string | null;
}

export function formatAiStatus(model: string, running: boolean, stats?: TuiAiStats): string {
	const context = stats?.contextTokens !== undefined && stats.contextWindow
		? ` · ctx ${formatCount(stats.contextTokens)}/${formatCount(stats.contextWindow)}`
		: "";
	const tokens = stats && stats.total > 0 ? ` · ↑${formatCount(stats.input)} ↓${formatCount(stats.output)}` : "";
	const tools = stats && stats.toolCalls > 0 ? ` · ${stats.toolCalls} tools` : "";
	return `ai · ${model}${running ? " · working" : ""}${context}${tokens}${tools}`;
}

function formatCount(value: number): string {
	return value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : String(value);
}

export function formatAiActivity(activity: Pick<AiActivityState, "kind" | "toolName" | "args">): string {
	if (activity.kind === "thinking") return "Thinking…";
	const name = activity.toolName ?? "tool";
	const args = activity.args && typeof activity.args === "object" ? activity.args as Record<string, unknown> : undefined;
	const detail = Array.isArray(args?.argv)
		? args.argv.map(String).join(" ")
		: typeof args?.query === "string"
			? args.query
			: "";
	const suffix = detail ? `: ${detail}` : "";
	const text = `Running ${name}${suffix}`;
	return text.length > 100 ? `${text.slice(0, 97)}...` : text;
}

export function formatElapsed(durationMs: number): string {
	return `${(Math.max(0, durationMs) / 1000).toFixed(1)}s`;
}

export function extractToolResultText(result: unknown): string | null {
	if (!result || typeof result !== "object" || !("content" in result)) return null;
	const content = (result as { content?: unknown }).content;
	if (!Array.isArray(content)) return null;
	const text = content
		.filter((part): part is { type: "text"; text: string } => Boolean(
			part
			&& typeof part === "object"
			&& "type" in part
			&& part.type === "text"
			&& "text" in part
			&& typeof part.text === "string",
		))
		.map((part) => part.text)
		.join("\n");
	return text || null;
}

export function formatToolFailure(toolName: string | undefined, result: unknown): string {
	const detail = extractToolResultText(result);
	return `✗ ${toolName ?? "tool"} failed${detail ? `: ${detail}` : ""}`;
}

function formatToolArgs(args: unknown): string {
	const text = JSON.stringify(args);
	if (!text) return "";
	return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function StatusLine({ modeLabel, modeAccent, contextLabel, connectionStatus, columns, scheme, projectName, projectFolder }: StatusLineProps): React.ReactElement {
	const dotColor = statusColor(connectionStatus);
	const connLabel = connectionStatus === "connected" ? "HISE" : connectionStatus === "warning" ? "…" : "offline";
	const padW = COMPACT.horizontalPad;
	const muted = scheme.foreground.muted;
	const def = scheme.foreground.default;

	// Plain text segments for length math
	let leftPlain = modeLabel;
	if (contextLabel) leftPlain += ` · ${contextLabel}`;
	if (projectName) leftPlain += ` · ${projectName}`;
	if (projectFolder) leftPlain += ` | ${projectFolder}`;
	const connPlain = `● ${connLabel}`;

	const inner = Math.max(0, columns - padW * 2);
	const minGap = 2;
	const maxLeft = Math.max(0, inner - connPlain.length - minGap);
	let leftText = leftPlain;
	if (leftPlain.length > maxLeft) {
		leftText = leftPlain.slice(0, Math.max(0, maxLeft - 1)) + "…";
	}
	const filler = Math.max(minGap, inner - leftText.length - connPlain.length);

	// Build a single ANSI-colored string. Reconstruct colored segments
	// while reusing leftText for total width.
	let leftColored = "";
	if (leftText === leftPlain) {
		leftColored = `${fgHex(modeAccent)}\x1b[1m${modeLabel}${RESET}`;
		if (contextLabel) leftColored += `${fgHex(muted)} · ${RESET}${fgHex(def)}${contextLabel}${RESET}`;
		if (projectName) leftColored += `${fgHex(muted)} · ${RESET}${fgHex(def)}${projectName}${RESET}`;
		if (projectFolder) leftColored += `${fgHex(muted)} | ${fgHex(muted)}${projectFolder}${RESET}`;
	} else {
		// Fallback: render truncated plain string (no per-segment color)
		leftColored = `${fgHex(modeAccent)}${leftText}${RESET}`;
	}
	const connColored = `${fgHex(dotColor)}● ${RESET}${fgHex(muted)}${connLabel}${RESET}`;
	const padStr = " ".repeat(padW);
	const fullLine = `${padStr}${leftColored}${" ".repeat(filler)}${connColored}${padStr}`;

	return (
		<Box width={columns}>
			<Text wrap="truncate-end">{fullLine}</Text>
		</Box>
	);
}
