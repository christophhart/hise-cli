// ── Builder mode — Chevrotain parser + HISE execution ───────────────

// Phase 4.2: Commands execute against live HISE via POST /api/builder/apply.
// Falls back to local-only validation when no connection is available.

import { CstParser, type IToken } from "chevrotain";
import { closest } from "fastest-levenshtein";
import type { CommandResult } from "../result.js";
import {
	errorResult,
	tableResult,
	textResult,
} from "../result.js";
import type {
	DataLoader,
	ModuleDefinition,
	ModuleList,
} from "../data.js";
import { ConstrainerParser } from "../constrainer-parser.js";
import type { TreeNode } from "../result.js";
import type { TokenSpan } from "../highlight/tokens.js";
import { tokenizeBuilder } from "../highlight/builder.js";
import type { CompletionItem, CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import {
	isErrorResponse,
	isEnvelopeResponse,
} from "../hise.js";
import {
	normalizeBuilderTreeResponse,
	normalizeBuilderApplyResult,
	applyDiffToTree,
} from "../../mock/contracts/builder.js";

// ── Chain color constants (FX and MIDI are always fixed) ────────────

const FX_CHAIN_COLOUR = "#3a6666";
const MIDI_CHAIN_COLOUR = "#C65638";
const FALLBACK_CHAIN_COLOUR = "#666666"; // grey for chains with no resolved colour

/**
 * Walk a TreeNode tree and propagate chain colors + dot styles.
 *
 * Rules:
 * - Chain nodes: filledDot = false (○). colour = own colour, or
 *   FX/MIDI constant, or inherited from parent chain, or grey fallback.
 * - Module nodes inside a chain: filledDot = true (●). colour = inherited.
 * - Sound generators (not in a chain): no dot (filledDot/colour undefined).
 *   Their children start with a fresh colour context.
 *
 * Mutates the tree in place and returns it.
 */
type DiffStatus = "added" | "removed" | "modified";

function propagateChainColors(
	node: TreeNode,
	parentChainColour: string | null = null,
	parentDiff?: DiffStatus,
	depth: number = 0,
): TreeNode {
	// ── Resolve diff status ─────────────────────────────────────
	// Node's own diff wins. Otherwise inherit added/removed from parent.
	// "modified" is never inherited — it stays on the node that set it.
	const resolvedDiff: DiffStatus | undefined = node.diff
		?? (parentDiff === "added" || parentDiff === "removed" ? parentDiff : undefined);
	node.diff = resolvedDiff;

	// Diff to pass to children: propagate added/removed, not modified
	const childDiff: DiffStatus | undefined =
		resolvedDiff === "added" || resolvedDiff === "removed" ? resolvedDiff : undefined;

	if (node.nodeKind === "chain") {
		// Resolve this chain's colour
		let colour: string;
		if (node.colour && typeof node.colour === "string" && node.colour.startsWith("#")) {
			// Explicit hex colour from data
			colour = node.colour;
		} else if (node.label === "FX Chain") {
			colour = FX_CHAIN_COLOUR;
		} else if (node.label === "MIDI Processor Chain") {
			colour = MIDI_CHAIN_COLOUR;
		} else if (parentChainColour) {
			// Inherit from parent chain (sub-chains like AttackTimeModulation)
			colour = parentChainColour;
		} else {
			colour = FALLBACK_CHAIN_COLOUR;
		}

		node.colour = colour;
		node.filledDot = false; // unfilled ○
		// Dim empty chains (no children or empty children array)
		node.dimmed = !node.children || node.children.length === 0;

		// Propagate to children
		if (node.children) {
			for (const child of node.children) {
				propagateChainColors(child, colour, childDiff, depth + 1);
			}
		}
	} else if (node.nodeKind === "module" && parentChainColour) {
		// Module inside a chain — filled dot, inherited colour
		node.colour = parentChainColour;
		node.filledDot = true; // filled ●

		// Module's children (e.g. AHDSR's sub-chains) inherit the same colour
		if (node.children) {
			for (const child of node.children) {
				propagateChainColors(child, parentChainColour, childDiff, depth + 1);
			}
		}
	} else {
		// Sound generator or module not in a chain — no dot
		node.colour = undefined;
		node.filledDot = undefined;
		// Sound generators at depth > 0 get topMargin for visual separation
		// (root node is excluded — sidebar top padding handles that separately)
		node.topMargin = depth > 0;

		// Children start with fresh colour context (null) but inherit diff
		if (node.children) {
			for (const child of node.children) {
				propagateChainColors(child, null, childDiff, depth + 1);
			}
		}
	}

	return node;
}
import type { CompletionEngine } from "../completion/engine.js";
import { fuzzyFilter } from "../completion/engine.js";
import {
	Add,
	As,
	Bypass,
	Clone,
	Enable,
	Get,
	Into,
	Load,
	Move,
	Remove,
	Rename,
	builderLexer,
	Dot,
	Identifier,
	NumberLiteral,
	QuotedString,
	Set,
	Show,
	To,
	Tree,
	Types,
	XCount,
	BUILDER_TOKENS,
	VERB_KEYWORDS,
} from "./tokens.js";

// ── Chevrotain CST Parser ───────────────────────────────────────────

class BuilderParser extends CstParser {
	constructor() {
		super(BUILDER_TOKENS);
		this.performSelfAnalysis();
	}

	// Reusable: multi-word target (greedy Identifier+ or QuotedString)
	public targetRef = this.RULE("targetRef", () => {
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quoted" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "words" })) },
		]);
	});

	// add <type> [as "<name>"] [to <target>[.<chain>]]
	// Type can be multi-word (e.g., "Noise Generator") — greedy Identifier+ or QuotedString.
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.OR2([
			{ ALT: () => this.CONSUME3(QuotedString, { LABEL: "quotedType" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME2(Identifier, { LABEL: "moduleType" })) },
		]);
		this.OPTION(() => {
			this.CONSUME(As);
			this.OR3([
				{ ALT: () => this.CONSUME(QuotedString, { LABEL: "alias" }) },
				{ ALT: () => this.AT_LEAST_ONE2(() => this.CONSUME4(Identifier, { LABEL: "aliasWords" })) },
			]);
		});
		this.OPTION2(() => {
			this.CONSUME(To);
			this.SUBRULE(this.targetRef, { LABEL: "parent" });
			this.OPTION3(() => {
				this.CONSUME(Dot);
				this.CONSUME3(Identifier, { LABEL: "chain" });
			});
		});
	});

	// clone <target> [x<count>]
	public cloneCommand = this.RULE("cloneCommand", () => {
		this.CONSUME(Clone);
		this.SUBRULE(this.targetRef, { LABEL: "source" });
		this.OPTION(() => {
			this.CONSUME(XCount, { LABEL: "count" });
		});
	});

	// remove <target>
	public removeCommand = this.RULE("removeCommand", () => {
		this.CONSUME(Remove);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
	});

	// move <target> to <parent>[.<chain>]
	public moveCommand = this.RULE("moveCommand", () => {
		this.CONSUME(Move);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
		this.CONSUME(To);
		this.SUBRULE2(this.targetRef, { LABEL: "parent" });
		this.OPTION(() => {
			this.CONSUME(Dot);
			this.CONSUME(Identifier, { LABEL: "chain" });
		});
	});

	// rename <target> to "<name>"
	public renameCommand = this.RULE("renameCommand", () => {
		this.CONSUME(Rename);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
		this.CONSUME(To);
		this.CONSUME(QuotedString, { LABEL: "name" });
	});

	// set <target>.<param> [to] <value>
	// Target is multi-word Identifier+ terminated by Dot, then param + value.
	public setCommand = this.RULE("setCommand", () => {
		this.CONSUME(Set);
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quotedTarget" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "targetWords" })) },
		]);
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "param" });
		this.OPTION(() => {
			this.CONSUME(To);
		});
		this.OR2([
			{ ALT: () => this.CONSUME(NumberLiteral, { LABEL: "numValue" }) },
			{ ALT: () => this.CONSUME2(QuotedString, { LABEL: "strValue" }) },
			{ ALT: () => this.CONSUME3(Identifier, { LABEL: "idValue" }) },
		]);
	});

	// load "<source>" into <target>
	public loadCommand = this.RULE("loadCommand", () => {
		this.CONSUME(Load);
		this.CONSUME(QuotedString, { LABEL: "source" });
		this.CONSUME(Into);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
	});

	// bypass <target>
	public bypassCommand = this.RULE("bypassCommand", () => {
		this.CONSUME(Bypass);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
	});

	// enable <target>
	public enableCommand = this.RULE("enableCommand", () => {
		this.CONSUME(Enable);
		this.SUBRULE(this.targetRef, { LABEL: "target" });
	});

	// show tree | show types [filter] | show <target>
	public showCommand = this.RULE("showCommand", () => {
		this.CONSUME(Show);
		this.OR([
			{ ALT: () => this.CONSUME(Tree, { LABEL: "tree" }) },
			{ ALT: () => {
				this.CONSUME(Types, { LABEL: "types" });
				this.OPTION(() => {
					this.CONSUME(Identifier, { LABEL: "filter" });
				});
			}},
			{ ALT: () => this.SUBRULE(this.targetRef, { LABEL: "target" }) },
		]);
	});

	// get <target>.<param>
	public getCommand = this.RULE("getCommand", () => {
		this.CONSUME(Get);
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quotedTarget" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "targetWords" })) },
		]);
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "param" });
	});

	// Top-level entry: dispatches to sub-rules
	public command = this.RULE("command", () => {
		this.OR([
			{ ALT: () => this.SUBRULE(this.addCommand) },
			{ ALT: () => this.SUBRULE(this.cloneCommand) },
			{ ALT: () => this.SUBRULE(this.removeCommand) },
			{ ALT: () => this.SUBRULE(this.moveCommand) },
			{ ALT: () => this.SUBRULE(this.renameCommand) },
			{ ALT: () => this.SUBRULE(this.setCommand) },
			{ ALT: () => this.SUBRULE(this.getCommand) },
			{ ALT: () => this.SUBRULE(this.loadCommand) },
			{ ALT: () => this.SUBRULE(this.bypassCommand) },
			{ ALT: () => this.SUBRULE(this.enableCommand) },
			{ ALT: () => this.SUBRULE(this.showCommand) },
		]);
	});
}

const parser = new BuilderParser();

// ── Parsed command types ────────────────────────────────────────────

export interface AddCommand {
	type: "add";
	moduleType: string;
	alias?: string;
	parent?: string;
	chain?: string;
}

export interface CloneCommand {
	type: "clone";
	source: string;
	count: number;
}

export interface RemoveCommand {
	type: "remove";
	target: string;
}

export interface MoveCommand {
	type: "move";
	target: string;
	parent: string;
	chain?: string;
}

export interface RenameCommand {
	type: "rename";
	target: string;
	name: string;
}

export interface SetCommand {
	type: "set";
	target: string;
	param: string;
	value: string | number;
}

export interface LoadCommand {
	type: "load";
	source: string;
	target: string;
}

export interface BypassCommand {
	type: "bypass";
	target: string;
}

export interface EnableCommand {
	type: "enable";
	target: string;
}

export interface GetCommand {
	type: "get";
	target: string;
	param: string;
}

export interface ShowCommand {
	type: "show";
	what: "tree" | "types" | "target";
	target?: string;
	filter?: string;
}

export type BuilderCommand =
	| AddCommand
	| CloneCommand
	| RemoveCommand
	| MoveCommand
	| RenameCommand
	| SetCommand
	| GetCommand
	| LoadCommand
	| BypassCommand
	| EnableCommand
	| ShowCommand;

// ── Comma pre-processor + parse ─────────────────────────────────────

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
 * Does not handle comma chaining — use parseBuilderInput for that.
 */
export function parseSingleCommand(
	input: string,
): { command: BuilderCommand } | { error: string } {
	const lexResult = builderLexer.tokenize(input);
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
 * Parse builder input with comma chaining support.
 * Returns an array of commands. Supports verb inheritance and
 * set target inheritance across comma-separated segments.
 */
export function parseBuilderInput(
	input: string,
): { commands: BuilderCommand[] } | { error: string } {
	const segments = splitByComma(input);
	let lastVerb: string | null = null;
	let lastSetTarget: string | null = null;
	const commands: BuilderCommand[] = [];

	for (let i = 0; i < segments.length; i++) {
		const trimmed = segments[i].trim();
		if (!trimmed) continue;

		const firstToken = trimmed.split(/\s/)[0].toLowerCase();
		const isKeyword = VERB_KEYWORDS.has(firstToken);

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

		const result = parseSingleCommand(toParse);
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

// ── CST extractors ──────────────────────────────────────────────────

function extractCommand(
	cst: any,
): { command: BuilderCommand } | { error: string } {
	const c = cst.children;
	if (c.addCommand) return extractAddCommand(c.addCommand[0]);
	if (c.cloneCommand) return extractCloneCommand(c.cloneCommand[0]);
	if (c.removeCommand) return extractTargetCommand(c.removeCommand[0], "remove");
	if (c.moveCommand) return extractMoveCommand(c.moveCommand[0]);
	if (c.renameCommand) return extractRenameCommand(c.renameCommand[0]);
	if (c.setCommand) return extractSetCommand(c.setCommand[0]);
	if (c.getCommand) return extractGetCommand(c.getCommand[0]);
	if (c.loadCommand) return extractLoadCommand(c.loadCommand[0]);
	if (c.bypassCommand) return extractTargetCommand(c.bypassCommand[0], "bypass");
	if (c.enableCommand) return extractTargetCommand(c.enableCommand[0], "enable");
	if (c.showCommand) return extractShowCommand(c.showCommand[0]);
	return { error: "Unknown command structure" };
}

/** Extract a multi-word target from a targetRef subrule CST node. */
function extractTargetRef(node: any): string {
	if (node.children.quoted) {
		return stripQuotes((node.children.quoted[0] as IToken).image);
	}
	// Multi-word: join all Identifier tokens with spaces
	const words = (node.children.words as IToken[]).map((t) => t.image);
	return words.join(" ");
}

function extractAddCommand(
	node: any,
): { command: AddCommand } | { error: string } {
	let moduleType: string;
	if (node.children.quotedType) {
		moduleType = stripQuotes((node.children.quotedType[0] as IToken).image);
	} else {
		const words = (node.children.moduleType as IToken[]).map((t) => t.image);
		moduleType = words.join(" ");
	}
	const alias = node.children.alias
		? stripQuotes((node.children.alias[0] as IToken).image)
		: node.children.aliasWords
			? (node.children.aliasWords as IToken[]).map((t) => t.image).join(" ")
			: undefined;
	const parent = node.children.parent
		? extractTargetRef(node.children.parent[0])
		: undefined;
	const chain = node.children.chain
		? (node.children.chain[0] as IToken).image
		: undefined;

	return {
		command: { type: "add", moduleType, alias, parent, chain },
	};
}

function extractCloneCommand(
	node: any,
): { command: CloneCommand } | { error: string } {
	const source = extractTargetRef(node.children.source[0]);
	const countToken = node.children.count
		? (node.children.count[0] as IToken).image
		: undefined;
	const count = countToken ? parseInt(countToken.slice(1), 10) : 1;
	return { command: { type: "clone", source, count } };
}

/** Generic extractor for commands with just a target (remove, bypass, enable). */
function extractTargetCommand(
	node: any,
	type: "remove" | "bypass" | "enable",
): { command: RemoveCommand | BypassCommand | EnableCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	return { command: { type, target } };
}

function extractMoveCommand(
	node: any,
): { command: MoveCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	const parent = extractTargetRef(node.children.parent[0]);
	const chain = node.children.chain
		? (node.children.chain[0] as IToken).image
		: undefined;
	return { command: { type: "move", target, parent, chain } };
}

function extractRenameCommand(
	node: any,
): { command: RenameCommand } | { error: string } {
	const target = extractTargetRef(node.children.target[0]);
	const name = stripQuotes((node.children.name[0] as IToken).image);
	return { command: { type: "rename", target, name } };
}

function extractSetCommand(
	node: any,
): { command: SetCommand } | { error: string } {
	// Target: quoted or multi-word identifiers before the dot
	let target: string;
	if (node.children.quotedTarget) {
		target = stripQuotes((node.children.quotedTarget[0] as IToken).image);
	} else {
		const words = (node.children.targetWords as IToken[]).map((t) => t.image);
		target = words.join(" ");
	}

	const param = (node.children.param[0] as IToken).image;

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

	return { command: { type: "set", target, param, value } };
}

function extractGetCommand(
	node: any,
): { command: GetCommand } | { error: string } {
	let target: string;
	if (node.children.quotedTarget) {
		target = stripQuotes((node.children.quotedTarget[0] as IToken).image);
	} else {
		const words = (node.children.targetWords as IToken[]).map((t) => t.image);
		target = words.join(" ");
	}
	const param = (node.children.param[0] as IToken).image;
	return { command: { type: "get", target, param } };
}

function extractLoadCommand(
	node: any,
): { command: LoadCommand } | { error: string } {
	const source = stripQuotes((node.children.source[0] as IToken).image);
	const target = extractTargetRef(node.children.target[0]);
	return { command: { type: "load", source, target } };
}

function extractShowCommand(
	node: any,
): { command: ShowCommand } | { error: string } {
	if (node.children.tree) {
		return { command: { type: "show", what: "tree" } };
	}
	if (node.children.types) {
		const filter = node.children.filter
			? (node.children.filter[0] as IToken).image
			: undefined;
		return { command: { type: "show", what: "types", filter } };
	}
	if (node.children.target) {
		const target = extractTargetRef(node.children.target[0]);
		return { command: { type: "show", what: "target", target } };
	}
	return { error: "Invalid show command" };
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

// ── Validation against moduleList.json ──────────────────────────────

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	suggestions?: string[];
}

export function validateAddCommand(
	cmd: AddCommand,
	moduleList: ModuleList,
): ValidationResult {
	const errors: string[] = [];
	const suggestions: string[] = [];

	// 1. Check module type exists (by pretty name or type ID)
	const module = findModuleByName(cmd.moduleType, moduleList);

	if (!module) {
		// Suggest closest match from both pretty names and type IDs
		const allNames = moduleList.modules.flatMap((m) => [m.prettyName, m.id]);
		const closestName = closest(cmd.moduleType, allNames);
		// Map back to the pretty name for display
		const closestModule = closestName
			? moduleList.modules.find((m) => m.prettyName === closestName || m.id === closestName)
			: undefined;
		const suggestion = closestModule?.prettyName;
		errors.push(`Unknown module type "${cmd.moduleType}".`);
		if (suggestion) {
			suggestions.push(suggestion);
			errors[0] += ` Did you mean "${suggestion}"?`;
		}
		return { valid: false, errors, suggestions };
	}

	// 2. Validate chain constraint if parent.chain specified
	if (cmd.chain) {
		const chainError = validateChainConstraint(
			module,
			cmd.chain,
			cmd.parent,
			moduleList,
		);
		if (chainError) {
			errors.push(chainError);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		suggestions,
	};
}

export function validateSetCommand(
	cmd: SetCommand,
	moduleList: ModuleList,
): ValidationResult {
	const errors: string[] = [];

	// Find the target module by pretty name or type ID (in builder context,
	// target is a module instance name — but for validation we check param
	// against all modules of matching type)
	const module = findModuleByName(cmd.target, moduleList);
	if (!module) {
		// Can't validate without knowing the module type
		return { valid: true, errors: [] };
	}

	// Check parameter exists
	const paramNames = module.parameters.map((p) => p.id);
	const param = module.parameters.find((p) => p.id === cmd.param);

	if (!param) {
		const suggestion = paramNames.length > 0
			? closest(cmd.param, paramNames)
			: undefined;
		let msg = `Unknown parameter "${cmd.param}" for ${module.id}.`;
		if (suggestion) {
			msg += ` Did you mean "${suggestion}"?`;
		}
		errors.push(msg);
		return { valid: false, errors };
	}

	// Check value range
	if (typeof cmd.value === "number") {
		if (cmd.value < param.range.min || cmd.value > param.range.max) {
			errors.push(
				`Value ${cmd.value} out of range for ${module.id}.${param.id} (${param.range.min}–${param.range.max}).`,
			);
		}
	}

	return { valid: errors.length === 0, errors };
}

/** Map chain name to the constrainer string from a parent module definition. */
function resolveChainConstrainer(
	parentModule: ModuleDefinition,
	chainName: string,
): string | null {
	const lower = chainName.toLowerCase();

	if (lower === "fx") {
		return parentModule.fx_constrainer ?? null;
	}

	if (lower === "children") {
		return parentModule.constrainer ?? null;
	}

	if (lower === "midi") {
		// midi chains only accept MidiProcessors - no constrainer string needed,
		// validated by type check below
		return null;
	}

	// Modulation chains: match by name (gain, pitch, or internal chain names)
	for (const mod of parentModule.modulation) {
		const modName = mod.id.toLowerCase().replace(/\s+/g, "");
		if (modName.includes(lower) || lower === `chain${mod.chainIndex}`) {
			return mod.constrainer;
		}
	}

	return null;
}

function validateChainConstraint(
	module: ModuleDefinition,
	chainName: string,
	parentName: string | undefined,
	moduleList: ModuleList,
): string | null {
	const lower = chainName.toLowerCase();

	// Basic type-level check: midi chains only accept MidiProcessors
	if (lower === "midi" && module.type !== "MidiProcessor") {
		return `${module.id} is a ${module.type}, not a MidiProcessor. Only MIDI processors can be added to midi chains.`;
	}

	// fx chains only accept Effects
	if (lower === "fx" && module.type !== "Effect") {
		return `${module.id} is a ${module.type}, not an Effect. Only effects can be added to fx chains.`;
	}

	// children chains only accept SoundGenerators
	if (lower === "children" && module.type !== "SoundGenerator") {
		return `${module.id} is a ${module.type}, not a SoundGenerator. Only sound generators can be added as children.`;
	}

	// Modulation chains (gain, pitch, etc.) only accept Modulators
	if (lower !== "midi" && lower !== "fx" && lower !== "children" && module.type !== "Modulator") {
		return `${module.id} is a ${module.type}, not a Modulator. Only modulators can be added to modulation chains.`;
	}

	// If parent is specified and matches a module type, do constrainer validation
	if (parentName) {
		const parentModule = findModuleByName(parentName, moduleList);
		if (parentModule) {
			const constrainerStr = resolveChainConstrainer(parentModule, chainName);
			if (constrainerStr) {
				const cp = new ConstrainerParser(constrainerStr);
				const result = cp.check({ id: module.id, subtype: module.subtype });
				if (!result.ok) {
					return `${module.id} cannot be added to ${parentName}.${chainName}: ${result.error}`;
				}
			}
		}
	}

	return null;
}

// ── Module name resolution ──────────────────────────────────────────

/**
 * Resolve a user-supplied module name (pretty name or type ID) to the
 * internal type ID. Users primarily work with pretty names ("Sampler"),
 * but type IDs ("StreamingSampler") are also accepted for power users.
 */
/** Look up a module definition by pretty name or type ID (case-insensitive fallback). */
function findModuleByName(
	name: string,
	moduleList: ModuleList,
): ModuleDefinition | undefined {
	const lower = name.toLowerCase();
	// Exact match first (prettyName → id), then case-insensitive fallback
	return moduleList.modules.find((m) => m.prettyName === name || m.id === name)
		?? moduleList.modules.find((m) => m.prettyName.toLowerCase() === lower || m.id.toLowerCase() === lower);
}

/**
 * Resolve a user-facing module name (pretty name or type ID) to the
 * internal type ID. Delegates to findModuleByName.
 */
export function resolveModuleTypeId(
	name: string,
	moduleList: ModuleList | null,
): string | null {
	if (!moduleList) return null;
	return findModuleByName(name, moduleList)?.id ?? null;
}

// ── Command → API operations mapping ────────────────────────────────

export interface BuilderOp {
	op: string;
	[key: string]: unknown;
}

/**
 * Resolve a chain name to the integer index expected by the HISE API.
 * -1 = direct children, 0 = midi, 1+ = modulation chains, 3 = fx (for top-level).
 * Named modulation chains are resolved from the parent's tree node.
 */
export function resolveChainIndex(
	chainName: string | undefined,
	moduleType: string | undefined,
	parentNode: TreeNode | null,
	moduleList: ModuleList | null,
): number {
	if (!chainName) {
		// No chain specified: auto-resolve by module type
		if (!moduleType || !moduleList) return -1;
		const mod = moduleList.modules.find((m) => m.id === moduleType);
		if (!mod) return -1;
		// SoundGenerators go to children, Effects to fx, MidiProcessors to midi,
		// Modulators need explicit chain
		switch (mod.type) {
			case "Effect": return 3;
			case "MidiProcessor": return 0;
			default: return -1;
		}
	}

	const lower = chainName.toLowerCase().replace(/\s+/g, "");
	if (lower === "children" || lower === "direct") return -1;
	if (lower === "midi" || lower === "midiprocessorchain") return 0;
	if (lower === "fx" || lower === "fxchain") return 3;

	// Try well-known modulation chain names (short and full labels)
	if (lower === "gain" || lower === "gainmodulation") return 1;
	if (lower === "pitch" || lower === "pitchmodulation") return 2;

	// Look up named modulation chains from the parent tree node
	if (parentNode?.children) {
		for (const child of parentNode.children) {
			if (child.nodeKind === "chain" && child.label) {
				const chainLabel = child.label.toLowerCase().replace(/\s+/g, "");
				if (chainLabel.includes(lower)) {
					// Chains in our normalized tree don't carry chainIndex,
					// but modulation chains follow a known order: Gain=1, Pitch=2, etc.
					// Fall back to checking if the label matches standard patterns
					if (chainLabel.includes("gain")) return 1;
					if (chainLabel.includes("pitch")) return 2;
				}
			}
		}
	}

	// Last resort: try parsing as a number
	const num = parseInt(chainName, 10);
	if (!isNaN(num)) return num;

	// Default to direct children
	return -1;
}

/** Find a TreeNode by its id (processorId for modules, label for chains). Case-insensitive. */
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

/**
 * Resolve the parent node for a path — the second-to-last node.
 * For path ["SineSynth", "FX Chain"], returns the SineSynth node.
 */
function resolveParentByPath(tree: TreeNode | null, path: string[]): TreeNode | null {
	if (!tree || path.length <= 1) return tree;
	return resolveNodeByPath(tree, path.slice(0, -1));
}

/** Find the parent tree node of a node by its id (case-insensitive). */
function findParentNode(tree: TreeNode | null, childId: string): TreeNode | null {
	if (!tree) return null;
	const lower = childId.toLowerCase();
	if (tree.children) {
		for (const child of tree.children) {
			if (child.id?.toLowerCase() === lower) return tree;
			const found = findParentNode(child, childId);
			if (found) return found;
		}
	}
	return null;
}

/**
 * Convert a parsed BuilderCommand into HISE API operation(s).
 * Returns an array of ops (most commands produce exactly one).
 */
export function commandToOps(
	cmd: BuilderCommand,
	treeRoot: TreeNode | null,
	moduleList: ModuleList | null,
	currentPath: string[],
): { ops: BuilderOp[] } | { error: string } {
	switch (cmd.type) {
		case "add": {
			let parent: string;
			let explicitChain = cmd.chain;

			if (cmd.parent) {
				// Explicit parent given — use it directly
				parent = cmd.parent;
			} else if (currentPath.length > 0) {
				// Resolve from current path context using path-aware lookup
				const contextNode = resolveNodeByPath(treeRoot, currentPath);
				if (contextNode?.nodeKind === "chain") {
					// cd'd into a chain — parent is the module owning this chain
					const ownerNode = resolveParentByPath(treeRoot, currentPath);
					parent = ownerNode?.id ?? treeRoot?.id ?? "Master Chain";
					explicitChain = explicitChain ?? contextNode.label;
				} else {
					// cd'd into a module — use it as parent
					parent = contextNode?.id ?? currentPath[currentPath.length - 1];
				}
			} else {
				parent = treeRoot?.id ?? "Master Chain";
			}

			// If explicit parent (from `add X to Y.chain`) resolves to a chain, fix it up
			if (cmd.parent) {
				const parentNode = findNodeById(treeRoot, parent);
				if (parentNode?.nodeKind === "chain") {
					const actualParent = findParentNode(treeRoot, parent);
					if (actualParent) {
						explicitChain = explicitChain ?? parentNode.label;
						parent = actualParent.id ?? actualParent.label;
					}
				}
			}

			const resolvedParentNode = findNodeById(treeRoot, parent);
			// Resolve pretty name → type ID for the API, keep pretty name for default instance name
			const typeId = resolveModuleTypeId(cmd.moduleType, moduleList) ?? cmd.moduleType;
			const chainIndex = resolveChainIndex(explicitChain, typeId, resolvedParentNode, moduleList);
			const op: BuilderOp = {
				op: "add",
				type: typeId,
				parent,
				chain: chainIndex,
				name: cmd.alias ?? cmd.moduleType,
			};
			return { ops: [op] };
		}
		case "remove":
			return { ops: [{ op: "remove", target: cmd.target }] };
		case "clone":
			return { ops: [{ op: "clone", source: cmd.source, count: cmd.count }] };
		case "set":
			return { ops: [{ op: "set_attributes", target: cmd.target, attributes: { [cmd.param]: cmd.value } }] };
		case "rename":
			return { ops: [{ op: "set_id", target: cmd.target, name: cmd.name }] };
		case "bypass":
			return { ops: [{ op: "set_bypassed", target: cmd.target, bypassed: true }] };
		case "enable":
			return { ops: [{ op: "set_bypassed", target: cmd.target, bypassed: false }] };
		case "load":
			return { ops: [{ op: "set_effect", target: cmd.target, effect: cmd.source }] };
		case "move":
			return { error: "move is not yet supported by the HISE C++ API" };
		case "get":
			return { error: "get commands are handled locally" };
		case "show":
			return { error: "show commands are handled locally" };
	}
}

// ── Tree utilities ──────────────────────────────────────────────────

export interface ModuleInstance {
	id: string;    // processorId (instance name, e.g. "Osc 1")
	type: string;  // module type ID (e.g. "SineSynth")
}

/** Walk a TreeNode tree and collect all module instances with their types. */
export function collectModuleIds(tree: TreeNode | null): ModuleInstance[] {
	if (!tree) return [];
	const result: ModuleInstance[] = [];
	walkModules(tree, result);
	return result;
}

function walkModules(node: TreeNode, out: ModuleInstance[]): void {
	if (node.nodeKind === "module" && node.id && node.type) {
		out.push({ id: node.id, type: node.type });
	}
	if (node.children) {
		for (const child of node.children) {
			walkModules(child, out);
		}
	}
}

/** Build CompletionItems from module instances. Auto-quotes IDs with spaces. */
function moduleIdCompletionItems(modules: ModuleInstance[]): CompletionItem[] {
	return modules.map((m) => ({
		label: m.id,
		detail: m.type,
		insertText: m.id.includes(" ") ? `"${m.id}"` : m.id,
	}));
}

/** Resolve an instance name to its module type using the tree. */
function resolveInstanceType(
	instanceName: string,
	modules: ModuleInstance[],
): string | undefined {
	return modules.find((m) => m.id === instanceName)?.type;
}

// ── Builder mode class ──────────────────────────────────────────────

export class BuilderMode implements Mode {
	readonly id: Mode["id"] = "builder";
	readonly name = "Builder";
	readonly accent = MODE_ACCENTS.builder;
	readonly prompt = "[builder] > ";
	readonly treeLabel = "Module Tree";

	private moduleList: ModuleList | null = null;
	private readonly completionEngine: CompletionEngine | null;
	private currentPath: string[] = [];
	private treeRoot: TreeNode | null = null;
	compactView = false;

	constructor(moduleList?: ModuleList, completionEngine?: CompletionEngine, initialPath?: string, treeRoot?: TreeNode | null) {
		this.moduleList = moduleList ?? null;
		this.completionEngine = completionEngine ?? null;
		this.treeRoot = treeRoot ?? null;
		if (initialPath) {
			this.currentPath = initialPath.split(".").filter((s) => s !== "");
		}
	}

	tokenizeInput(value: string): TokenSpan[] {
		return tokenizeBuilder(value);
	}

	// ── Tree sidebar support ────────────────────────────────────

	getTree(): TreeNode | null {
		if (!this.treeRoot) return null;
		let tree = propagateChainColors(structuredClone(this.treeRoot));
		if (this.compactView) tree = compactTree(tree, this.currentPath);
		return tree;
	}

	getSelectedPath(): string[] {
		return [...this.currentPath];
	}

	selectNode(path: string[]): void {
		this.currentPath = [...path];
	}

	/** Dynamic context path shown in prompt (e.g. "SineGenerator.pitch") */
	get contextLabel(): string {
		return this.currentPath.length > 0 ? this.currentPath.join(".") : "";
	}

	setContext(path: string): void {
		this.currentPath = path.split(".").filter((s) => s !== "");
	}

	setModuleList(moduleList: ModuleList): void {
		this.moduleList = moduleList;
	}

	setTreeRoot(treeRoot: TreeNode | null): void {
		this.treeRoot = treeRoot;
	}

	complete(input: string, _cursor: number): CompletionResult {
		if (!this.completionEngine) {
			return { items: [], from: 0, to: input.length };
		}

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

	/**
	 * Complete a single segment (no commas). `offset` is the position
	 * within the full input where this segment starts.
	 */
	private completeSegment(
		segment: string,
		offset: number,
		inputLength: number,
	): CompletionResult {
		const engine = this.completionEngine!;
		const trimmed = segment.trimStart();
		const leadingSpaces = segment.length - trimmed.length;
		const trailingSpace = segment.endsWith(" ");

		// Lex with Chevrotain to get proper tokens (handles quotes, numbers, keywords)
		const lexResult = builderLexer.tokenize(trimmed);
		const tokens = lexResult.tokens;

		const empty: CompletionResult = { items: [], from: offset, to: inputLength };

		// No tokens or typing first word - suggest keywords
		if (tokens.length === 0 || (tokens.length === 1 && !trailingSpace)) {
			const prefix = tokens.length > 0 ? tokens[0].image.toLowerCase() : "";
			const items = engine.completeBuilderKeyword(prefix);
			return {
				items,
				from: offset + leadingSpaces,
				to: inputLength,
				label: "Builder keywords",
			};
		}

		const verb = tokens[0].image.toLowerCase();

		// ── cd <child> — complete with children of current node ──
		if (verb === "cd") {
			return this.completeCd(tokens, trailingSpace, offset, inputLength, segment);
		}

		const modules = collectModuleIds(this.treeRoot);
		const moduleItems = moduleIdCompletionItems(modules);

		// ── add <type> [as "<name>"] [to <target>[.<chain>]] ──
		if (verb === "add") {
			return this.completeAdd(tokens, trailingSpace, offset, inputLength, segment, modules, moduleItems);
		}

		// ── set <target>.<param> [to] <value> ──
		// ── get <target>.<param> ──
		if (verb === "set" || verb === "get") {
			return this.completeSet(tokens, trailingSpace, offset, inputLength, segment, modules);
		}

		// ── show tree | types [filter] | <target> ──
		if (verb === "show") {
			if (tokens.length === 1 && trailingSpace) {
				// Merge show subcommands + module IDs
				const showItems = engine.completeBuilderShow("");
				const items = [...showItems, ...moduleItems];
				return { items, from: offset + segment.length, to: inputLength, label: "Show arguments" };
			}
			if (tokens.length === 2 && !trailingSpace) {
				const prefix = tokens[1].image;
				const showItems = engine.completeBuilderShow(prefix);
				const idItems = fuzzyFilter(prefix, moduleItems);
				const items = [...showItems, ...idItems];
				const from = offset + (tokens[1].startOffset ?? 0) + leadingSpaces;
				return { items, from, to: inputLength, label: "Show arguments" };
			}
			return empty;
		}

		// ── Commands that take a single target: remove, clone, bypass, enable, rename ──
		const TARGET_COMMANDS = ["remove", "clone", "bypass", "enable", "rename", "move", "load"];
		if (TARGET_COMMANDS.includes(verb)) {
			return this.completeTarget(tokens, trailingSpace, offset, inputLength, segment, moduleItems);
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

		// Find the node at the current path
		const contextNode = resolveNodeByPath(this.treeRoot, this.currentPath) ?? this.treeRoot;
		if (!contextNode?.children) return empty;

		// Build completion items from children
		const childItems: CompletionItem[] = contextNode.children.map((c) => ({
			label: c.label,
			detail: c.nodeKind === "chain" ? "chain" : (c.type ?? ""),
			insertText: c.label.includes(" ") ? `"${c.label}"` : c.label,
		}));

		// "cd " — show all children
		if (tokens.length === 1 && trailingSpace) {
			return { items: childItems, from: offset + segment.length, to: inputLength, label: "Children" };
		}

		// "cd Fx" or "cd "FX Ch" — filter by prefix
		if (tokens.length >= 2) {
			const prefixTokens = tokens.slice(1);
			let prefix = prefixTokens.map((t) => t.image).join(" ");
			// Strip quotes from QuotedString tokens
			if (prefix.startsWith('"')) prefix = prefix.slice(1);
			if (prefix.endsWith('"')) prefix = prefix.slice(0, -1);
			const from = offset + prefixTokens[0].startOffset;
			const items = fuzzyFilter(prefix, childItems);
			return { items, from, to: inputLength, label: "Children" };
		}

		return empty;
	}

	/** Filter module type completions by the current chain's constrainer. */
	private filterByChainContext(items: CompletionItem[]): CompletionItem[] {
		const contextNode = resolveNodeByPath(this.treeRoot, this.currentPath);
		if (!contextNode || contextNode.nodeKind !== "chain" || !contextNode.chainConstrainer) {
			return items;
		}

		const constrainer = new ConstrainerParser(contextNode.chainConstrainer);
		return items.filter((item) => {
			// detail is the type ID (e.g., "SineSynth"), insertText is also the type ID
			const typeId = item.insertText ?? item.detail ?? item.label;
			const mod = this.moduleList?.modules.find((m) => m.id === typeId);
			if (!mod) return false;
			return constrainer.check({ id: mod.id, subtype: mod.subtype }).ok;
		});
	}

	private completeAdd(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
		modules: ModuleInstance[],
		moduleItems: CompletionItem[],
	): CompletionResult {
		const engine = this.completionEngine!;

		// Position 1: module type (filtered by chain context if cd'd into a chain)
		if (tokens.length === 1 && trailingSpace) {
			const items = this.filterByChainContext(engine.completeModuleType(""));
			return { items, from: offset + segment.length, to: inputLength, label: "Module types" };
		}
		if (tokens.length === 2 && !trailingSpace) {
			const prefix = tokens[1].image;
			const items = this.filterByChainContext(engine.completeModuleType(prefix));
			const from = offset + tokens[1].startOffset;
			return { items, from, to: inputLength, label: "Module types" };
		}

		// After type + space: check if "to" or "as" already present
		const lastToken = tokens[tokens.length - 1];
		const lastImage = lastToken.image.toLowerCase();

		// After "to" keyword - complete with module instance IDs
		if (lastImage === "to" && trailingSpace) {
			return { items: moduleItems, from: offset + segment.length, to: inputLength, label: "Module targets" };
		}

		// Typing after "to " - completing a target
		const toIndex = tokens.findIndex((t) => t.image.toLowerCase() === "to");
		if (toIndex !== -1 && toIndex < tokens.length - 1) {
			// Currently typing a target after "to"
			const targetTokens = tokens.slice(toIndex + 1);
			const lastTargetToken = targetTokens[targetTokens.length - 1];
			if (!trailingSpace && lastTargetToken.image !== ".") {
				const prefix = lastTargetToken.image;
				const items = fuzzyFilter(prefix, moduleItems);
				const from = offset + lastTargetToken.startOffset;
				return { items, from, to: inputLength, label: "Module targets" };
			}
		}

		return { items: [], from: offset, to: inputLength };
	}

	private completeSet(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
		modules: ModuleInstance[],
	): CompletionResult {
		const engine = this.completionEngine!;
		const moduleItems = moduleIdCompletionItems(modules);

		// After "set " - complete with module IDs (target before dot)
		if (tokens.length === 1 && trailingSpace) {
			return { items: moduleItems, from: offset + segment.length, to: inputLength, label: "Module targets" };
		}

		// Find the dot that separates target from param
		const dotIndex = tokens.findIndex((t) => t.image === ".");
		if (dotIndex === -1) {
			// No dot yet - still typing target
			if (!trailingSpace) {
				const lastToken = tokens[tokens.length - 1];
				const prefix = lastToken.image;
				const items = fuzzyFilter(prefix, moduleItems);
				const from = offset + lastToken.startOffset;
				return { items, from, to: inputLength, label: "Module targets" };
			}
			// Trailing space but no dot - still accumulating multi-word target
			return { items: moduleItems, from: offset + segment.length, to: inputLength, label: "Module targets" };
		}

		// Dot found - resolve target type and complete params
		const targetTokens = tokens.slice(1, dotIndex);
		let targetName: string;
		if (targetTokens.length === 1 && targetTokens[0].tokenType.name === "QuotedString") {
			targetName = stripQuotes(targetTokens[0].image);
		} else {
			targetName = targetTokens.map((t) => t.image).join(" ");
		}

		// Resolve instance to type for parameter lookup
		const moduleType = resolveInstanceType(targetName, modules)
			?? targetName; // fallback to treating target as type name

		const paramIndex = dotIndex + 1;
		if (paramIndex >= tokens.length) {
			// "set Target." or "set Target. " - complete params (dot is last token)
			const items = engine.completeModuleParam(moduleType, "");
			return { items, from: offset + segment.length, to: inputLength, label: `${targetName} parameters` };
		}
		if (!trailingSpace) {
			// "set Target.Att" - filtering params
			const prefix = tokens[paramIndex].image;
			const items = engine.completeModuleParam(moduleType, prefix);
			const from = offset + tokens[paramIndex].startOffset;
			return { items, from, to: inputLength, label: `${targetName} parameters` };
		}

		return { items: [], from: offset, to: inputLength };
	}

	private completeTarget(
		tokens: import("chevrotain").IToken[],
		trailingSpace: boolean,
		offset: number,
		inputLength: number,
		segment: string,
		moduleItems: CompletionItem[],
	): CompletionResult {
		// After verb + space: complete with module IDs
		if (tokens.length === 1 && trailingSpace) {
			return { items: moduleItems, from: offset + segment.length, to: inputLength, label: "Module targets" };
		}

		// Typing the target
		if (!trailingSpace) {
			const lastToken = tokens[tokens.length - 1];
			const prefix = lastToken.image;
			const items = fuzzyFilter(prefix, moduleItems);
			const from = offset + lastToken.startOffset;
			return { items, from, to: inputLength, label: "Module targets" };
		}

		return { items: [], from: offset, to: inputLength };
	}

	// ── Tree fetching ───────────────────────────────────────────

	private treeFetched = false;

	/** Fetch the module tree from HISE and update treeRoot.
	 *  Detects plan state via undo diff — uses ?group=current when a plan group is active. */
	async fetchTree(connection: import("../hise.js").HiseConnection): Promise<void> {
		// Detect plan state: if groupName !== "root", use plan tree endpoint
		let inPlan = false;
		const diffResp = await connection.get("/api/undo/diff?scope=group");
		if (isEnvelopeResponse(diffResp) && diffResp.success) {
			const groupName = diffResp.groupName as string | undefined;
			inPlan = typeof groupName === "string" && groupName !== "root";
		}

		const endpoint = inPlan ? "/api/builder/tree?group=current" : "/api/builder/tree";
		const response = await connection.get(endpoint);
		if (isErrorResponse(response)) return;
		if (!isEnvelopeResponse(response) || !response.success) return;
		try {
			this.treeRoot = normalizeBuilderTreeResponse(response.result);
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

	/** Mark the cached tree as stale so it re-fetches on next parse. */
	invalidateTree(): void {
		this.treeFetched = false;
	}

	/** Fetch tree on mode entry so the sidebar shows content immediately. */
	async onEnter(session: SessionContext): Promise<void> {
		await this.ensureTree(session);
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
			// Strip surrounding quotes
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
		if (keyword === "reset") {
			return this.handleReset(session);
		}

		// ── Chevrotain-parsed builder commands ──
		const result = parseBuilderInput(input);

		if ("error" in result) {
			return errorResult(result.error);
		}

		// Execute all commands from comma chaining; return last result
		let lastResult: CommandResult = textResult("(no commands)");
		for (const cmd of result.commands) {
			lastResult = await this.dispatchCommand(cmd, session);
			if (lastResult.type === "error") return lastResult;
		}
		return lastResult;
	}

	// ── Navigation handlers ─────────────────────────────────────────

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

		// Navigate down — validate against tree if available
		const segments = target.split(".").filter((s) => s !== "");
		for (const seg of segments) {
			if (seg === "..") {
				if (this.currentPath.length > 0) this.currentPath.pop();
			} else {
				// Validate the segment exists in the tree
				if (this.treeRoot) {
					const node = findNodeById(this.treeRoot, seg);
					if (!node) {
						return errorResult(`"${seg}" not found in module tree.`);
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
			return textResult(
				`${path}: listing children requires a HISE connection (use show types for available module types)`,
			);
		}

		// Find the node at the current path
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
			["Name", "Type", "Kind"],
			node.children.map((c) => [
				c.label,
				c.type ?? "",
				c.nodeKind ?? "",
			]),
		);
	}

	private handlePwd(): CommandResult {
		return textResult(this.currentPath.length > 0 ? this.currentPath.join(".") : "/");
	}

	private async handleReset(session: SessionContext): Promise<CommandResult> {
		if (!session.connection) {
			return errorResult("reset requires a HISE connection");
		}
		const response = await session.connection.post("/api/builder/reset", {});
		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isEnvelopeResponse(response) || !response.success) {
			const msg = isEnvelopeResponse(response) && response.errors.length > 0
				? response.errors.map((e) => e.errorMessage).join("\n")
				: "Reset failed";
			return errorResult(msg);
		}
		this.treeRoot = null;
		this.currentPath = [];
		this.treeFetched = false;
		// HISE discards undo groups on reset — sync the TUI's plan state
		session.resetPlanState?.();
		await this.fetchTree(session.connection);
		return textResult(response.logs.length > 0 ? response.logs.join("; ") : "Module tree reset");
	}

	// ── Command dispatch and execution ──────────────────────────

	private async dispatchCommand(
		cmd: BuilderCommand,
		session: SessionContext,
	): Promise<CommandResult> {
		// Get command — fetch single parameter value
		if (cmd.type === "get") {
			return this.handleGet(cmd, session.connection ?? null);
		}

		// Show commands are always local (except show target which may fetch params)
		if (cmd.type === "show") {
			return this.handleShow(cmd, session.connection ?? null);
		}

		// Move is not yet in C++ API
		if (cmd.type === "move") {
			const dest = cmd.chain ? `${cmd.parent}.${cmd.chain}` : cmd.parent;
			return textResult(`move ${cmd.target} to ${dest} (not yet in HISE C++ API)`);
		}

		// Never allow removing the root container
		if (cmd.type === "remove" && this.treeRoot) {
			const rootId = this.treeRoot.id ?? this.treeRoot.label;
			if (cmd.target.toLowerCase() === rootId.toLowerCase()) {
				return errorResult("Cannot remove the root container.");
			}
		}

		// Local validation for add and set
		if (cmd.type === "add" && this.moduleList) {
			const validation = validateAddCommand(cmd, this.moduleList);
			if (!validation.valid) {
				return errorResult(validation.errors.join("\n"));
			}
		}
		if (cmd.type === "set" && this.moduleList) {
			const validation = validateSetCommand(cmd, this.moduleList);
			if (!validation.valid) {
				return errorResult(validation.errors.join("\n"));
			}
		}

		// If no connection, return local-only result
		if (!session.connection) {
			return this.localFallback(cmd);
		}

		// Build API operations
		const opsResult = commandToOps(cmd, this.treeRoot, this.moduleList, this.currentPath);
		if ("error" in opsResult) {
			return errorResult(opsResult.error);
		}

		// Execute against HISE
		const result = await this.executeOps(opsResult.ops, session.connection);

		// For successful set commands, echo the changed parameter as a table row
		if (cmd.type === "set" && result.type !== "error") {
			const echo = await this.echoSetParam(cmd, session.connection);
			if (echo) return echo;
		}

		return result;
	}

	/** Execute operations against POST /api/builder/apply, re-fetch tree. */
	private async executeOps(
		ops: BuilderOp[],
		connection: import("../hise.js").HiseConnection,
	): Promise<CommandResult> {
		const response = await connection.post("/api/builder/apply", { operations: ops });

		if (isErrorResponse(response)) {
			return errorResult(response.message);
		}
		if (!isEnvelopeResponse(response)) {
			return errorResult("Unexpected response from HISE");
		}
		if (!response.success) {
			const msg = response.errors.length > 0
				? response.errors.map((e) => e.errorMessage).join("\n")
				: "Builder operation failed";
			return errorResult(msg);
		}

		// Parse the diff result — new API has scope/groupName/diff at top level
		const applyResult = normalizeBuilderApplyResult(response);

		// Re-fetch the tree to get the updated state
		await this.fetchTree(connection);

		// Apply diff markers to the refreshed tree for sidebar indicators
		if (applyResult?.diff && this.treeRoot) {
			applyDiffToTree(this.treeRoot, applyResult.diff);
		}

		// Build a human-readable summary from logs
		const summary = response.logs.length > 0
			? response.logs.join("; ")
			: (applyResult?.diff ?? []).map((d) => `${d.action} ${d.target}`).join(", ") || "OK";

		return textResult(summary);
	}

	/** After a successful set, fetch the updated parameter and return it as a single-row table. */
	private async echoSetParam(
		cmd: SetCommand,
		connection: import("../hise.js").HiseConnection,
	): Promise<CommandResult | null> {
		const response = await connection.get(
			`/api/builder/tree?moduleId=${encodeURIComponent(cmd.target)}`,
		);
		if (!isEnvelopeResponse(response) || !response.success) return null;
		const raw = response.result as Record<string, unknown>;
		const params = raw.parameters as Array<{
			id: string;
			value: number;
			valueAsString: string;
			range: { min: number; max: number };
			defaultValue: number;
		}> | undefined;
		if (!params) return null;
		const param = params.find((p) => p.id === cmd.param);
		if (!param) return null;
		return tableResult(
			["Parameter", "Value", "Range", "Default"],
			[[
				param.id,
				param.valueAsString ?? String(param.value),
				`${param.range.min} – ${param.range.max}`,
				String(param.defaultValue),
			]],
		);
	}

	/** Fallback for disconnected mode — validation + description only. */
	private localFallback(cmd: BuilderCommand): CommandResult {
		switch (cmd.type) {
			case "add": {
				const parts = [`add ${cmd.moduleType}`];
				if (cmd.alias) parts.push(`as "${cmd.alias}"`);
				if (cmd.parent) {
					const dest = cmd.chain ? `${cmd.parent}.${cmd.chain}` : cmd.parent;
					parts.push(`to ${dest}`);
				}
				return textResult(`${parts.join(" ")} (no HISE connection)`);
			}
			case "set":
				return textResult(`set ${cmd.target}.${cmd.param} to ${cmd.value} (no HISE connection)`);
			case "clone": {
				const parts = [`clone ${cmd.source}`];
				if (cmd.count > 1) parts.push(`x${cmd.count}`);
				return textResult(`${parts.join(" ")} (no HISE connection)`);
			}
			case "remove":
				return textResult(`remove ${cmd.target} (no HISE connection)`);
			case "rename":
				return textResult(`rename ${cmd.target} to "${cmd.name}" (no HISE connection)`);
			case "load":
				return textResult(`load "${cmd.source}" into ${cmd.target} (no HISE connection)`);
			case "bypass":
				return textResult(`bypass ${cmd.target} (no HISE connection)`);
			case "enable":
				return textResult(`enable ${cmd.target} (no HISE connection)`);
			case "get":
				return textResult(`get ${cmd.target}.${cmd.param} (no HISE connection)`);
			default:
				return textResult("(no HISE connection)");
		}
	}

	private async handleShow(
		cmd: ShowCommand,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (cmd.what === "types") {
			if (!this.moduleList) {
				return errorResult("Module data not loaded");
			}
			let modules = this.moduleList.modules;
			if (cmd.filter) {
				const f = cmd.filter.toLowerCase();
				modules = modules.filter((m) =>
					m.type.toLowerCase().includes(f)
					|| m.subtype.toLowerCase().includes(f),
				);
			}
			return tableResult(
				["Module", "Type", "Subtype", "Category"],
				modules.map((m) => [
					m.id,
					m.type,
					m.subtype,
					m.category.join(", "),
				]),
			);
		}

		if (cmd.what === "target") {
			return this.handleShowTarget(cmd.target!, connection);
		}

		// show tree — render from treeRoot
		if (!this.treeRoot) {
			return textResult("No module tree available (requires HISE connection).");
		}
		return textResult(renderTreeText(this.treeRoot, 0));
	}

	private async handleGet(
		cmd: GetCommand,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		if (!connection) {
			return textResult(`get ${cmd.target}.${cmd.param} (no HISE connection)`);
		}

		const response = await connection.get(
			`/api/builder/tree?moduleId=${encodeURIComponent(cmd.target)}`,
		);

		if (!isEnvelopeResponse(response) || !response.success) {
			return errorResult(`Module "${cmd.target}" not found`);
		}

		const raw = response.result as Record<string, unknown>;
		const params = raw.parameters as Array<{
			id: string;
			value: number;
			valueAsString: string;
			range: { min: number; max: number };
			defaultValue: number;
		}> | undefined;

		if (!params) {
			return errorResult(`Module "${cmd.target}" has no parameters`);
		}

		const param = params.find((p) => p.id === cmd.param);
		if (!param) {
			return errorResult(`Parameter "${cmd.param}" not found on "${cmd.target}"`);
		}

		return textResult(param.valueAsString ?? String(param.value));
	}

	private async handleShowTarget(
		target: string,
		connection: import("../hise.js").HiseConnection | null,
	): Promise<CommandResult> {
		// Fetch live parameters from HISE
		if (connection) {
			const response = await connection.get(
				`/api/builder/tree?moduleId=${encodeURIComponent(target)}`,
			);
			if (isEnvelopeResponse(response) && response.success) {
				const raw = response.result as Record<string, unknown>;
				const params = raw.parameters as Array<{
					id: string;
					value: number;
					valueAsString: string;
					range: { min: number; max: number };
					defaultValue: number;
				}> | undefined;

				if (params && params.length > 0) {
					return tableResult(
						["Parameter", "Value", "Range", "Default"],
						params.map((p) => [
							p.id,
							p.valueAsString ?? String(p.value),
							`${p.range.min} – ${p.range.max}`,
							String(p.defaultValue),
						]),
					);
				}

				// Module found but no parameters
				const label = (raw.processorId as string) ?? target;
				const type = (raw.prettyName as string) ?? (raw.id as string) ?? "unknown";
				return textResult(`${label} (${type}) — no parameters`);
			}
		}

		// Fallback: use cached tree for basic info
		if (this.treeRoot) {
			const node = findNodeById(this.treeRoot, target);
			if (node) {
				const info = [`${node.label} (${node.type ?? "unknown"})`];
				if (node.children) {
					info.push(`  ${node.children.length} children`);
				}
				return textResult(info.join("\n"));
			}
		}
		return errorResult(`Module "${target}" not found`);
	}
}

/**
 * Strip chain nodes from the tree, promoting their module children up.
 * Chains that are part of the currentPath are preserved so the sidebar
 * can still show where the user has navigated.
 */
function compactTree(node: TreeNode, remainingPath: string[]): TreeNode {
	if (!node.children) return node;

	const newChildren: TreeNode[] = [];
	// The next segment of the path that needs to be matched at this level
	const nextSeg = remainingPath.length > 0 ? remainingPath[0].toLowerCase() : null;

	for (const child of node.children) {
		const childId = (child.id ?? child.label).toLowerCase();
		const isOnPath = nextSeg !== null && childId === nextSeg;

		if (child.nodeKind === "chain" && !isOnPath) {
			// Not on the active path — promote chain's module children up
			if (child.children) {
				for (const grandchild of child.children) {
					newChildren.push(compactTree(grandchild, []));
				}
			}
		} else {
			// Keep the node: either a module, or the specific chain on the active path
			const childPath = isOnPath ? remainingPath.slice(1) : [];
			newChildren.push(compactTree(child, childPath));
		}
	}

	return { ...node, children: newChildren.length > 0 ? newChildren : undefined };
}

/** Simple text rendering of the tree for `show tree` command. */
function renderTreeText(node: TreeNode, depth: number): string {
	const indent = "  ".repeat(depth);
	const kind = node.nodeKind === "chain" ? `[${node.label}]` : node.label;
	const typeInfo = node.type ? ` (${node.type})` : "";
	let line = `${indent}${kind}${typeInfo}`;

	if (node.children) {
		for (const child of node.children) {
			line += "\n" + renderTreeText(child, depth + 1);
		}
	}
	return line;
}
