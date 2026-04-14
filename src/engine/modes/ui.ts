// ── UI mode — Chevrotain parser + HISE execution ────────────────────

// Component CRUD against live HISE via POST /api/ui/apply.
// Falls back to local-only validation when no connection is available.

import { CstParser, type IToken } from "chevrotain";
import { closest } from "fastest-levenshtein";
import type { CommandResult, TreeNode } from "../result.js";
import { errorResult, tableResult, textResult } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeUi } from "../highlight/ui.js";
import type { CompletionItem, CompletionResult, Mode, ModeId, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import { isErrorResponse, isEnvelopeResponse } from "../hise.js";
import {
	normalizeUiTreeResponse,
	normalizeUiApplyResult,
	applyUiDiffToTree,
	collectComponentIds,
} from "../../mock/contracts/ui.js";
import type { CompletionEngine } from "../completion/engine.js";
import { fuzzyFilter } from "../completion/engine.js";
import {
	Add, Remove, Move, Rename, Into, Show, Set, Get, To, As, At, Tree,
	Identifier, QuotedString, NumberLiteral, Dot,
	uiLexer, UI_TOKENS, UI_VERB_KEYWORDS,
} from "./tokens.js";

// ── Valid component types ──────────────────────────────────────────

export const VALID_COMPONENT_TYPES = [
	"ScriptButton", "ScriptSlider", "ScriptPanel", "ScriptComboBox",
	"ScriptLabel", "ScriptImage", "ScriptTable", "ScriptSliderPack",
	"ScriptAudioWaveform", "ScriptFloatingTile", "ScriptDynamicContainer",
	"ScriptedViewport", "ScriptMultipageDialog", "ScriptWebView",
] as const;

// ── Component property map type ────────────────────────────────────

export interface ComponentPropertyDef {
	defaultValue: unknown;
	type: string;
	options?: string[];
	description?: string;
}

export type ComponentPropertyMap = Record<string, Record<string, ComponentPropertyDef>>;

/** Common properties shared by all ScriptComponent subclasses. */
const COMMON_COMPONENT_PROPERTIES = [
	"value", "text", "visible", "enabled", "locked",
	"x", "y", "width", "height",
	"min", "max", "defaultValue",
	"tooltip", "bgColour", "itemColour", "itemColour2", "textColour",
	"macroControl", "saveInPreset", "isPluginParameter",
	"pluginParameterName", "pluginParameterGroup",
	"deferControlCallback", "isMetaParameter", "linkedTo",
	"automationID", "useUndoManager", "parentComponent",
	"processorId", "parameterId",
] as const;

// ── Chevrotain CST Parser ──────────────────────────────────────────

class UiParser extends CstParser {
	constructor() {
		super(UI_TOKENS);
		this.performSelfAnalysis();
	}

	// Reusable: multi-word target (greedy Identifier+ or QuotedString)
	public targetRef = this.RULE("targetRef", () => {
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quoted" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "words" })) },
		]);
	});

	// add <type> [as] ["<name>"] [at <x> <y> <w> <h>]
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.OR2([
			{ ALT: () => this.CONSUME3(QuotedString, { LABEL: "quotedType" }) },
			{ ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME2(Identifier, { LABEL: "componentType" })) },
		]);
		this.OPTION(() => {
			this.OPTION5(() => { this.CONSUME(As); });
			this.CONSUME(QuotedString, { LABEL: "name" });
		});
		this.OPTION2(() => {
			this.CONSUME(At);
			this.CONSUME(NumberLiteral, { LABEL: "x" });
			this.CONSUME2(NumberLiteral, { LABEL: "y" });
			this.CONSUME3(NumberLiteral, { LABEL: "width" });
			this.CONSUME4(NumberLiteral, { LABEL: "height" });
		});
	});

	// remove <target>
	public removeCommand = this.RULE("removeCommand", () => {
		this.CONSUME(Remove);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
	});

	// set <target>.<prop> [to] <value>
	public setCommand = this.RULE("setCommand", () => {
		this.CONSUME(Set);
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quotedTarget" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "targetWords" })) },
		]);
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "prop" });
		this.OPTION(() => {
			this.CONSUME(To);
		});
		this.OR2([
			{ ALT: () => this.CONSUME(NumberLiteral, { LABEL: "numValue" }) },
			{ ALT: () => this.CONSUME2(QuotedString, { LABEL: "strValue" }) },
			{ ALT: () => this.CONSUME3(Identifier, { LABEL: "idValue" }) },
		]);
	});

	// move <target> to <parent> [at <index>]
	public moveCommand = this.RULE("moveCommand", () => {
		this.CONSUME(Move);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
		this.CONSUME(To);
		this.SUBRULE2(this.targetRef, { LABEL: "parent" });
		this.OPTION(() => {
			this.CONSUME(At);
			this.CONSUME(NumberLiteral, { LABEL: "index" });
		});
	});

	// rename <target> to "<newName>"
	public renameCommand = this.RULE("renameCommand", () => {
		this.CONSUME(Rename);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
		this.CONSUME(To);
		this.CONSUME(QuotedString, { LABEL: "newName" });
	});

	// show tree | show <target>
	public showCommand = this.RULE("showCommand", () => {
		this.CONSUME(Show);
		this.OR([
			{ ALT: () => this.CONSUME(Tree, { LABEL: "tree" }) },
			{ ALT: () => this.SUBRULE(this.targetRef, { LABEL: "target" }) },
		]);
	});

	// get <target>.<prop>
	public getCommand = this.RULE("getCommand", () => {
		this.CONSUME(Get);
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quotedTarget" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "targetWords" })) },
		]);
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "prop" });
	});

	// Top-level entry
	public command = this.RULE("command", () => {
		this.OR([
			{ ALT: () => this.SUBRULE(this.addCommand) },
			{ ALT: () => this.SUBRULE(this.removeCommand) },
			{ ALT: () => this.SUBRULE(this.setCommand) },
			{ ALT: () => this.SUBRULE(this.getCommand) },
			{ ALT: () => this.SUBRULE(this.moveCommand) },
			{ ALT: () => this.SUBRULE(this.renameCommand) },
			{ ALT: () => this.SUBRULE(this.showCommand) },
		]);
	});
}

const parser = new UiParser();

// ── Parsed command types ───────────────────────────────────────────

export interface UiAddCommand {
	type: "add";
	componentType: string;
	name?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface UiRemoveCommand {
	type: "remove";
	target: string;
}

export interface UiSetCommand {
	type: "set";
	target: string;
	prop: string;
	value: string | number;
}

export interface UiMoveCommand {
	type: "move";
	target: string;
	parent: string;
	index?: number;
}

export interface UiRenameCommand {
	type: "rename";
	target: string;
	newName: string;
}

export interface UiGetCommand {
	type: "get";
	target: string;
	prop: string;
}

export interface UiShowCommand {
	type: "show";
	what: "tree" | "target";
	target?: string;
}

export type UiCommand =
	| UiAddCommand
	| UiRemoveCommand
	| UiSetCommand
	| UiGetCommand
	| UiMoveCommand
	| UiRenameCommand
	| UiShowCommand;

// ── Comma pre-processor + parse ────────────────────────────────────

/** Split input by commas, respecting quoted strings. */
function splitByComma(input: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inQuote = false;

	for (const ch of input) {
		if (ch === '"') {
			inQuote = !inQuote;
			current += ch;
		} else if (ch === "," && !inQuote) {
			segments.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	segments.push(current);
	return segments;
}

/**
 * Parse a single command string through the Chevrotain parser.
 * Does not handle comma chaining — use parseUiInput for that.
 */
export function parseSingleUiCommand(
	input: string,
): { command: UiCommand } | { error: string } {
	const lexResult = uiLexer.tokenize(input);
	if (lexResult.errors.length > 0) {
		return { error: `Lexer error: ${lexResult.errors[0].message}` };
	}

	parser.input = lexResult.tokens;
	const cst = parser.command();

	if (parser.errors.length > 0) {
		return { error: `Parse error: ${parser.errors[0].message}` };
	}

	return extractCommand(cst);
}

/**
 * Parse UI input with comma chaining support.
 * Returns an array of commands. Supports verb inheritance and
 * set target inheritance across comma-separated segments.
 */
export function parseUiInput(
	input: string,
): { commands: UiCommand[] } | { error: string } {
	const segments = splitByComma(input);
	let lastVerb: string | null = null;
	let lastSetTarget: string | null = null;
	const commands: UiCommand[] = [];

	for (let i = 0; i < segments.length; i++) {
		const trimmed = segments[i].trim();
		if (!trimmed) continue;

		const firstToken = trimmed.split(/\s/)[0].toLowerCase();
		const isKeyword = UI_VERB_KEYWORDS.has(firstToken);

		let toParse: string;
		if (isKeyword) {
			toParse = trimmed;
			lastVerb = firstToken;
		} else if ((lastVerb === "set" || lastVerb === "get") && !trimmed.includes(".")) {
			// Set/get continuation without dot — inherit target
			if (!lastSetTarget) {
				return { error: `No target to inherit in segment: ${trimmed}` };
			}
			toParse = `${lastVerb} ${lastSetTarget}.${trimmed}`;
		} else if (lastVerb) {
			toParse = `${lastVerb} ${trimmed}`;
		} else {
			return { error: `No verb for segment: ${trimmed}` };
		}

		const result = parseSingleUiCommand(toParse);
		if ("error" in result) {
			return { error: `${result.error} (in: ${trimmed})` };
		}
		commands.push(result.command);

		// Track last set/get target for inheritance
		if (result.command.type === "set") {
			lastSetTarget = result.command.target;
		} else if (result.command.type === "get") {
			lastSetTarget = result.command.target;
		}
	}

	if (commands.length === 0) {
		return { error: "Empty command" };
	}
	return { commands };
}

// ── CST extractors ─────────────────────────────────────────────────

function extractCommand(
	cst: any,
): { command: UiCommand } | { error: string } {
	const c = cst.children;
	if (c.addCommand) return extractAddCommand(c.addCommand[0]);
	if (c.removeCommand) return extractTargetCommand(c.removeCommand[0], "remove");
	if (c.setCommand) return extractSetCommand(c.setCommand[0]);
	if (c.getCommand) return extractGetCommand(c.getCommand[0]);
	if (c.moveCommand) return extractMoveCommand(c.moveCommand[0]);
	if (c.renameCommand) return extractRenameCommand(c.renameCommand[0]);
	if (c.showCommand) return extractShowCommand(c.showCommand[0]);
	return { error: "Unknown command structure" };
}

/** Extract a multi-word target from a targetRef subrule CST node. */
function extractTargetRef(node: any): string {
	if (node.children.quoted) {
		return stripQuotes((node.children.quoted[0] as IToken).image);
	}
	const words = (node.children.words as IToken[]).map((t) => t.image);
	return words.join(" ");
}

function extractAddCommand(
	node: any,
): { command: UiAddCommand } | { error: string } {
	let componentType: string;
	if (node.children.quotedType) {
		componentType = stripQuotes((node.children.quotedType[0] as IToken).image);
	} else {
		const words = (node.children.componentType as IToken[]).map((t) => t.image);
		componentType = words.join(" ");
	}

	const name = node.children.name
		? stripQuotes((node.children.name[0] as IToken).image)
		: undefined;

	const x = node.children.x
		? parseFloat((node.children.x[0] as IToken).image)
		: undefined;
	const y = node.children.y
		? parseFloat((node.children.y[0] as IToken).image)
		: undefined;
	const width = node.children.width
		? parseFloat((node.children.width[0] as IToken).image)
		: undefined;
	const height = node.children.height
		? parseFloat((node.children.height[0] as IToken).image)
		: undefined;

	return {
		command: { type: "add", componentType, name, x, y, width, height },
	};
}

function extractTargetCommand(
	node: any,
	type: "remove",
): { command: UiRemoveCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	return { command: { type, target } };
}

function extractSetCommand(
	node: any,
): { command: UiSetCommand } | { error: string } {
	let target: string;
	if (node.children.quotedTarget) {
		target = stripQuotes((node.children.quotedTarget[0] as IToken).image);
	} else {
		const words = (node.children.targetWords as IToken[]).map((t) => t.image);
		target = words.join(" ");
	}

	const prop = (node.children.prop[0] as IToken).image;

	let value: string | number;
	if (node.children.numValue) {
		value = parseFloat((node.children.numValue[0] as IToken).image);
	} else if (node.children.strValue) {
		value = stripQuotes((node.children.strValue[0] as IToken).image);
	} else if (node.children.idValue) {
		value = (node.children.idValue[0] as IToken).image;
	} else {
		return { error: "Missing value in set command" };
	}

	return { command: { type: "set", target, prop, value } };
}

function extractGetCommand(
	node: any,
): { command: UiGetCommand } | { error: string } {
	let target: string;
	if (node.children.quotedTarget) {
		target = stripQuotes((node.children.quotedTarget[0] as IToken).image);
	} else {
		const words = (node.children.targetWords as IToken[]).map((t) => t.image);
		target = words.join(" ");
	}
	const prop = (node.children.prop[0] as IToken).image;
	return { command: { type: "get", target, prop } };
}

function extractMoveCommand(
	node: any,
): { command: UiMoveCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	const parent = extractTargetRef(node.children.parent[0]);
	const index = node.children.index
		? parseInt((node.children.index[0] as IToken).image, 10)
		: undefined;
	return { command: { type: "move", target, parent, index } };
}

function extractRenameCommand(
	node: any,
): { command: UiRenameCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	const newName = stripQuotes((node.children.newName[0] as IToken).image);
	return { command: { type: "rename", target, newName } };
}

function extractShowCommand(
	node: any,
): { command: UiShowCommand } | { error: string } {
	if (node.children.tree) {
		return { command: { type: "show", what: "tree" } };
	}
	const target = extractTargetRef(node.children.target[0]);
	return { command: { type: "show", what: "target", target } };
}

function stripQuotes(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1).replace(/\\"/g, '"');
	}
	return s;
}

/** Find the last comma not inside quotes. Returns -1 if none. */
function findLastUnquotedComma(input: string): number {
	let inQuote = false;
	let last = -1;
	for (let i = 0; i < input.length; i++) {
		if (input[i] === '"') inQuote = !inQuote;
		else if (input[i] === "," && !inQuote) last = i;
	}
	return last;
}

// ── Component type validation ──────────────────────────────────────

function validateComponentType(componentType: string): string | null {
	const match = VALID_COMPONENT_TYPES.find(
		(t) => t.toLowerCase() === componentType.toLowerCase(),
	);
	if (match) return null;

	const suggestion = closest(componentType, [...VALID_COMPONENT_TYPES]);
	return `Unknown component type "${componentType}".${suggestion ? ` Did you mean "${suggestion}"?` : ""}`;
}

// ── Command → API operations mapping ───────────────────────────────

export interface UiOp {
	op: string;
	[key: string]: unknown;
}

/** Generate a default component name from a type (e.g. "ScriptButton" → "Button1"). */
function defaultComponentName(componentType: string): string {
	const base = componentType.replace(/^Script(ed)?/, "");
	return `${base}1`;
}

/**
 * Convert a parsed UiCommand into HISE API operation(s).
 * Returns an array of ops (most commands produce exactly one).
 */
export function commandToOps(
	cmd: UiCommand,
	currentPath: string[],
): { ops: UiOp[] } | { error: string } {
	switch (cmd.type) {
		case "add": {
			const op: UiOp = {
				op: "add",
				componentType: cmd.componentType,
				id: cmd.name ?? defaultComponentName(cmd.componentType),
			};
			if (cmd.x !== undefined) op.x = cmd.x;
			if (cmd.y !== undefined) op.y = cmd.y;
			if (cmd.width !== undefined) op.width = cmd.width;
			if (cmd.height !== undefined) op.height = cmd.height;
			// If inside a panel context, use it as parentId
			if (currentPath.length > 0) {
				op.parentId = currentPath[currentPath.length - 1];
			}
			return { ops: [op] };
		}
		case "remove":
			return { ops: [{ op: "remove", target: cmd.target }] };
		case "set":
			return { ops: [{ op: "set", target: cmd.target, properties: { [cmd.prop]: cmd.value } }] };
		case "move": {
			const moveOp: UiOp = { op: "move", target: cmd.target, parent: cmd.parent };
			if (cmd.index !== undefined) moveOp.index = cmd.index;
			return { ops: [moveOp] };
		}
		case "rename":
			return { ops: [{ op: "rename", target: cmd.target, newId: cmd.newName }] };
		case "get":
			return { error: "get commands are handled locally" };
		case "show":
			return { error: "show commands are handled locally" };
	}
}

// ── Tree utilities ─────────────────────────────────────────────────

/** Find a TreeNode by its id (case-insensitive). */
function findNodeById(tree: TreeNode | null, id: string): TreeNode | null {
	if (!tree) return null;
	if (tree.id?.toLowerCase() === id.toLowerCase()) return tree;
	if (tree.children) {
		for (const child of tree.children) {
			const found = findNodeById(child, id);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Walk a path of node IDs from the tree root, returning the node at the end.
 * Each segment matches a direct child's id at that level (case-insensitive).
 */
function resolveNodeByPath(tree: TreeNode | null, path: string[]): TreeNode | null {
	if (!tree || path.length === 0) return tree;
	let current: TreeNode = tree;
	for (const seg of path) {
		if (!current.children) return null;
		const lower = seg.toLowerCase();
		const child = current.children.find((c) => c.id?.toLowerCase() === lower);
		if (!child) return null;
		current = child;
	}
	return current;
}

/** Build CompletionItems from component IDs. Auto-quotes IDs with spaces. */
function componentIdCompletionItems(tree: TreeNode | null): CompletionItem[] {
	if (!tree) return [];
	const ids = collectComponentIds(tree);
	return ids.map((id) => ({
		label: id,
		insertText: id.includes(" ") ? `"${id}"` : id,
	}));
}

// ── UI mode class ──────────────────────────────────────────────────

export class UiMode implements Mode {
	readonly id: ModeId = "ui";
	readonly name = "UI";
	readonly accent = MODE_ACCENTS.ui;
	readonly prompt = "[ui] > ";
	readonly treeLabel = "Component Tree";

	private moduleId = "Interface";
	private currentPath: string[] = [];
	private treeRoot: TreeNode | null = null;
	private treeFetched = false;
	private readonly completionEngine: CompletionEngine | null;
	private readonly componentProperties: ComponentPropertyMap | null;

	constructor(
		completionEngine?: CompletionEngine,
		initialPath?: string,
		componentProperties?: ComponentPropertyMap,
	) {
		this.completionEngine = completionEngine ?? null;
		this.componentProperties = componentProperties ?? null;
		if (initialPath) {
			this.currentPath = initialPath.split(".").filter((s) => s !== "");
		}
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeUi(value);
	}

	// ── Tree sidebar support ────────────────────────────────────

	getTree(): TreeNode | null {
		if (!this.treeRoot) return null;
		return structuredClone(this.treeRoot);
	}

	getSelectedPath(): string[] {
		return [...this.currentPath];
	}

	selectNode(path: string[]): void {
		this.currentPath = [...path];
	}

	get contextLabel(): string {
		return this.currentPath.join(".");
	}

	setContext(path: string): void {
		this.currentPath = path.split(".").filter((s) => s !== "");
	}

	invalidateTree(): void {
		this.treeFetched = false;
	}

	async onEnter(session: SessionContext): Promise<void> {
		await this.ensureTree(session);
	}

	// ── Completion ──────────────────────────────────────────────

	complete(input: string, _cursor: number): CompletionResult {
		// Handle comma chaining: complete only the last segment
		const lastComma = findLastUnquotedComma(input);
		if (lastComma !== -1) {
			return this.completeSegment(
				input.slice(lastComma + 1),
				lastComma + 1,
				input.length,
			);
		}

		return this.completeSegment(input, 0, input.length);
	}

	private completeSegment(
		segment: string,
		offset: number,
		inputLength: number,
	): CompletionResult {
		const trimmed = segment.trimStart();
		const leadingSpaces = segment.length - trimmed.length;
		const trailingSpace = segment.endsWith(" ");

		const lexResult = uiLexer.tokenize(trimmed);
		const tokens = lexResult.tokens;

		const empty: CompletionResult = { items: [], from: offset, to: inputLength };

		// No tokens or typing first word — suggest UI keywords
		if (tokens.length === 0 || (tokens.length === 1 && !trailingSpace)) {
			const prefix = tokens.length > 0 ? tokens[0].image.toLowerCase() : "";
			const keywords = ["add", "remove", "set", "get", "move", "rename", "show", "cd", "ls", "pwd"];
			const items: CompletionItem[] = keywords
				.filter((k) => k.startsWith(prefix))
				.map((k) => ({ label: k }));
			return {
				items,
				from: offset + leadingSpaces,
				to: inputLength,
				label: "UI keywords",
			};
		}

		const verb = tokens[0].image.toLowerCase();

		// ── cd <child> ──
		if (verb === "cd") {
			return this.completeCd(tokens, trailingSpace, offset, inputLength, segment);
		}

		const componentItems = componentIdCompletionItems(this.treeRoot);

		// ── add <type> ──
		if (verb === "add") {
			return this.completeAdd(tokens, trailingSpace, offset, inputLength, segment);
		}

		// ── set <target>.<prop> [to] <value> ──
		// ── get <target>.<prop> ──
		if (verb === "set" || verb === "get") {
			return this.completeSet(tokens, trailingSpace, offset, inputLength, segment, componentItems);
		}

		// ── show tree | show <target> ──
		if (verb === "show") {
			const treeItem: CompletionItem = { label: "tree", detail: "Show component tree" };
			if (tokens.length === 1 && trailingSpace) {
				return { items: [treeItem, ...componentItems], from: offset + segment.length, to: inputLength, label: "Show" };
			}
			if (tokens.length === 2 && !trailingSpace) {
				const prefix = tokens[1].image;
				const items = fuzzyFilter(prefix, [treeItem, ...componentItems]);
				const from = offset + tokens[1].startOffset;
				return { items, from, to: inputLength, label: "Show" };
			}
			return { items: [], from: offset, to: inputLength };
		}

		// ── Commands that take a single target: remove, move, rename ──
		const TARGET_COMMANDS = ["remove", "move", "rename"];
		if (TARGET_COMMANDS.includes(verb)) {
			return this.completeTarget(tokens, trailingSpace, offset, inputLength, segment, componentItems, "Components");
		}

		return empty;
	}

	private completeCd(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
	): CompletionResult {
		const empty: CompletionResult = { items: [], from: offset, to: inputLength };

		const contextNode = resolveNodeByPath(this.treeRoot, this.currentPath) ?? this.treeRoot;
		if (!contextNode?.children) return empty;

		const childItems: CompletionItem[] = contextNode.children.map((c) => ({
			label: c.label,
			detail: c.type ?? "",
			insertText: c.label.includes(" ") ? `"${c.label}"` : c.label,
		}));

		if (tokens.length === 1 && trailingSpace) {
			return { items: childItems, from: offset + segment.length, to: inputLength, label: "Children" };
		}

		if (tokens.length >= 2) {
			const prefixTokens = tokens.slice(1);
			let prefix = prefixTokens.map((t) => t.image).join(" ");
			if (prefix.startsWith('"')) prefix = prefix.slice(1);
			if (prefix.endsWith('"')) prefix = prefix.slice(0, -1);
			const from = offset + prefixTokens[0].startOffset;
			const items = fuzzyFilter(prefix, childItems);
			return { items, from, to: inputLength, label: "Children" };
		}

		return empty;
	}

	private completeAdd(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
	): CompletionResult {
		const typeItems: CompletionItem[] = VALID_COMPONENT_TYPES.map((t) => ({
			label: t,
			detail: "component",
		}));

		// Position 1: component type
		if (tokens.length === 1 && trailingSpace) {
			return { items: typeItems, from: offset + segment.length, to: inputLength, label: "Component types" };
		}
		if (tokens.length === 2 && !trailingSpace) {
			const prefix = tokens[1].image;
			const items = fuzzyFilter(prefix, typeItems);
			const from = offset + tokens[1].startOffset;
			return { items, from, to: inputLength, label: "Component types" };
		}

		return { items: [], from: offset, to: inputLength };
	}

	private completeSet(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
		componentItems: CompletionItem[],
	): CompletionResult {
		// After "set " — complete with component IDs
		if (tokens.length === 1 && trailingSpace) {
			return { items: componentItems, from: offset + segment.length, to: inputLength, label: "Components" };
		}

		// Find the dot separating target from property
		const dotIndex = tokens.findIndex((t) => t.image === ".");
		if (dotIndex === -1) {
			// No dot yet — still typing target
			if (!trailingSpace) {
				const lastToken = tokens[tokens.length - 1];
				const prefix = lastToken.image;
				const items = fuzzyFilter(prefix, componentItems);
				const from = offset + lastToken.startOffset;
				return { items, from, to: inputLength, label: "Components" };
			}
			return { items: componentItems, from: offset + segment.length, to: inputLength, label: "Components" };
		}

		// Dot found — resolve target and complete property names
		const targetTokens = tokens.slice(1, dotIndex);
		let targetName: string;
		if (targetTokens.length === 1 && targetTokens[0].tokenType.name === "QuotedString") {
			targetName = stripQuotes(targetTokens[0].image);
		} else {
			targetName = targetTokens.map((t) => t.image).join(" ");
		}

		// Look up component type from tree, then get properties
		const propItems = this.getPropertyCompletionItems(targetName);

		const propIndex = dotIndex + 1;
		if (propIndex >= tokens.length) {
			return { items: propItems, from: offset + segment.length, to: inputLength, label: `${targetName} properties` };
		}
		if (!trailingSpace) {
			const prefix = tokens[propIndex].image;
			const items = fuzzyFilter(prefix, propItems);
			const from = offset + tokens[propIndex].startOffset;
			return { items, from, to: inputLength, label: `${targetName} properties` };
		}

		return { items: [], from: offset, to: inputLength };
	}

	/** Get property completion items for a component by looking up its type in the tree and property map. */
	private getPropertyCompletionItems(componentId: string): CompletionItem[] {
		const items: CompletionItem[] = [];

		// Common properties shared by all ScriptComponent subclasses
		for (const p of COMMON_COMPONENT_PROPERTIES) {
			items.push({ label: p, detail: "common" });
		}

		// Type-specific properties from the property map
		if (this.componentProperties) {
			const node = findNodeById(this.treeRoot, componentId);
			const componentType = node?.type;
			if (componentType) {
				const props = this.componentProperties[componentType];
				if (props) {
					for (const [name, def] of Object.entries(props)) {
						items.push({ label: name, detail: def.type });
					}
				}
			}
		}

		return items;
	}

	private completeTarget(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
		componentItems: CompletionItem[],
		label: string,
	): CompletionResult {
		if (tokens.length === 1 && trailingSpace) {
			return { items: componentItems, from: offset + segment.length, to: inputLength, label };
		}

		if (!trailingSpace) {
			const lastToken = tokens[tokens.length - 1];
			const prefix = lastToken.image;
			const items = fuzzyFilter(prefix, componentItems);
			const from = offset + lastToken.startOffset;
			return { items, from, to: inputLength, label };
		}

		return { items: [], from: offset, to: inputLength };
	}

	// ── Tree fetching ───────────────────────────────────────────

	/** Fetch the component tree from HISE and update treeRoot.
	 *  Detects plan state via undo diff — uses ?group=current when a plan group is active. */
	async fetchTree(connection: import("../hise.js").HiseConnection): Promise<void> {
		let inPlan = false;
		const diffResp = await connection.get("/api/undo/diff?scope=group");
		if (isEnvelopeResponse(diffResp) && diffResp.success) {
			const groupName = diffResp.groupName as string | undefined;
			inPlan = typeof groupName === "string" && groupName !== "root";
		}

		const base = `/api/ui/tree?moduleId=${encodeURIComponent(this.moduleId)}`;
		const endpoint = inPlan ? `${base}&group=current` : base;
		const response = await connection.get(endpoint);
		if (isErrorResponse(response)) return;
		if (!isEnvelopeResponse(response) || !response.success) return;
		try {
			this.treeRoot = normalizeUiTreeResponse(response.result);
		} catch {
			// Normalization failed — keep existing tree
		}
	}

	/** Lazily fetch the tree on first parse if connected and not yet fetched. */
	private async ensureTree(session: SessionContext): Promise<void> {
		if (!this.treeFetched && session.connection) {
			this.treeFetched = true;
			await this.fetchTree(session.connection);
		}
	}

	// ── Parse entry point ───────────────────────────────────────

	async parse(
		input: string,
		session: SessionContext,
	): Promise<CommandResult> {
		await this.ensureTree(session);

		const trimmed = input.trim();
		const parts = trimmed.split(/\s+/);
		const keyword = parts[0]?.toLowerCase();

		// ── Navigation commands (handled before Chevrotain parser) ──
		if (keyword === "cd") {
			let cdTarget = parts.slice(1).join(" ").trim();
			if (cdTarget.startsWith('"') && cdTarget.endsWith('"')) {
				cdTarget = cdTarget.slice(1, -1);
			}
			return this.handleCd(cdTarget, session);
		}
		if (keyword === "ls" || keyword === "dir") {
			return this.handleLs();
		}
		if (keyword === "pwd") {
			return this.handlePwd();
		}

		// ── Chevrotain-parsed UI commands ──
		const result = parseUiInput(input);

		if ("error" in result) {
			return errorResult(result.error);
		}

		let lastResult: CommandResult = textResult("(no commands)");
		for (const cmd of result.commands) {
			lastResult = await this.dispatchCommand(cmd, session);
			if (lastResult.type === "error") return lastResult;
		}
		return lastResult;
	}

	// ── Navigation handlers ─────────────────────────────────────

	private handleCd(target: string, session: SessionContext): CommandResult {
		if (!target || target === "/") {
			this.currentPath = [];
			return textResult("/");
		}

		if (target === "..") {
			if (this.currentPath.length === 0) {
				return session.popMode();
			}
			this.currentPath.pop();
			return textResult(this.currentPath.length > 0 ? this.currentPath.join(".") : "/");
		}

		const segments = target.split(".").filter((s) => s !== "");
		for (const seg of segments) {
			if (seg === "..") {
				if (this.currentPath.length > 0) this.currentPath.pop();
			} else {
				if (this.treeRoot) {
					const node = findNodeById(this.treeRoot, seg);
					if (!node) {
						return errorResult(`"${seg}" not found in component tree.`);
					}
				}
				this.currentPath.push(seg);
			}
		}
		return textResult(this.currentPath.join("."));
	}

	private handleLs(): CommandResult {
		if (!this.treeRoot) {
			const path = this.currentPath.length > 0 ? this.currentPath.join(".") : "/";
			return textResult(`${path}: listing children requires a HISE connection`);
		}

		let node: TreeNode | null = this.treeRoot;
		if (this.currentPath.length > 0) {
			node = findNodeById(this.treeRoot, this.currentPath[this.currentPath.length - 1]);
		}
		if (!node) {
			return errorResult(`Path not found: ${this.currentPath.join(".")}`);
		}

		if (!node.children || node.children.length === 0) {
			return textResult(`${node.label}: (no children)`);
		}

		return tableResult(
			["Name", "Type"],
			node.children.map((c) => [
				c.label,
				c.type ?? "",
			]),
		);
	}

	private handlePwd(): CommandResult {
		return textResult(this.currentPath.length > 0 ? this.currentPath.join(".") : "/");
	}

	// ── Command dispatch and execution ──────────────────────────

	private async dispatchCommand(
		cmd: UiCommand,
		session: SessionContext,
	): Promise<CommandResult> {
		// Get command — fetch single property or component value
		if (cmd.type === "get") {
			if (cmd.prop === "value") {
				return this.handleGetValue(cmd.target, session.connection ?? null);
			}
			return this.handleGet(cmd, session.connection ?? null);
		}

		// Set value — uses dedicated /api/set_component_value endpoint
		if (cmd.type === "set" && cmd.prop === "value") {
			return this.handleSetValue(cmd.target, cmd.value, session.connection ?? null);
		}

		// Show command — fetch properties from HISE and display as table
		if (cmd.type === "show") {
			return this.handleShow(cmd, session.connection ?? null);
		}

		// Local validation for add commands
		if (cmd.type === "add") {
			const typeError = validateComponentType(cmd.componentType);
			if (typeError) {
				return errorResult(typeError);
			}
		}

		// If no connection, return local-only result
		if (!session.connection) {
			return this.localFallback(cmd);
		}

		// Build API operations
		const opsResult = commandToOps(cmd, this.currentPath);
		if ("error" in opsResult) {
			return errorResult(opsResult.error);
		}

		const result = await this.executeOps(opsResult.ops, session.connection);

		// For successful set commands, fetch the actual value back from HISE
		if (cmd.type === "set" && result.type !== "error") {
			const echo = await this.echoSetProperty(cmd, session.connection);
			if (echo) return echo;
		}

		return result;
	}

	/** Execute operations against POST /api/ui/apply, re-fetch tree. */
	private async executeOps(
		ops: UiOp[],
		connection: import("../hise.js").HiseConnection,
	): Promise<CommandResult> {
		const response = await connection.post("/api/ui/apply", {
			moduleId: this.moduleId,
			operations: ops,
		});

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isEnvelopeResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}
		if (!response.success) {
			const msg = response.errors.length > 0
				? response.errors.map((e) => e.errorMessage).join("\n")
				: "UI operation failed";
			return errorResult(msg);
		}

		// Re-fetch the tree to get the updated state
		await this.fetchTree(connection);

		// Apply diff markers only for the operations in this batch —
		// not the cumulative diff from the undo system, which would
		// mark every component added this session as "added".
		if (this.treeRoot) {
			const localDiff = ops.map(op => {
				const action = op.op === "add" ? "+" as const
					: op.op === "remove" ? "-" as const
					: "*" as const;
				const target = (op as Record<string, unknown>).target as string
					?? (op as Record<string, unknown>).id as string
					?? "";
				return { domain: "ui", action, target };
			}).filter(d => d.target);
			applyUiDiffToTree(this.treeRoot, localDiff);
		}

		// Build a human-readable summary from logs
		const summary = response.logs.length > 0
			? response.logs.join("; ")
			: ops.map((o) => `${o.op} ${(o as Record<string, unknown>).target ?? (o as Record<string, unknown>).id ?? ""}`).join(", ") || "OK";

		return textResult(summary);
	}

	/** Handle show command — show tree or fetch component properties from HISE. */
	private async handleShow(
		cmd: UiShowCommand,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (cmd.what === "tree") {
			if (!this.treeRoot) {
				return textResult("No component tree available (requires HISE connection).");
			}
			return textResult(renderTreeText(this.treeRoot, 0));
		}

		if (!connection) {
			return textResult(`show ${cmd.target} (no HISE connection)`);
		}

		const response = await connection.get(
			`/api/get_component_properties?moduleId=${encodeURIComponent(this.moduleId)}&id=${encodeURIComponent(cmd.target!)}`,
		);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}

		// The response shape is { success, type, properties: [{id, value, isDefault}] }
		// — not the standard envelope (no "result" field).
		const data = response as unknown as Record<string, unknown>;
		if (!data.success) {
			const errors = (data as { errors?: Array<{ errorMessage: string }> }).errors;
			const msg = errors?.[0]?.errorMessage ?? `Could not fetch properties for "${cmd.target}"`;
			return errorResult(msg);
		}

		const properties = data.properties as Array<{ id: string; value: unknown; isDefault: boolean }> | undefined;
		if (!properties || !Array.isArray(properties)) {
			return textResult(`${cmd.target}: no properties`);
		}

		const componentType = typeof data.type === "string" ? data.type : "";
		const rows = properties.map((p) => [
			p.id,
			String(p.value),
			p.isDefault ? "" : "*",
		]);

		return tableResult(
			["Property", "Value", ""],
			rows,
		);
	}

	/** Set a component's runtime value via /api/set_component_value. */
	private async handleSetValue(
		target: string,
		value: string | number,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (!connection) {
			return textResult(`set ${target}.value ${value} (no HISE connection)`);
		}

		const response = await connection.post("/api/set_component_value", {
			moduleId: this.moduleId,
			id: target,
			value,
		});

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (isEnvelopeResponse(response) && !response.success) {
			const msg = response.errors.length > 0
				? response.errors.map((e) => e.errorMessage).join("\n")
				: `Failed to set value on "${target}"`;
			return errorResult(msg);
		}

		// Echo back the actual value from HISE
		const echo = await this.handleGetValue(target, connection);
		return echo;
	}

	/** Get a component's runtime value via /api/get_component_value. */
	private async handleGetValue(
		target: string,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (!connection) {
			return textResult(`get ${target}.value (no HISE connection)`);
		}

		const response = await connection.get(
			`/api/get_component_value?moduleId=${encodeURIComponent(this.moduleId)}&id=${encodeURIComponent(target)}`,
		);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}

		const data = response as unknown as Record<string, unknown>;
		if (data.success === false) {
			const errors = (data as { errors?: Array<{ errorMessage: string }> }).errors;
			const msg = errors?.[0]?.errorMessage ?? `Could not get value for "${target}"`;
			return errorResult(msg);
		}

		return textResult(String(data.value ?? ""));
	}

	/** Handle get command — fetch a single property value from HISE. */
	private async handleGet(
		cmd: UiGetCommand,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (!connection) {
			return textResult(`get ${cmd.target}.${cmd.prop} (no HISE connection)`);
		}

		const response = await connection.get(
			`/api/get_component_properties?moduleId=${encodeURIComponent(this.moduleId)}&id=${encodeURIComponent(cmd.target)}`,
		);

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}

		const data = response as unknown as Record<string, unknown>;
		if (!data.success) {
			const errors = (data as { errors?: Array<{ errorMessage: string }> }).errors;
			const msg = errors?.[0]?.errorMessage ?? `Could not fetch properties for "${cmd.target}"`;
			return errorResult(msg);
		}

		const properties = data.properties as Array<{ id: string; value: unknown }> | undefined;
		if (!properties) {
			return errorResult(`${cmd.target}: no properties`);
		}

		const prop = properties.find((p) => p.id === cmd.prop);
		if (!prop) {
			return errorResult(`Property "${cmd.prop}" not found on "${cmd.target}"`);
		}

		return textResult(String(prop.value));
	}

	/** After a successful set, fetch the property back from HISE and echo it. */
	private async echoSetProperty(
		cmd: UiSetCommand,
		connection: import("../hise.js").HiseConnection,
	): Promise<CommandResult | null> {
		const response = await connection.get(
			`/api/get_component_properties?moduleId=${encodeURIComponent(this.moduleId)}&id=${encodeURIComponent(cmd.target)}`,
		);
		if (isErrorResponse(response)) return null;
		const data = response as unknown as Record<string, unknown>;
		if (!data.success) return null;
		const properties = data.properties as Array<{ id: string; value: unknown }> | undefined;
		if (!properties) return null;
		const prop = properties.find((p) => p.id === cmd.prop);
		if (!prop) return null;
		return textResult(`${cmd.target}.${cmd.prop}: ${prop.value}`);
	}

	/** Fallback for disconnected mode — description only. */
	private localFallback(cmd: UiCommand): CommandResult {
		switch (cmd.type) {
			case "add": {
				const parts = [`add ${cmd.componentType}`];
				if (cmd.name) parts.push(`"${cmd.name}"`);
				if (cmd.x !== undefined) {
					parts.push(`at ${cmd.x} ${cmd.y} ${cmd.width} ${cmd.height}`);
				}
				return textResult(`${parts.join(" ")} (no HISE connection)`);
			}
			case "remove":
				return textResult(`remove ${cmd.target} (no HISE connection)`);
			case "set":
				return textResult(`set ${cmd.target}.${cmd.prop} to ${cmd.value} (no HISE connection)`);
			case "move":
				return textResult(`move ${cmd.target} to ${cmd.parent}${cmd.index !== undefined ? ` at ${cmd.index}` : ""} (no HISE connection)`);
			case "rename":
				return textResult(`rename ${cmd.target} to "${cmd.newName}" (no HISE connection)`);
			case "get":
				return textResult(`get ${cmd.target}.${cmd.prop} (no HISE connection)`);
			case "show":
				return textResult(`show ${cmd.target ?? "tree"} (no HISE connection)`);
		}
	}
}

/** Simple text rendering of the component tree for `show tree` command. */
function renderTreeText(node: TreeNode, depth: number): string {
	const indent = "  ".repeat(depth);
	const typeInfo = node.type ? ` (${node.type})` : "";
	let line = `${indent}${node.label}${typeInfo}`;

	if (node.children) {
		for (const child of node.children) {
			line += "\n" + renderTreeText(child, depth + 1);
		}
	}
	return line;
}
