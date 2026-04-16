// ── DSP mode — scriptnode graph editor ─────────────────────────────────
//
// Mirrors builder/ui pattern: GET /api/dsp/tree + POST /api/dsp/apply.
// Context is a moduleId (the DspNetwork::Holder script processor).
// Tree data is cached as RawDspNode for parameter/connection lookups and
// as TreeNode for sidebar rendering.

import type { CommandResult } from "../result.js";
import {
	errorResult,
	tableResult,
	textResult,
	treeResult,
} from "../result.js";
import type { ScriptnodeList } from "../data.js";
import type { TreeNode } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeDsp } from "../highlight/dsp.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import { isEnvelopeResponse, isErrorResponse } from "../hise.js";
import type { HiseConnection } from "../hise.js";
import type { RawDspNode } from "../../mock/contracts/dsp.js";
import {
	findDspConnectionTargeting,
	findDspNode,
	findDspParent,
	normalizeDspApplyResponse,
	normalizeDspInitResponse,
	normalizeDspList,
	normalizeDspSaveResponse,
	normalizeDspTreeResponse,
} from "../../mock/contracts/dsp.js";
import { applyDiffToTree } from "../../mock/contracts/builder.js";
import type { CompletionEngine } from "../completion/engine.js";
import type { DspCommand, GetCommand } from "./dsp-parser.js";
import { parseDspInput, findLastUnquotedComma, parseSingleDspCommand } from "./dsp-parser.js";
import type { DspOp } from "./dsp-ops.js";
import { commandToDspOps, collectDspNodeIds, nodeParameters } from "./dsp-ops.js";
import {
	validateAddCommand,
	validateCreateParameterCommand,
	validateSetCommand,
} from "./dsp-validate.js";

// ── Re-exports ────────────────────────────────────────────────────

export type {
	AddCommand,
	RemoveCommand,
	MoveCommand,
	ConnectCommand,
	DisconnectCommand,
	SetCommand,
	GetCommand,
	BypassCommand,
	EnableCommand,
	CreateParameterCommand,
	ShowCommand,
	UseCommand,
	InitCommand,
	SaveCommand,
	ResetCommand,
	DspCommand,
} from "./dsp-parser.js";
export {
	parseSingleDspCommand,
	parseDspInput,
} from "./dsp-parser.js";
export type { DspOp } from "./dsp-ops.js";
export {
	commandToDspOps,
	collectDspNodeIds,
	nodeParameters,
} from "./dsp-ops.js";

// ── Tree decoration ────────────────────────────────────────────────

const CONTAINER_COLOUR = MODE_ACCENTS.dsp;

/**
 * Walk the TreeNode produced by normalizeDspTree and decorate it with
 * dots / colours / dim state for the sidebar:
 *  - containers (chain kind) get the ○ dot in the DSP accent
 *  - leaves (module kind) get the ● filled dot in the DSP accent
 *  - bypassed nodes get dimmed
 * Diff inheritance mirrors builder: added/removed propagate, modified
 * does not.
 */
type DiffStatus = "added" | "removed" | "modified";

function decorateDspTree(
	node: TreeNode,
	rawIndex: Map<string, RawDspNode>,
	parentDiff?: DiffStatus,
): TreeNode {
	const resolvedDiff: DiffStatus | undefined = node.diff
		?? (parentDiff === "added" || parentDiff === "removed" ? parentDiff : undefined);
	node.diff = resolvedDiff;
	const childDiff = resolvedDiff === "added" || resolvedDiff === "removed"
		? resolvedDiff
		: undefined;

	const raw = node.id ? rawIndex.get(node.id) : undefined;
	node.colour = CONTAINER_COLOUR;
	if (node.nodeKind === "chain") {
		node.filledDot = false;
		node.dimmed = !node.children || node.children.length === 0;
	} else {
		node.filledDot = true;
		node.dimmed = raw?.bypassed === true;
	}

	if (node.children) {
		for (const child of node.children) {
			decorateDspTree(child, rawIndex, childDiff);
		}
	}
	return node;
}

function buildRawIndex(raw: RawDspNode | null): Map<string, RawDspNode> {
	const map = new Map<string, RawDspNode>();
	if (!raw) return map;
	const walk = (n: RawDspNode) => {
		map.set(n.nodeId, n);
		for (const c of n.children) walk(c);
	};
	walk(raw);
	return map;
}

// ── DSP mode class ─────────────────────────────────────────────────

export class DspMode implements Mode {
	readonly id: Mode["id"] = "dsp";
	readonly name = "DSP";
	readonly accent = MODE_ACCENTS.dsp;
	readonly prompt = "[dsp] > ";
	readonly treeLabel = "DSP Graph";

	private readonly scriptnodeList: ScriptnodeList | null;
	private readonly completionEngine: CompletionEngine | null;
	private moduleId: string | null = null;
	private currentPath: string[] = [];
	private rawTree: RawDspNode | null = null;
	private treeRoot: TreeNode | null = null;
	private treeFetched = false;

	constructor(
		scriptnodeList?: ScriptnodeList,
		completionEngine?: CompletionEngine,
		initialPath?: string,
	) {
		this.scriptnodeList = scriptnodeList ?? null;
		this.completionEngine = completionEngine ?? null;
		if (initialPath) this.setContext(initialPath);
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeDsp(value);
	}

	get contextLabel(): string {
		if (!this.moduleId) return "";
		if (this.currentPath.length === 0) return this.moduleId;
		return `${this.moduleId}/${this.currentPath.join("/")}`;
	}

	setContext(path: string): void {
		// Dot-entry: "/dsp.Script FX1" or "/dsp.Script FX1.Main.Osc1"
		const segments = path.split(".").filter((s) => s !== "");
		if (segments.length === 0) return;
		this.moduleId = segments[0]!;
		this.currentPath = segments.slice(1);
	}

	getTree(): TreeNode | null {
		if (!this.treeRoot) return null;
		const rawIndex = buildRawIndex(this.rawTree);
		return decorateDspTree(structuredClone(this.treeRoot), rawIndex);
	}

	getSelectedPath(): string[] {
		return [...this.currentPath];
	}

	selectNode(path: string[]): void {
		this.currentPath = [...path];
	}

	invalidateTree(): void {
		this.treeFetched = false;
	}

	async onEnter(session: SessionContext): Promise<void> {
		if (this.moduleId && session.connection) {
			await this.fetchTree(session.connection);
			this.treeFetched = true;
		}
	}

	// ── Tree fetch ──────────────────────────────────────────────

	/**
	 * Fetch the current module's network tree from HISE. Honours plan
	 * state by switching to `?group=current` when an undo group is
	 * active. Updates rawTree and treeRoot.
	 */
	async fetchTree(connection: HiseConnection): Promise<void> {
		if (!this.moduleId) return;
		let inPlan = false;
		const diffResp = await connection.get("/api/undo/diff?scope=group");
		if (isEnvelopeResponse(diffResp) && diffResp.success) {
			const groupName = diffResp.groupName as string | undefined;
			inPlan = typeof groupName === "string" && groupName !== "root" && groupName !== "";
		}
		const endpoint = `/api/dsp/tree?moduleId=${encodeURIComponent(this.moduleId)}${inPlan ? "&group=current" : ""}`;
		const response = await connection.get(endpoint);
		if (isErrorResponse(response)) return;
		if (!isEnvelopeResponse(response) || !response.success) return;
		try {
			const { raw, tree } = normalizeDspTreeResponse(response.result);
			this.rawTree = raw;
			this.treeRoot = tree;
		} catch {
			// Normalization failed — keep existing tree
		}
	}

	private async ensureTree(session: SessionContext): Promise<void> {
		if (!this.treeFetched && this.moduleId && session.connection) {
			this.treeFetched = true;
			await this.fetchTree(session.connection);
		}
	}

	// ── Parse entry ─────────────────────────────────────────────

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		await this.ensureTree(session);

		const trimmed = input.trim();
		if (!trimmed) return textResult("");

		const parts = trimmed.split(/\s+/);
		const keyword = parts[0]?.toLowerCase();

		if (keyword === "help") return this.handleHelp();
		if (keyword === "cd") {
			const target = parts.slice(1).join(" ").trim();
			return this.handleCd(target, session);
		}
		if (keyword === "ls" || keyword === "dir") return this.handleLs();
		if (keyword === "pwd") return this.handlePwd();

		// Chevrotain-parsed commands (with comma chaining)
		const result = parseDspInput(input);
		if ("error" in result) return errorResult(result.error);

		let last: CommandResult = textResult("(no commands)");
		for (const cmd of result.commands) {
			last = await this.dispatch(cmd, session);
			if (last.type === "error") return last;
		}
		return last;
	}

	// ── Navigation ──────────────────────────────────────────────

	private handleCd(target: string, session: SessionContext): CommandResult {
		if (!target || target === "/") {
			this.currentPath = [];
			return textResult("/");
		}
		if (target === "..") {
			if (this.currentPath.length === 0) return session.popMode();
			this.currentPath.pop();
			return textResult(this.currentPath.length > 0 ? this.currentPath.join("/") : "/");
		}
		const segments = target.split(/[./]/).filter((s) => s !== "");
		for (const seg of segments) {
			if (seg === "..") {
				if (this.currentPath.length > 0) this.currentPath.pop();
			} else {
				if (this.rawTree && !findDspNode(this.rawTree, seg)) {
					return errorResult(`"${seg}" not found in DSP graph.`);
				}
				this.currentPath.push(seg);
			}
		}
		return textResult(this.currentPath.join("/"));
	}

	private handleLs(): CommandResult {
		if (!this.rawTree) {
			return textResult(this.moduleId ? "(tree not loaded — run `init <name>` first)" : "(no module context — enter via /dsp.<moduleId>)");
		}
		const node = this.currentPath.length === 0
			? this.rawTree
			: findDspNode(this.rawTree, this.currentPath[this.currentPath.length - 1]!);
		if (!node) return errorResult(`Path not found: ${this.currentPath.join("/")}`);
		if (node.children.length === 0) return textResult(`${node.nodeId}: (no children)`);
		return tableResult(
			["Name", "Factory", "Bypassed"],
			node.children.map((c) => [c.nodeId, c.factoryPath, String(c.bypassed)]),
		);
	}

	private handlePwd(): CommandResult {
		if (!this.moduleId) return textResult("(no module context)");
		const suffix = this.currentPath.length > 0 ? "/" + this.currentPath.join("/") : "";
		return textResult(`${this.moduleId}${suffix}`);
	}

	// ── Dispatch ────────────────────────────────────────────────

	private async dispatch(cmd: DspCommand, session: SessionContext): Promise<CommandResult> {
		switch (cmd.type) {
			case "show": return this.handleShow(cmd.what, session);
			case "use": return this.handleUse(cmd.moduleId, session);
			case "init": return this.handleInit(cmd.name, cmd.embedded, session);
			case "save": return this.handleSave(session);
			case "get": return this.handleGet(cmd);
			// Mutation commands: validate locally, then apply.
			case "add":
			case "remove":
			case "move":
			case "connect":
			case "disconnect":
			case "set":
			case "bypass":
			case "enable":
			case "create_parameter":
			case "reset":
				return this.handleMutation(cmd, session);
		}
	}

	// ── Show ────────────────────────────────────────────────────

	private async handleShow(
		what: "tree" | "networks" | "modules" | "connections",
		session: SessionContext,
	): Promise<CommandResult> {
		if (what === "tree") {
			if (!this.treeRoot) return textResult("(no tree — call `init <name>` first)");
			return treeResult(this.getTree()!);
		}
		if (what === "networks") {
			if (!session.connection) return errorResult("show networks requires a HISE connection");
			const resp = await session.connection.get("/api/dsp/list");
			if (isErrorResponse(resp)) return errorResult(resp.message);
			if (!isEnvelopeResponse(resp) || !resp.success) {
				return errorResult("Failed to list networks");
			}
			try {
				const networks = normalizeDspList(resp.networks);
				if (networks.length === 0) return textResult("(no networks)");
				return tableResult(["Network"], networks.map((n) => [n]));
			} catch (e) {
				return errorResult(String(e));
			}
		}
		if (what === "modules") {
			if (!session.connection) return errorResult("show modules requires a HISE connection");
			const resp = await session.connection.get("/api/status");
			if (isErrorResponse(resp)) return errorResult(resp.message);
			if (!isEnvelopeResponse(resp) || !resp.success) {
				return errorResult("Failed to list modules");
			}
			const processors = (resp.scriptProcessors as Array<{ moduleId: string }> | undefined) ?? [];
			if (processors.length === 0) return textResult("(no script processors)");
			return tableResult(
				["Module ID"],
				processors.map((p) => [p.moduleId]),
			);
		}
		if (what === "connections") {
			if (!this.rawTree) return textResult("(no tree — call `init <name>` first)");
			const rows: string[][] = [];
			collectConnections(this.rawTree, rows);
			if (rows.length === 0) return textResult("(no modulation connections)");
			return tableResult(["Source", "Output", "Target", "Parameter"], rows);
		}
		return errorResult(`Unknown show target: ${what}`);
	}

	// ── Use ─────────────────────────────────────────────────────

	private async handleUse(moduleId: string, session: SessionContext): Promise<CommandResult> {
		this.moduleId = moduleId;
		this.currentPath = [];
		this.rawTree = null;
		this.treeRoot = null;
		this.treeFetched = false;
		if (session.connection) {
			await this.fetchTree(session.connection);
			this.treeFetched = true;
		}
		return textResult(`Using module "${moduleId}"`);
	}

	// ── Init / Save ─────────────────────────────────────────────

	private async handleInit(
		name: string,
		embedded: boolean,
		session: SessionContext,
	): Promise<CommandResult> {
		if (!this.moduleId) {
			return errorResult("init: no module context. Enter mode via /dsp.<moduleId> or run `use <moduleId>` first.");
		}
		if (!session.connection) return errorResult("init requires a HISE connection");
		const body = { moduleId: this.moduleId, name, embedded };
		const resp = await session.connection.post(
			`/api/dsp/init?moduleId=${encodeURIComponent(this.moduleId)}`,
			body,
		);
		if (isErrorResponse(resp)) return errorResult(resp.message);
		if (!isEnvelopeResponse(resp) || !resp.success) {
			return errorResult(envelopeError(resp, "init failed"));
		}
		try {
			const parsed = normalizeDspInitResponse(resp);
			const { raw, tree } = normalizeDspTreeResponse(parsed.tree);
			this.rawTree = raw;
			this.treeRoot = tree;
			this.treeFetched = true;
			this.currentPath = [];
			const where = parsed.embedded ? "(embedded)" : parsed.filePath;
			return textResult(`Loaded "${name}" on ${this.moduleId} ${where}`);
		} catch (e) {
			return errorResult(String(e));
		}
	}

	private async handleSave(session: SessionContext): Promise<CommandResult> {
		if (!this.moduleId) return errorResult("save: no module context.");
		if (!session.connection) return errorResult("save requires a HISE connection");
		const resp = await session.connection.post(
			`/api/dsp/save?moduleId=${encodeURIComponent(this.moduleId)}`,
			{ moduleId: this.moduleId },
		);
		if (isErrorResponse(resp)) return errorResult(resp.message);
		if (!isEnvelopeResponse(resp) || !resp.success) {
			return errorResult(envelopeError(resp, "save failed"));
		}
		try {
			const parsed = normalizeDspSaveResponse(resp);
			return textResult(`Saved: ${parsed.filePath}`);
		} catch (e) {
			return errorResult(String(e));
		}
	}

	// ── Get (local tree queries) ───────────────────────────────

	private handleGet(cmd: GetCommand): CommandResult {
		if (!this.rawTree) return errorResult("(no tree — call `init <name>` first)");
		if (cmd.query === "factory") {
			const node = findDspNode(this.rawTree, cmd.nodeId);
			if (!node) return errorResult(`Node "${cmd.nodeId}" not found`);
			return textResult(node.factoryPath);
		}
		if (cmd.query === "param") {
			const node = findDspNode(this.rawTree, cmd.nodeId);
			if (!node) return errorResult(`Node "${cmd.nodeId}" not found`);
			const param = node.parameters.find((p) => p.parameterId === cmd.parameterId);
			if (!param) return errorResult(`Parameter "${cmd.parameterId}" not found on ${cmd.nodeId}`);
			return textResult(String(param.value));
		}
		if (cmd.query === "source") {
			const conn = findDspConnectionTargeting(this.rawTree, cmd.nodeId, cmd.parameterId);
			if (!conn) return textResult("(not connected)");
			return textResult(conn.source);
		}
		if (cmd.query === "parent") {
			const node = findDspNode(this.rawTree, cmd.nodeId);
			if (!node) return errorResult(`Node "${cmd.nodeId}" not found`);
			const parent = findDspParent(this.rawTree, cmd.nodeId);
			return textResult(parent?.nodeId ?? "(root)");
		}
		return errorResult("Unknown get query");
	}

	// ── Mutations ───────────────────────────────────────────────

	private async handleMutation(
		cmd: DspCommand,
		session: SessionContext,
	): Promise<CommandResult> {
		if (!this.moduleId) {
			return errorResult("No module context. Enter mode via /dsp.<moduleId> or run `use <moduleId>` first.");
		}

		// Local validation
		if (cmd.type === "add" && this.scriptnodeList) {
			const v = validateAddCommand(cmd, this.scriptnodeList);
			if (!v.valid) return errorResult(v.errors.join("\n"));
		}
		if (cmd.type === "set" && this.scriptnodeList) {
			const factoryPath = this.rawTree
				? findDspNode(this.rawTree, cmd.nodeId)?.factoryPath ?? null
				: null;
			const v = validateSetCommand(cmd, factoryPath, this.scriptnodeList);
			if (!v.valid) return errorResult(v.errors.join("\n"));
		}
		if (cmd.type === "create_parameter" && this.scriptnodeList) {
			const factoryPath = this.rawTree
				? findDspNode(this.rawTree, cmd.nodeId)?.factoryPath ?? null
				: null;
			const v = validateCreateParameterCommand(cmd, factoryPath, this.scriptnodeList);
			if (!v.valid) return errorResult(v.errors.join("\n"));
		}

		// Translate to ops
		const opsResult = commandToDspOps(cmd, this.rawTree, this.currentPath);
		if ("error" in opsResult) return errorResult(opsResult.error);
		if (opsResult.ops.length === 0) return textResult("(no operations)");

		if (!session.connection) {
			return textResult(`(offline) would apply: ${JSON.stringify(opsResult.ops)}`);
		}
		return this.executeOps(opsResult.ops, session.connection);
	}

	private async executeOps(
		ops: DspOp[],
		connection: HiseConnection,
	): Promise<CommandResult> {
		const body = { moduleId: this.moduleId, operations: ops };
		const response = await connection.post("/api/dsp/apply", body);
		if (isErrorResponse(response)) return errorResult(response.message);
		if (!isEnvelopeResponse(response)) return errorResult("Unexpected response from HISE");
		if (!response.success) {
			return errorResult(envelopeError(response, "DSP operation failed"));
		}

		let applyResult;
		try {
			applyResult = normalizeDspApplyResponse(response);
		} catch (e) {
			return errorResult(String(e));
		}

		// Re-fetch the tree to reflect mutations.
		await this.fetchTree(connection);
		if (applyResult.diff.length > 0 && this.treeRoot) {
			applyDiffToTree(this.treeRoot, applyResult.diff);
		}

		const summary = response.logs.length > 0
			? response.logs.join("; ")
			: applyResult.diff.map((d) => `${d.action} ${d.target}`).join(", ") || "OK";
		return textResult(summary);
	}

	// ── Completion ──────────────────────────────────────────────

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) return { items: [], from: 0, to: input.length };

		const lastComma = findLastUnquotedComma(input);
		const segStart = lastComma + 1;
		const segment = input.slice(segStart);
		const offset = segStart + (segment.length - segment.trimStart().length);
		const trimmed = segment.trimStart();
		const inputLength = input.length;
		const tokens = trimmed.split(/\s+/);
		const first = tokens[0]?.toLowerCase() ?? "";

		// Word 0 — top-level keyword
		if (tokens.length <= 1) {
			const items = DSP_KEYWORDS.filter((k) => k.label.startsWith(first));
			return { items, from: offset, to: inputLength, label: "DSP commands" };
		}

		// show <what>
		if (first === "show" && tokens.length === 2) {
			const items = DSP_SHOW_SUBCOMMANDS.filter((k) => k.label.startsWith(tokens[1]!.toLowerCase()));
			return { items, from: offset + tokens[0]!.length + 1, to: inputLength };
		}

		// add <factory>[.<node>] — delegate to scriptnode completion
		if (first === "add" && tokens.length === 2) {
			const res = this.completionEngine.completeScriptnode(tokens[1]!);
			const fromBase = offset + tokens[0]!.length + 1;
			return { items: res.items, from: fromBase + res.from, to: inputLength };
		}

		// set/get/remove/bypass/enable <nodeId>[.<param>]
		if ((first === "set" || first === "get" || first === "remove"
				|| first === "bypass" || first === "enable") && tokens.length === 2) {
			const tail = tokens[1]!;
			const dotIdx = tail.indexOf(".");
			if (dotIdx !== -1) {
				const nodeId = tail.slice(0, dotIdx);
				const paramPrefix = tail.slice(dotIdx + 1);
				const params = nodeParameters(this.rawTree, nodeId)
					.filter((p) => p.toLowerCase().startsWith(paramPrefix.toLowerCase()))
					.map((p) => ({ label: p }));
				return {
					items: params,
					from: offset + tokens[0]!.length + 1 + dotIdx + 1,
					to: inputLength,
				};
			}
			const nodeIds = collectDspNodeIds(this.rawTree)
				.filter((n) => n.nodeId.toLowerCase().startsWith(tail.toLowerCase()))
				.map((n) => ({ label: n.nodeId, detail: n.factoryPath }));
			return { items: nodeIds, from: offset + tokens[0]!.length + 1, to: inputLength };
		}

		// get source of <node>.<param> | get parent of <node>.<param>
		if (first === "get" && tokens.length === 2
				&& (tokens[1] === "source" || tokens[1] === "parent")) {
			return {
				items: [{ label: "of", detail: "of <node>.<param>" }],
				from: offset + tokens[0]!.length + 1 + tokens[1]!.length + 1,
				to: inputLength,
			};
		}

		return { items: [], from: offset, to: inputLength };
	}

	// ── Help ────────────────────────────────────────────────────

	private handleHelp(): CommandResult {
		return textResult(DSP_HELP);
	}
}

// ── Internal helpers ────────────────────────────────────────────

function envelopeError(response: import("../hise.js").HiseResponse, fallback: string): string {
	if (isEnvelopeResponse(response) && response.errors.length > 0) {
		return response.errors.map((e) => e.errorMessage).join("\n");
	}
	return fallback;
}

function collectConnections(node: RawDspNode, rows: string[][]): void {
	if (node.connections) {
		for (const c of node.connections) {
			rows.push([c.source, String(c.sourceOutput), c.target, c.parameter]);
		}
	}
	for (const child of node.children) collectConnections(child, rows);
}

// ── Completion keyword tables ───────────────────────────────────

const DSP_KEYWORDS = [
	{ label: "show", detail: "show networks | modules | tree | connections" },
	{ label: "use", detail: "Switch host moduleId" },
	{ label: "init", detail: "Create or load a DspNetwork" },
	{ label: "save", detail: "Save the network to its .xml file" },
	{ label: "reset", detail: "Empty the loaded network" },
	{ label: "add", detail: "Add a node (factory.nodeId)" },
	{ label: "remove", detail: "Remove a node" },
	{ label: "move", detail: "Move a node" },
	{ label: "connect", detail: "Connect modulation source to target param" },
	{ label: "disconnect", detail: "Disconnect modulation" },
	{ label: "set", detail: "Set a parameter value" },
	{ label: "get", detail: "Get a node or parameter" },
	{ label: "bypass", detail: "Bypass a node" },
	{ label: "enable", detail: "Enable a bypassed node" },
	{ label: "create_parameter", detail: "Create a dynamic parameter on a container" },
	{ label: "cd", detail: "Navigate into a container" },
	{ label: "ls", detail: "List children at current path" },
	{ label: "pwd", detail: "Print current path" },
	{ label: "help", detail: "Show DSP mode commands" },
];

const DSP_SHOW_SUBCOMMANDS = [
	{ label: "networks", detail: "List available DspNetwork xml files" },
	{ label: "modules", detail: "List DspNetwork-capable script processors" },
	{ label: "tree", detail: "Show current network hierarchy" },
	{ label: "connections", detail: "List modulation edges in the network" },
];

const DSP_HELP = [
	"DSP mode — scriptnode graph editor",
	"",
	"Context: one moduleId per mode entry. Use /dsp.<moduleId> to enter with",
	"a module pre-selected, or `use <moduleId>` once inside.",
	"",
	"Commands:",
	"  show networks | modules | tree | connections",
	"  use <moduleId>",
	"  init <name> [embedded]        create/load the module's network",
	"  save                          save the loaded network's .xml file",
	"  reset                         empty the loaded network",
	"  add <factory.node> [as <id>] [to <parent>]",
	"  remove <nodeId>",
	"  move <nodeId> to <parent> [at <index>]",
	"  connect <src>[.<out>] to <target>.<param>",
	"  disconnect <src> from <target>.<param>",
	"  set <node>.<param> [to] <value>",
	"  get <nodeId>                 -> factory path",
	"  get <node>.<param>           -> current value",
	"  get source of <node>.<param> -> connected source",
	"  get parent of <node>.<param> -> parent container id",
	"  bypass <nodeId> | enable <nodeId>",
	"  create_parameter <container>.<name> [<min> <max>] [default <d>] [step <s>]",
	"  cd / ls / pwd                navigate the graph",
].join("\n");
