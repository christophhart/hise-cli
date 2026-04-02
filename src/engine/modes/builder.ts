// ── Builder mode — Chevrotain parser + local validation ─────────────

// Phase 1: Parser skeleton + validation against moduleList.json.
// No HISE execution — builder endpoints are new and tracked in #12.

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
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.CONSUME2(Identifier, { LABEL: "moduleType" });
		this.OPTION(() => {
			this.CONSUME(As);
			this.CONSUME(QuotedString, { LABEL: "alias" });
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

	// Top-level entry: dispatches to sub-rules
	public command = this.RULE("command", () => {
		this.OR([
			{ ALT: () => this.SUBRULE(this.addCommand) },
			{ ALT: () => this.SUBRULE(this.cloneCommand) },
			{ ALT: () => this.SUBRULE(this.removeCommand) },
			{ ALT: () => this.SUBRULE(this.moveCommand) },
			{ ALT: () => this.SUBRULE(this.renameCommand) },
			{ ALT: () => this.SUBRULE(this.setCommand) },
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
		} else if (lastVerb === "set" && !trimmed.includes(".")) {
			// Set continuation without dot — inherit target
			if (!lastSetTarget) {
				return { error: `No target to inherit in segment: ${trimmed}` };
			}
			toParse = `set ${lastSetTarget}.${trimmed}`;
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

		// Track last set target for inheritance
		if (result.command.type === "set") {
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
	const moduleType = (node.children.moduleType[0] as IToken).image;
	const alias = node.children.alias
		? stripQuotes((node.children.alias[0] as IToken).image)
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

	// 1. Check module type exists
	const moduleNames = moduleList.modules.map((m) => m.id);
	const module = moduleList.modules.find((m) => m.id === cmd.moduleType);

	if (!module) {
		const suggestion = closest(cmd.moduleType, moduleNames);
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

	// Find the target module by type name (in builder context, target
	// is a module instance name — but for validation we check param
	// against all modules of matching type)
	const module = moduleList.modules.find((m) => m.id === cmd.target);
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
		const parentModule = moduleList.modules.find((m) => m.id === parentName);
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
		return propagateChainColors(structuredClone(this.treeRoot));
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
		const modules = collectModuleIds(this.treeRoot);
		const moduleItems = moduleIdCompletionItems(modules);

		// ── add <type> [as "<name>"] [to <target>[.<chain>]] ──
		if (verb === "add") {
			return this.completeAdd(tokens, trailingSpace, offset, inputLength, segment, modules, moduleItems);
		}

		// ── set <target>.<param> [to] <value> ──
		if (verb === "set") {
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

		// Position 1: module type
		if (tokens.length === 1 && trailingSpace) {
			return { items: engine.completeModuleType(""), from: offset + segment.length, to: inputLength, label: "Module types" };
		}
		if (tokens.length === 2 && !trailingSpace) {
			const prefix = tokens[1].image;
			const items = engine.completeModuleType(prefix);
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

	async parse(
		input: string,
		session: SessionContext,
	): Promise<CommandResult> {
		const trimmed = input.trim();
		const parts = trimmed.split(/\s+/);
		const keyword = parts[0]?.toLowerCase();

		// ── Navigation commands (handled before Chevrotain parser) ──
		if (keyword === "cd") {
			return this.handleCd(parts.slice(1).join(" ").trim(), session);
		}
		if (keyword === "ls" || keyword === "dir") {
			return this.handleLs();
		}
		if (keyword === "pwd") {
			return this.handlePwd();
		}

		// ── Chevrotain-parsed builder commands ──
		const result = parseBuilderInput(input);

		if ("error" in result) {
			return errorResult(result.error);
		}

		// Execute all commands from comma chaining; return last result
		let lastResult: CommandResult = textResult("(no commands)");
		for (const cmd of result.commands) {
			lastResult = this.dispatchCommand(cmd);
			if (lastResult.type === "error") return lastResult;
		}
		return lastResult;
	}

	// ── Navigation handlers ─────────────────────────────────────────

	private handleCd(target: string, session: SessionContext): CommandResult {
		if (!target || target === "/") {
			// cd or cd / — go to root
			this.currentPath = [];
			return textResult("/");
		}

		if (target === "..") {
			// cd .. — go up one level; at context root, exit builder mode
			if (this.currentPath.length === 0) {
				return session.popMode();
			}
			this.currentPath.pop();
			return textResult(this.currentPath.length > 0 ? this.currentPath.join(".") : "/");
		}

		// Navigate down — target can be a single name or a dotted path
		const segments = target.split(".").filter((s) => s !== "");
		for (const seg of segments) {
			if (seg === "..") {
				if (this.currentPath.length > 0) this.currentPath.pop();
			} else {
				this.currentPath.push(seg);
			}
		}
		return textResult(this.currentPath.join("."));
	}

	private handleLs(): CommandResult {
		const path = this.currentPath.length > 0 ? this.currentPath.join(".") : "/";
		// Without a HISE connection, we can't query the live processor tree.
		// Return the current path and a hint about needing a connection.
		return textResult(
			`${path}: listing children requires a HISE connection (use show types for available module types)`,
		);
	}

	private handlePwd(): CommandResult {
		return textResult(this.currentPath.length > 0 ? this.currentPath.join(".") : "/");
	}

	private dispatchCommand(cmd: BuilderCommand): CommandResult {
		switch (cmd.type) {
			case "add": return this.handleAdd(cmd);
			case "clone": return this.handleClone(cmd);
			case "remove": return this.handleRemove(cmd);
			case "move": return this.handleMove(cmd);
			case "rename": return this.handleRename(cmd);
			case "set": return this.handleSet(cmd);
			case "load": return this.handleLoad(cmd);
			case "bypass": return this.handleBypass(cmd);
			case "enable": return this.handleEnable(cmd);
			case "show": return this.handleShow(cmd);
		}
	}

	private handleAdd(cmd: AddCommand): CommandResult {
		if (!this.moduleList) {
			return textResult(`add ${cmd.moduleType} (validation skipped — no module data loaded)`);
		}

		const validation = validateAddCommand(cmd, this.moduleList);
		if (!validation.valid) {
			return errorResult(validation.errors.join("\n"));
		}

		// Success — describe what would happen (no HISE execution in Phase 1)
		const parts = [`add ${cmd.moduleType}`];
		if (cmd.alias) parts.push(`as "${cmd.alias}"`);
		if (cmd.parent) {
			const dest = cmd.chain ? `${cmd.parent}.${cmd.chain}` : cmd.parent;
			parts.push(`to ${dest}`);
		}
		return textResult(`Parsed: ${parts.join(" ")} (execution deferred — builder endpoints pending)`);
	}

	private handleShow(cmd: ShowCommand): CommandResult {
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
			return textResult(`Parsed: show ${cmd.target} (execution deferred — requires HISE connection)`);
		}

		// show tree — requires live HISE connection
		return textResult("Module tree display requires a HISE connection (not available in Phase 1).");
	}

	private handleSet(cmd: SetCommand): CommandResult {
		if (!this.moduleList) {
			return textResult(`set ${cmd.target}.${cmd.param} to ${cmd.value} (validation skipped)`);
		}

		const validation = validateSetCommand(cmd, this.moduleList);
		if (!validation.valid) {
			return errorResult(validation.errors.join("\n"));
		}

		return textResult(
			`Parsed: set ${cmd.target}.${cmd.param} to ${cmd.value} (execution deferred)`,
		);
	}

	private handleClone(cmd: CloneCommand): CommandResult {
		const parts = [`clone ${cmd.source}`];
		if (cmd.count > 1) parts.push(`x${cmd.count}`);
		return textResult(`Parsed: ${parts.join(" ")} (execution deferred)`);
	}

	private handleRemove(cmd: RemoveCommand): CommandResult {
		return textResult(`Parsed: remove ${cmd.target} (execution deferred)`);
	}

	private handleMove(cmd: MoveCommand): CommandResult {
		const dest = cmd.chain ? `${cmd.parent}.${cmd.chain}` : cmd.parent;
		return textResult(`Parsed: move ${cmd.target} to ${dest} (stub — not yet in HISE C++ API)`);
	}

	private handleRename(cmd: RenameCommand): CommandResult {
		return textResult(`Parsed: rename ${cmd.target} to "${cmd.name}" (execution deferred)`);
	}

	private handleLoad(cmd: LoadCommand): CommandResult {
		return textResult(`Parsed: load "${cmd.source}" into ${cmd.target} (execution deferred)`);
	}

	private handleBypass(cmd: BypassCommand): CommandResult {
		return textResult(`Parsed: bypass ${cmd.target} (execution deferred)`);
	}

	private handleEnable(cmd: EnableCommand): CommandResult {
		return textResult(`Parsed: enable ${cmd.target} (execution deferred)`);
	}
}
