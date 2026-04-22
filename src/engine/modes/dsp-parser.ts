// ── DSP Chevrotain CST parser + command types ────────────────────────

import { CstParser, type CstNode, type IToken } from "chevrotain";
import {
	Add,
	As,
	At,
	Bypass,
	Connect,
	Connections,
	Create,
	CreateParameter,
	Default,
	Disconnect,
	DSP_TOKENS,
	DSP_VERB_KEYWORDS,
	Dot,
	Enable,
	From,
	Get,
	HexLiteral,
	Identifier,
	Init,
	Load,
	Modules,
	Move,
	Networks,
	NumberLiteral,
	Of,
	Parent,
	QuotedString,
	Remove,
	Reset,
	Save,
	Set,
	Show,
	Source,
	Step,
	To,
	Tree,
	Use,
	dspLexer,
} from "./tokens.js";
import { splitByComma, stripQuotes, findLastUnquotedComma } from "../string-utils.js";

// ── Parsed command types ──────────────────────────────────────────

export type ShowCommand =
	| { type: "show"; what: "tree" | "networks" | "modules" | "connections" }
	| { type: "show"; what: "node"; nodeId: string };

export interface UseCommand {
	type: "use";
	moduleId: string;
}

export type InitMode = "auto" | "load" | "create";

export interface InitCommand {
	type: "init";
	name: string;
	mode: InitMode;
}

export interface SaveCommand {
	type: "save";
}

export interface ResetCommand {
	type: "reset";
}

export interface AddCommand {
	type: "add";
	factoryPath: string;
	alias?: string;
	parent?: string;
}

export interface RemoveCommand {
	type: "remove";
	nodeId: string;
}

export interface MoveCommand {
	type: "move";
	nodeId: string;
	parent: string;
	index?: number;
}

export interface ConnectCommand {
	type: "connect";
	source: string;
	/** Optional source output — parameter name (string) or slot index (number). */
	sourceOutput?: string | number;
	target: string;
	/**
	 * Target parameter. Optional: `connect <src> to <target>` (no `.param`)
	 * is accepted as a shorthand — HISE resolves the default routing target
	 * server-side (e.g. routing.send → routing.receive via the Connection
	 * property).
	 */
	parameter?: string;
}

export interface DisconnectCommand {
	type: "disconnect";
	source: string;
	target: string;
	parameter: string;
}

export interface SetCommand {
	type: "set";
	nodeId: string;
	parameterId: string;
	value: string | number;
}

export type GetCommand =
	| { type: "get"; query: "factory"; nodeId: string }
	| { type: "get"; query: "param"; nodeId: string; parameterId: string }
	| { type: "get"; query: "source"; nodeId: string; parameterId: string }
	| { type: "get"; query: "parent"; nodeId: string; parameterId: string };

export interface BypassCommand {
	type: "bypass";
	nodeId: string;
}

export interface EnableCommand {
	type: "enable";
	nodeId: string;
}

export interface CreateParameterCommand {
	type: "create_parameter";
	nodeId: string;
	parameterId: string;
	min?: number;
	max?: number;
	defaultValue?: number;
	stepSize?: number;
}

export type DspCommand =
	| ShowCommand
	| UseCommand
	| InitCommand
	| SaveCommand
	| ResetCommand
	| AddCommand
	| RemoveCommand
	| MoveCommand
	| ConnectCommand
	| DisconnectCommand
	| SetCommand
	| GetCommand
	| BypassCommand
	| EnableCommand
	| CreateParameterCommand;

// ── Chevrotain CST parser ─────────────────────────────────────────

class DspParser extends CstParser {
	constructor() {
		super(DSP_TOKENS);
		this.performSelfAnalysis();
	}

	// Multi-word target ref (for Use — module IDs may contain spaces)
	public targetRef = this.RULE("targetRef", () => {
		this.OR([
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "quoted" }) },
			{ ALT: () => this.AT_LEAST_ONE(() => this.CONSUME(Identifier, { LABEL: "words" })) },
		]);
	});

	// show (networks | modules | tree | connections | <nodeId>)
	public showCommand = this.RULE("showCommand", () => {
		this.CONSUME(Show);
		this.OR([
			{ ALT: () => this.CONSUME(Networks, { LABEL: "networks" }) },
			{ ALT: () => this.CONSUME(Modules, { LABEL: "modules" }) },
			{ ALT: () => this.CONSUME(Tree, { LABEL: "tree" }) },
			{ ALT: () => this.CONSUME(Connections, { LABEL: "connections" }) },
			{ ALT: () => this.CONSUME(Identifier, { LABEL: "nodeId" }) },
		]);
	});

	// use <moduleId>
	public useCommand = this.RULE("useCommand", () => {
		this.CONSUME(Use);
		this.SUBRULE(this.targetRef, { LABEL: "moduleId" });
	});

	// init <name> | load <name> | create <name>
	// Three verbs collapse into one command with different `mode` values.
	public initCommand = this.RULE("initCommand", () => {
		this.OR([
			{ ALT: () => this.CONSUME(Init, { LABEL: "initVerb" }) },
			{ ALT: () => this.CONSUME(Load, { LABEL: "loadVerb" }) },
			{ ALT: () => this.CONSUME(Create, { LABEL: "createVerb" }) },
		]);
		this.CONSUME(Identifier, { LABEL: "name" });
	});

	// save
	public saveCommand = this.RULE("saveCommand", () => {
		this.CONSUME(Save);
	});

	// reset
	public resetCommand = this.RULE("resetCommand", () => {
		this.CONSUME(Reset);
	});

	// add <factory.node> [as <alias>] [to <parent>]
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.CONSUME(Identifier, { LABEL: "factory" });
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "node" });
		this.OPTION(() => {
			this.CONSUME(As);
			this.OR([
				{ ALT: () => this.CONSUME(QuotedString, { LABEL: "alias" }) },
				{ ALT: () => this.CONSUME3(Identifier, { LABEL: "aliasId" }) },
			]);
		});
		this.OPTION2(() => {
			this.CONSUME(To);
			this.CONSUME4(Identifier, { LABEL: "parent" });
		});
	});

	// remove <nodeId>
	public removeCommand = this.RULE("removeCommand", () => {
		this.CONSUME(Remove);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
	});

	// move <nodeId> to <parent> [at <index>]
	public moveCommand = this.RULE("moveCommand", () => {
		this.CONSUME(Move);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
		this.CONSUME(To);
		this.CONSUME2(Identifier, { LABEL: "parent" });
		this.OPTION(() => {
			this.CONSUME(At);
			this.CONSUME(NumberLiteral, { LABEL: "index" });
		});
	});

	// connect <source>[.<output>] to <target>[.<param>]
	// <output> is a parameter name (Identifier) or a numeric slot index
	// (NumberLiteral, e.g. xfader1.0, xfader1.1). When `.<param>` is
	// omitted on the target, HISE routes the command to its default
	// routing target internally (e.g. routing.send → routing.receive).
	public connectCommand = this.RULE("connectCommand", () => {
		this.CONSUME(Connect);
		this.CONSUME(Identifier, { LABEL: "source" });
		this.OPTION(() => {
			this.CONSUME(Dot);
			this.OR([
				{ ALT: () => this.CONSUME2(Identifier, { LABEL: "sourceOutputId" }) },
				{ ALT: () => this.CONSUME(NumberLiteral, { LABEL: "sourceOutputIndex" }) },
			]);
		});
		this.CONSUME(To);
		this.CONSUME3(Identifier, { LABEL: "target" });
		this.OPTION2(() => {
			this.CONSUME2(Dot);
			this.CONSUME4(Identifier, { LABEL: "parameter" });
		});
	});

	// disconnect <source> from <target>.<param>
	public disconnectCommand = this.RULE("disconnectCommand", () => {
		this.CONSUME(Disconnect);
		this.CONSUME(Identifier, { LABEL: "source" });
		this.CONSUME(From);
		this.CONSUME2(Identifier, { LABEL: "target" });
		this.CONSUME(Dot);
		this.CONSUME3(Identifier, { LABEL: "parameter" });
	});

	// set <node>.<param> [to] <value>
	public setCommand = this.RULE("setCommand", () => {
		this.CONSUME(Set);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "parameterId" });
		this.OPTION(() => {
			this.CONSUME(To);
		});
		this.OR([
			{ ALT: () => this.CONSUME(HexLiteral, { LABEL: "hexValue" }) },
			{ ALT: () => this.CONSUME(NumberLiteral, { LABEL: "numValue" }) },
			{ ALT: () => this.CONSUME(QuotedString, { LABEL: "strValue" }) },
			{ ALT: () => this.CONSUME3(Identifier, { LABEL: "idValue" }) },
		]);
	});

	// get <node> | get <node>.<param> | get source of <node>.<param> | get parent of <node>.<param>
	public getCommand = this.RULE("getCommand", () => {
		this.CONSUME(Get);
		this.OR([
			{ ALT: () => {
				this.OR2([
					{ ALT: () => this.CONSUME(Source, { LABEL: "queryKind" }) },
					{ ALT: () => this.CONSUME(Parent, { LABEL: "queryKind" }) },
				]);
				this.CONSUME(Of);
				this.CONSUME(Identifier, { LABEL: "nodeId" });
				this.CONSUME(Dot);
				this.CONSUME2(Identifier, { LABEL: "parameterId" });
			}},
			{ ALT: () => {
				this.CONSUME3(Identifier, { LABEL: "plainNodeId" });
				this.OPTION(() => {
					this.CONSUME2(Dot);
					this.CONSUME4(Identifier, { LABEL: "plainParameterId" });
				});
			}},
		]);
	});

	// bypass <nodeId>
	public bypassCommand = this.RULE("bypassCommand", () => {
		this.CONSUME(Bypass);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
	});

	// enable <nodeId>
	public enableCommand = this.RULE("enableCommand", () => {
		this.CONSUME(Enable);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
	});

	// create_parameter <container>.<name> [<min> <max>] [default <d>] [step <s>]
	public createParameterCommand = this.RULE("createParameterCommand", () => {
		this.CONSUME(CreateParameter);
		this.CONSUME(Identifier, { LABEL: "nodeId" });
		this.CONSUME(Dot);
		this.CONSUME2(Identifier, { LABEL: "parameterId" });
		this.OPTION(() => {
			this.CONSUME(NumberLiteral, { LABEL: "min" });
			this.CONSUME2(NumberLiteral, { LABEL: "max" });
		});
		this.MANY(() => {
			this.OR([
				{ ALT: () => {
					this.CONSUME(Default);
					this.CONSUME3(NumberLiteral, { LABEL: "defaultValue" });
				}},
				{ ALT: () => {
					this.CONSUME(Step);
					this.CONSUME4(NumberLiteral, { LABEL: "stepSize" });
				}},
			]);
		});
	});

	public command = this.RULE("command", () => {
		this.OR([
			{ ALT: () => this.SUBRULE(this.showCommand) },
			{ ALT: () => this.SUBRULE(this.useCommand) },
			{ ALT: () => this.SUBRULE(this.initCommand) },
			{ ALT: () => this.SUBRULE(this.saveCommand) },
			{ ALT: () => this.SUBRULE(this.resetCommand) },
			{ ALT: () => this.SUBRULE(this.addCommand) },
			{ ALT: () => this.SUBRULE(this.removeCommand) },
			{ ALT: () => this.SUBRULE(this.moveCommand) },
			{ ALT: () => this.SUBRULE(this.connectCommand) },
			{ ALT: () => this.SUBRULE(this.disconnectCommand) },
			{ ALT: () => this.SUBRULE(this.setCommand) },
			{ ALT: () => this.SUBRULE(this.getCommand) },
			{ ALT: () => this.SUBRULE(this.bypassCommand) },
			{ ALT: () => this.SUBRULE(this.enableCommand) },
			{ ALT: () => this.SUBRULE(this.createParameterCommand) },
		]);
	});
}

const parser = new DspParser();

// ── CST extractors ────────────────────────────────────────────────

const asNode = (el: import("chevrotain").CstElement) => el as CstNode;
const asToken = (el: import("chevrotain").CstElement) => el as IToken;

function extractCommand(cst: CstNode): { command: DspCommand } | { error: string } {
	const c = cst.children;
	if (c.showCommand) return extractShow(c.showCommand[0] as CstNode);
	if (c.useCommand) return extractUse(c.useCommand[0] as CstNode);
	if (c.initCommand) return extractInit(c.initCommand[0] as CstNode);
	if (c.saveCommand) return { command: { type: "save" } };
	if (c.resetCommand) return { command: { type: "reset" } };
	if (c.addCommand) return extractAdd(c.addCommand[0] as CstNode);
	if (c.removeCommand) return extractRemove(c.removeCommand[0] as CstNode);
	if (c.moveCommand) return extractMove(c.moveCommand[0] as CstNode);
	if (c.connectCommand) return extractConnect(c.connectCommand[0] as CstNode);
	if (c.disconnectCommand) return extractDisconnect(c.disconnectCommand[0] as CstNode);
	if (c.setCommand) return extractSet(c.setCommand[0] as CstNode);
	if (c.getCommand) return extractGet(c.getCommand[0] as CstNode);
	if (c.bypassCommand) return extractBypass(c.bypassCommand[0] as CstNode);
	if (c.enableCommand) return extractEnable(c.enableCommand[0] as CstNode);
	if (c.createParameterCommand) return extractCreateParameter(c.createParameterCommand[0] as CstNode);
	return { error: "Unknown command" };
}

function extractTargetRef(node: CstNode): string {
	if (node.children.quoted) {
		return stripQuotes(asToken(node.children.quoted[0]).image);
	}
	return (node.children.words as IToken[]).map((t) => t.image).join(" ");
}

function extractShow(node: CstNode): { command: ShowCommand } {
	if (node.children.networks) return { command: { type: "show", what: "networks" } };
	if (node.children.modules) return { command: { type: "show", what: "modules" } };
	if (node.children.connections) return { command: { type: "show", what: "connections" } };
	if (node.children.nodeId) {
		const nodeId = asToken(node.children.nodeId[0]).image;
		return { command: { type: "show", what: "node", nodeId } };
	}
	return { command: { type: "show", what: "tree" } };
}

function extractUse(node: CstNode): { command: UseCommand } {
	const moduleId = extractTargetRef(asNode(node.children.moduleId[0]));
	return { command: { type: "use", moduleId } };
}

function extractInit(node: CstNode): { command: InitCommand } {
	const name = asToken(node.children.name[0]).image;
	const mode: InitMode = node.children.loadVerb
		? "load"
		: node.children.createVerb
			? "create"
			: "auto";
	return { command: { type: "init", name, mode } };
}

function extractAdd(node: CstNode): { command: AddCommand } | { error: string } {
	const factory = asToken(node.children.factory[0]).image;
	const nodeName = asToken(node.children.node[0]).image;
	const factoryPath = `${factory}.${nodeName}`;
	let alias: string | undefined;
	if (node.children.alias) {
		alias = stripQuotes(asToken(node.children.alias[0]).image);
	} else if (node.children.aliasId) {
		alias = asToken(node.children.aliasId[0]).image;
	}
	const parent = node.children.parent
		? asToken(node.children.parent[0]).image
		: undefined;
	return { command: { type: "add", factoryPath, alias, parent } };
}

function extractRemove(node: CstNode): { command: RemoveCommand } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	return { command: { type: "remove", nodeId } };
}

function extractMove(node: CstNode): { command: MoveCommand } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	const parent = asToken(node.children.parent[0]).image;
	const index = node.children.index
		? parseInt(asToken(node.children.index[0]).image, 10)
		: undefined;
	return { command: { type: "move", nodeId, parent, index } };
}

function extractConnect(node: CstNode): { command: ConnectCommand } {
	const source = asToken(node.children.source[0]).image;
	let sourceOutput: string | number | undefined;
	if (node.children.sourceOutputIndex) {
		sourceOutput = parseInt(asToken(node.children.sourceOutputIndex[0]).image, 10);
	} else if (node.children.sourceOutputId) {
		sourceOutput = asToken(node.children.sourceOutputId[0]).image;
	}
	const target = asToken(node.children.target[0]).image;
	const parameter = node.children.parameter
		? asToken(node.children.parameter[0]).image
		: undefined;
	return { command: { type: "connect", source, sourceOutput, target, parameter } };
}

function extractDisconnect(node: CstNode): { command: DisconnectCommand } {
	const source = asToken(node.children.source[0]).image;
	const target = asToken(node.children.target[0]).image;
	const parameter = asToken(node.children.parameter[0]).image;
	return { command: { type: "disconnect", source, target, parameter } };
}

function extractSet(node: CstNode): { command: SetCommand } | { error: string } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	const parameterId = asToken(node.children.parameterId[0]).image;
	let value: string | number;
	if (node.children.hexValue) {
		value = parseInt(asToken(node.children.hexValue[0]).image.slice(2), 16);
	} else if (node.children.numValue) {
		value = parseFloat(asToken(node.children.numValue[0]).image);
	} else if (node.children.strValue) {
		value = stripQuotes(asToken(node.children.strValue[0]).image);
	} else if (node.children.idValue) {
		value = asToken(node.children.idValue[0]).image;
	} else {
		return { error: "set: missing value" };
	}
	return { command: { type: "set", nodeId, parameterId, value } };
}

function extractGet(node: CstNode): { command: GetCommand } {
	if (node.children.queryKind) {
		const kindImage = asToken(node.children.queryKind[0]).image.toLowerCase();
		const query: "source" | "parent" = kindImage === "parent" ? "parent" : "source";
		const nodeId = asToken(node.children.nodeId[0]).image;
		const parameterId = asToken(node.children.parameterId[0]).image;
		return { command: { type: "get", query, nodeId, parameterId } };
	}
	const nodeId = asToken(node.children.plainNodeId[0]).image;
	if (node.children.plainParameterId) {
		const parameterId = asToken(node.children.plainParameterId[0]).image;
		return { command: { type: "get", query: "param", nodeId, parameterId } };
	}
	return { command: { type: "get", query: "factory", nodeId } };
}

function extractBypass(node: CstNode): { command: BypassCommand } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	return { command: { type: "bypass", nodeId } };
}

function extractEnable(node: CstNode): { command: EnableCommand } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	return { command: { type: "enable", nodeId } };
}

function extractCreateParameter(node: CstNode): { command: CreateParameterCommand } {
	const nodeId = asToken(node.children.nodeId[0]).image;
	const parameterId = asToken(node.children.parameterId[0]).image;
	const min = node.children.min ? parseFloat(asToken(node.children.min[0]).image) : undefined;
	const max = node.children.max ? parseFloat(asToken(node.children.max[0]).image) : undefined;
	const defaultValue = node.children.defaultValue
		? parseFloat(asToken(node.children.defaultValue[0]).image)
		: undefined;
	const stepSize = node.children.stepSize
		? parseFloat(asToken(node.children.stepSize[0]).image)
		: undefined;
	return {
		command: {
			type: "create_parameter",
			nodeId,
			parameterId,
			min,
			max,
			defaultValue,
			stepSize,
		},
	};
}

// ── Parse functions ───────────────────────────────────────────────

/** Parse a single DSP command string. */
export function parseSingleDspCommand(
	input: string,
): { command: DspCommand } | { error: string } {
	const lexResult = dspLexer.tokenize(input);
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

// All top-level command keywords accepted at segment start. A segment
// starting with any of these parses directly. `DSP_VERB_KEYWORDS` is
// the subset whose verbs may be inherited by later bare-argument
// segments in a comma chain.
const _NativeSet = globalThis.Set;
const DSP_COMMAND_KEYWORDS: ReadonlySet<string> = new _NativeSet([
	"show", "use", "init", "load", "create", "save", "reset",
	"add", "remove", "move", "connect", "disconnect",
	"set", "get", "bypass", "enable", "create_parameter",
]);

/**
 * Parse DSP input with comma chaining support.
 *
 * Verb inheritance: a segment without a leading keyword inherits the
 * previous segment's verb (only for verbs in DSP_VERB_KEYWORDS).
 * Non-chainable commands (init, save, reset, show, use) always need
 * their keyword explicit.
 */
export function parseDspInput(
	input: string,
): { commands: DspCommand[] } | { error: string } {
	const segments = splitByComma(input);
	let lastVerb: string | null = null;
	const commands: DspCommand[] = [];

	for (const seg of segments) {
		const trimmed = seg.trim();
		if (!trimmed) continue;

		const firstToken = trimmed.split(/\s/)[0].toLowerCase();

		let toParse: string;
		if (DSP_COMMAND_KEYWORDS.has(firstToken)) {
			toParse = trimmed;
			if (DSP_VERB_KEYWORDS.has(firstToken)) lastVerb = firstToken;
		} else if (lastVerb) {
			toParse = `${lastVerb} ${trimmed}`;
		} else {
			return { error: `No verb for segment: ${trimmed}` };
		}

		const result = parseSingleDspCommand(toParse);
		if ("error" in result) {
			return { error: `${result.error} (in: ${trimmed})` };
		}
		commands.push(result.command);
	}

	if (commands.length === 0) return { error: "Empty command" };
	return { commands };
}

export { findLastUnquotedComma };
