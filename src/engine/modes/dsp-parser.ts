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
	Into,
	Load,
	Matched,
	Max,
	Mid,
	Min,
	Modules,
	Move,
	Networks,
	NumberLiteral,
	Of,
	Parent,
	QuotedString,
	Range,
	Remove,
	Reset,
	Save,
	Set,
	Show,
	Skew,
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
	index?: number;
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
	/**
	 * `matched` / `normalize` trailing flag — copies target parameter's range
	 * onto source after wiring (mirrors the IDE normalize button).
	 */
	matchRange?: boolean;
}

export interface DisconnectCommand {
	type: "disconnect";
	source: string;
	target: string;
	parameter: string;
}

/**
 * Set command — three shapes against the same `set` op:
 *
 *   1. Value-write   `set X.p [to] <v>`   → `value` set, range fields absent.
 *   2. Range-write   `set X.p range <min> <max> [step|mid|skew ...]`
 *                    → `min`/`max` (and any of stepSize/middlePosition/
 *                    skewFactor) set, `value` absent.
 *   3. Single-field  `set X.p.<field> <n>` → `rangeField` set + `value`
 *                    holds the new field value. Translator merges with
 *                    existing tree to emit a full range-write payload.
 *
 * The translator picks the variant by inspecting which fields are present
 * (rangeField first, then any of min/max/stepSize/middlePosition/skewFactor,
 * else value).
 */
export interface SetCommand {
	type: "set";
	nodeId: string;
	parameterId: string;
	// Boolean is accepted so callers can construct network-level root
	// property writes (AllowPolyphonic, HasTail, ...) directly. The
	// grammar only emits string|number for value-write; boolean is for
	// programmatic construction.
	value?: string | number | boolean;
	min?: number;
	max?: number;
	stepSize?: number;
	middlePosition?: number;
	skewFactor?: number;
	rangeField?: "min" | "max" | "stepSize" | "middlePosition" | "skewFactor";
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
	middlePosition?: number;
	skewFactor?: number;
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

	// Flexible identifier — accepts a plain Identifier OR any DSP keyword
	// token. Used at grammar positions where only an identifier makes
	// sense (after a `.`, after a verb keyword, after `to`/`from`/`as`),
	// so keyword images are unambiguous. Fixes both the
	// property-name-collides-with-verb class (`set X.Connection`,
	// `set X.Save`) and the node-id-collides-with-verb class
	// (`add math.add` → default id `add`, then `remove add`,
	// `bypass add`, `set add.Value` all need to parse).
	public propName = this.RULE("propName", () => {
		this.OR([
			{ ALT: () => this.CONSUME(Identifier) },
			{ ALT: () => this.CONSUME(Add) },
			{ ALT: () => this.CONSUME(Remove) },
			{ ALT: () => this.CONSUME(Move) },
			{ ALT: () => this.CONSUME(Bypass) },
			{ ALT: () => this.CONSUME(Enable) },
			{ ALT: () => this.CONSUME(Show) },
			{ ALT: () => this.CONSUME(Set) },
			{ ALT: () => this.CONSUME(Get) },
			{ ALT: () => this.CONSUME(Use) },
			{ ALT: () => this.CONSUME(Init) },
			{ ALT: () => this.CONSUME(Load) },
			{ ALT: () => this.CONSUME(Create) },
			{ ALT: () => this.CONSUME(Save) },
			{ ALT: () => this.CONSUME(Reset) },
			{ ALT: () => this.CONSUME(Connect) },
			{ ALT: () => this.CONSUME(Disconnect) },
			{ ALT: () => this.CONSUME(Connections) },
			{ ALT: () => this.CONSUME(CreateParameter) },
			{ ALT: () => this.CONSUME(Networks) },
			{ ALT: () => this.CONSUME(Modules) },
			{ ALT: () => this.CONSUME(Source) },
			{ ALT: () => this.CONSUME(Parent) },
			{ ALT: () => this.CONSUME(Default) },
			{ ALT: () => this.CONSUME(Step) },
			{ ALT: () => this.CONSUME(From) },
			{ ALT: () => this.CONSUME(Of) },
			{ ALT: () => this.CONSUME(Into) },
			{ ALT: () => this.CONSUME(To) },
			{ ALT: () => this.CONSUME(As) },
			{ ALT: () => this.CONSUME(At) },
			{ ALT: () => this.CONSUME(Tree) },
			// Min/Max/Mid/Skew may appear as parameter names. Range and
			// Matched are kept out: they're sentinel tokens for the
			// range-write and connect-normalize subgrammars and would
			// create first-token ambiguity with those alternatives.
			{ ALT: () => this.CONSUME(Min) },
			{ ALT: () => this.CONSUME(Max) },
			{ ALT: () => this.CONSUME(Mid) },
			{ ALT: () => this.CONSUME(Skew) },
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
	// The `node` half of the factory path is a subrule because scriptnode
	// factories ship nodes whose names collide with DSP verbs — e.g.
	// `math.add`, `math.set` etc. Same positional-disambiguation
	// argument as propName: after the `.` only an identifier makes sense.
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.CONSUME(Identifier, { LABEL: "factory" });
		this.CONSUME(Dot);
		this.SUBRULE(this.propName, { LABEL: "node" });
		this.OPTION(() => {
			this.CONSUME(As);
			this.OR([
				{ ALT: () => this.CONSUME(QuotedString, { LABEL: "alias" }) },
				{ ALT: () => this.SUBRULE2(this.propName, { LABEL: "aliasId" }) },
			]);
		});
		this.OPTION2(() => {
			this.CONSUME(To);
			this.SUBRULE3(this.propName, { LABEL: "parent" });
		});
		this.OPTION3(() => {
			this.CONSUME(At);
			this.CONSUME(NumberLiteral, { LABEL: "index" });
		});
	});

	// remove <nodeId>
	public removeCommand = this.RULE("removeCommand", () => {
		this.CONSUME(Remove);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
	});

	// move <nodeId> to <parent> [at <index>]
	public moveCommand = this.RULE("moveCommand", () => {
		this.CONSUME(Move);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
		this.CONSUME(To);
		this.SUBRULE2(this.propName, { LABEL: "parent" });
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
		this.SUBRULE(this.propName, { LABEL: "source" });
		this.OPTION(() => {
			this.CONSUME(Dot);
			this.OR([
				{ ALT: () => this.SUBRULE2(this.propName, { LABEL: "sourceOutputId" }) },
				{ ALT: () => this.CONSUME(NumberLiteral, { LABEL: "sourceOutputIndex" }) },
			]);
		});
		this.CONSUME(To);
		this.SUBRULE3(this.propName, { LABEL: "target" });
		this.OPTION2(() => {
			this.CONSUME2(Dot);
			this.SUBRULE4(this.propName, { LABEL: "parameter" });
		});
		this.OPTION3(() => {
			this.CONSUME(Matched, { LABEL: "matched" });
		});
	});

	// disconnect <source> from <target>.<param>
	public disconnectCommand = this.RULE("disconnectCommand", () => {
		this.CONSUME(Disconnect);
		this.SUBRULE(this.propName, { LABEL: "source" });
		this.CONSUME(From);
		this.SUBRULE2(this.propName, { LABEL: "target" });
		this.CONSUME(Dot);
		this.SUBRULE3(this.propName, { LABEL: "parameter" });
	});

	// Three shapes share the same head `set <node>.<param>`:
	//
	//   set X.p [to] <value>                                  (value-write)
	//   set X.p range <min> <max> [step|mid|skew ...]          (range-write)
	//   set X.p.<min|max|step|mid|skew> <number>               (single-field)
	//
	// First-token disambiguation: Alt1 starts with Dot, Alt2 with Range,
	// Alt3 with To|NumberLiteral|HexLiteral|QuotedString|propName. Range
	// and Matched are kept out of propName for this reason.
	public setCommand = this.RULE("setCommand", () => {
		this.CONSUME(Set);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
		this.CONSUME(Dot);
		this.SUBRULE2(this.propName, { LABEL: "parameterId" });
		this.OR([
			// Single-field range-write: set X.p.<field> <number>
			{
				ALT: () => {
					this.CONSUME2(Dot);
					this.OR2([
						{ ALT: () => this.CONSUME(Min, { LABEL: "fieldMin" }) },
						{ ALT: () => this.CONSUME(Max, { LABEL: "fieldMax" }) },
						{ ALT: () => this.CONSUME(Step, { LABEL: "fieldStep" }) },
						{ ALT: () => this.CONSUME(Mid, { LABEL: "fieldMid" }) },
						{ ALT: () => this.CONSUME(Skew, { LABEL: "fieldSkew" }) },
					]);
					this.CONSUME(NumberLiteral, { LABEL: "fieldValue" });
				},
			},
			// Full range-write: set X.p range <min> <max> [step|mid|skew ...]
			{
				ALT: () => {
					this.CONSUME(Range);
					this.CONSUME2(NumberLiteral, { LABEL: "rangeMin" });
					this.CONSUME3(NumberLiteral, { LABEL: "rangeMax" });
					this.MANY(() => {
						this.OR3([
							{
								ALT: () => {
									this.CONSUME2(Step);
									this.CONSUME4(NumberLiteral, { LABEL: "rangeStep" });
								},
							},
							{
								ALT: () => {
									this.CONSUME2(Mid);
									this.CONSUME5(NumberLiteral, { LABEL: "rangeMid" });
								},
							},
							{
								ALT: () => {
									this.CONSUME2(Skew);
									this.CONSUME6(NumberLiteral, { LABEL: "rangeSkew" });
								},
							},
						]);
					});
				},
			},
			// Value-write: set X.p [to] <value>
			{
				ALT: () => {
					this.OPTION(() => {
						this.CONSUME(To);
					});
					this.OR4([
						{ ALT: () => this.CONSUME(HexLiteral, { LABEL: "hexValue" }) },
						{ ALT: () => this.CONSUME7(NumberLiteral, { LABEL: "numValue" }) },
						{ ALT: () => this.CONSUME(QuotedString, { LABEL: "strValue" }) },
						{ ALT: () => this.SUBRULE3(this.propName, { LABEL: "idValue" }) },
					]);
				},
			},
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
				this.SUBRULE(this.propName, { LABEL: "parameterId" });
			}},
			{ ALT: () => {
				this.CONSUME2(Identifier, { LABEL: "plainNodeId" });
				this.OPTION(() => {
					this.CONSUME2(Dot);
					this.SUBRULE2(this.propName, { LABEL: "plainParameterId" });
				});
			}},
		]);
	});

	// bypass <nodeId>
	public bypassCommand = this.RULE("bypassCommand", () => {
		this.CONSUME(Bypass);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
	});

	// enable <nodeId>
	public enableCommand = this.RULE("enableCommand", () => {
		this.CONSUME(Enable);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
	});

	// create_parameter <container>.<name> [<min> <max>] [default <d>] [step <s>] [mid <m>|skew <s>]
	public createParameterCommand = this.RULE("createParameterCommand", () => {
		this.CONSUME(CreateParameter);
		this.SUBRULE(this.propName, { LABEL: "nodeId" });
		this.CONSUME(Dot);
		this.SUBRULE2(this.propName, { LABEL: "parameterId" });
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
				{ ALT: () => {
					this.CONSUME(Mid);
					this.CONSUME5(NumberLiteral, { LABEL: "middlePosition" });
				}},
				{ ALT: () => {
					this.CONSUME(Skew);
					this.CONSUME6(NumberLiteral, { LABEL: "skewFactor" });
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

/** Extract the image of whichever token alternative the propName subrule matched. */
function extractPropName(node: CstNode): string {
	for (const children of Object.values(node.children)) {
		for (const child of children) {
			if (child && typeof (child as IToken).image === "string") {
				return (child as IToken).image;
			}
		}
	}
	return "";
}

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
	const nodeName = extractPropName(asNode(node.children.node[0]));
	const factoryPath = `${factory}.${nodeName}`;
	let alias: string | undefined;
	if (node.children.alias) {
		alias = stripQuotes(asToken(node.children.alias[0]).image);
	} else if (node.children.aliasId) {
		alias = extractPropName(asNode(node.children.aliasId[0]));
	}
	const parent = node.children.parent
		? extractPropName(asNode(node.children.parent[0]))
		: undefined;
	const index = node.children.index
		? parseInt(asToken(node.children.index[0]).image, 10)
		: undefined;
	return { command: { type: "add", factoryPath, alias, parent, index } };
}

function extractRemove(node: CstNode): { command: RemoveCommand } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	return { command: { type: "remove", nodeId } };
}

function extractMove(node: CstNode): { command: MoveCommand } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	const parent = extractPropName(asNode(node.children.parent[0]));
	const index = node.children.index
		? parseInt(asToken(node.children.index[0]).image, 10)
		: undefined;
	return { command: { type: "move", nodeId, parent, index } };
}

function extractConnect(node: CstNode): { command: ConnectCommand } {
	const source = extractPropName(asNode(node.children.source[0]));
	let sourceOutput: string | number | undefined;
	if (node.children.sourceOutputIndex) {
		sourceOutput = parseInt(asToken(node.children.sourceOutputIndex[0]).image, 10);
	} else if (node.children.sourceOutputId) {
		sourceOutput = extractPropName(asNode(node.children.sourceOutputId[0]));
	}
	const target = extractPropName(asNode(node.children.target[0]));
	const parameter = node.children.parameter
		? extractPropName(asNode(node.children.parameter[0]))
		: undefined;
	const matchRange = node.children.matched ? true : undefined;
	return { command: { type: "connect", source, sourceOutput, target, parameter, matchRange } };
}

function extractDisconnect(node: CstNode): { command: DisconnectCommand } {
	const source = extractPropName(asNode(node.children.source[0]));
	const target = extractPropName(asNode(node.children.target[0]));
	const parameter = extractPropName(asNode(node.children.parameter[0]));
	return { command: { type: "disconnect", source, target, parameter } };
}

function extractSet(node: CstNode): { command: SetCommand } | { error: string } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	const parameterId = extractPropName(asNode(node.children.parameterId[0]));

	// Single-field range-write: set X.p.<field> <number>
	if (node.children.fieldValue) {
		const field: SetCommand["rangeField"] = node.children.fieldMin
			? "min"
			: node.children.fieldMax
				? "max"
				: node.children.fieldStep
					? "stepSize"
					: node.children.fieldMid
						? "middlePosition"
						: "skewFactor";
		const value = parseFloat(asToken(node.children.fieldValue[0]).image);
		return { command: { type: "set", nodeId, parameterId, rangeField: field, value } };
	}

	// Full range-write: set X.p range <min> <max> [step|mid|skew ...]
	if (node.children.rangeMin) {
		const cmd: SetCommand = {
			type: "set",
			nodeId,
			parameterId,
			min: parseFloat(asToken(node.children.rangeMin[0]).image),
			max: parseFloat(asToken(node.children.rangeMax[0]).image),
		};
		if (node.children.rangeStep) {
			cmd.stepSize = parseFloat(asToken(node.children.rangeStep[0]).image);
		}
		if (node.children.rangeMid) {
			cmd.middlePosition = parseFloat(asToken(node.children.rangeMid[0]).image);
		}
		if (node.children.rangeSkew) {
			cmd.skewFactor = parseFloat(asToken(node.children.rangeSkew[0]).image);
		}
		return { command: cmd };
	}

	// Value-write: set X.p [to] <value>
	let value: string | number;
	if (node.children.hexValue) {
		value = parseInt(asToken(node.children.hexValue[0]).image.slice(2), 16);
	} else if (node.children.numValue) {
		value = parseFloat(asToken(node.children.numValue[0]).image);
	} else if (node.children.strValue) {
		value = stripQuotes(asToken(node.children.strValue[0]).image);
	} else if (node.children.idValue) {
		value = extractPropName(asNode(node.children.idValue[0]));
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
		const parameterId = extractPropName(asNode(node.children.parameterId[0]));
		return { command: { type: "get", query, nodeId, parameterId } };
	}
	const nodeId = asToken(node.children.plainNodeId[0]).image;
	if (node.children.plainParameterId) {
		const parameterId = extractPropName(asNode(node.children.plainParameterId[0]));
		return { command: { type: "get", query: "param", nodeId, parameterId } };
	}
	return { command: { type: "get", query: "factory", nodeId } };
}

function extractBypass(node: CstNode): { command: BypassCommand } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	return { command: { type: "bypass", nodeId } };
}

function extractEnable(node: CstNode): { command: EnableCommand } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	return { command: { type: "enable", nodeId } };
}

function extractCreateParameter(node: CstNode): { command: CreateParameterCommand } {
	const nodeId = extractPropName(asNode(node.children.nodeId[0]));
	const parameterId = extractPropName(asNode(node.children.parameterId[0]));
	const min = node.children.min ? parseFloat(asToken(node.children.min[0]).image) : undefined;
	const max = node.children.max ? parseFloat(asToken(node.children.max[0]).image) : undefined;
	const defaultValue = node.children.defaultValue
		? parseFloat(asToken(node.children.defaultValue[0]).image)
		: undefined;
	const stepSize = node.children.stepSize
		? parseFloat(asToken(node.children.stepSize[0]).image)
		: undefined;
	const middlePosition = node.children.middlePosition
		? parseFloat(asToken(node.children.middlePosition[0]).image)
		: undefined;
	const skewFactor = node.children.skewFactor
		? parseFloat(asToken(node.children.skewFactor[0]).image)
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
			middlePosition,
			skewFactor,
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
