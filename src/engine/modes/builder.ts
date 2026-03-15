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
import type { Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import {
	Add,
	As,
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
	BUILDER_TOKENS,
} from "./tokens.js";

// ── Chevrotain CST Parser ───────────────────────────────────────────

class BuilderParser extends CstParser {
	constructor() {
		super(BUILDER_TOKENS);
		this.performSelfAnalysis();
	}

	// add <type> [as "<name>"] [to <parent>.<chain>]
	public addCommand = this.RULE("addCommand", () => {
		this.CONSUME(Add);
		this.CONSUME(Identifier, { LABEL: "moduleType" });
		this.OPTION(() => {
			this.CONSUME(As);
			this.CONSUME(QuotedString, { LABEL: "alias" });
		});
		this.OPTION2(() => {
			this.CONSUME(To);
			this.CONSUME2(Identifier, { LABEL: "parent" });
			this.CONSUME(Dot);
			this.CONSUME3(Identifier, { LABEL: "chain" });
		});
	});

	// show tree | show types
	public showCommand = this.RULE("showCommand", () => {
		this.CONSUME(Show);
		this.OR([
			{ ALT: () => this.CONSUME(Tree) },
			{ ALT: () => this.CONSUME(Types) },
		]);
	});

	// set <target> <param> [to] <value>
	public setCommand = this.RULE("setCommand", () => {
		this.CONSUME(Set);
		this.CONSUME(Identifier, { LABEL: "target" });
		this.CONSUME2(Identifier, { LABEL: "param" });
		this.OPTION(() => {
			this.CONSUME(To);
		});
		this.OR([
			{
				ALT: () =>
					this.CONSUME(NumberLiteral, { LABEL: "numValue" }),
			},
			{
				ALT: () =>
					this.CONSUME(QuotedString, { LABEL: "strValue" }),
			},
			{
				ALT: () =>
					this.CONSUME3(Identifier, { LABEL: "idValue" }),
			},
		]);
	});

	// Top-level entry: dispatches to sub-rules
	public command = this.RULE("command", () => {
		this.OR([
			{ ALT: () => this.SUBRULE(this.addCommand) },
			{ ALT: () => this.SUBRULE(this.showCommand) },
			{ ALT: () => this.SUBRULE(this.setCommand) },
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

export interface ShowCommand {
	type: "show";
	what: "tree" | "types";
}

export interface SetCommand {
	type: "set";
	target: string;
	param: string;
	value: string | number;
}

export type BuilderCommand = AddCommand | ShowCommand | SetCommand;

// ── Parse function ──────────────────────────────────────────────────

export function parseBuilderInput(
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

function extractCommand(
	cst: any,
): { command: BuilderCommand } | { error: string } {
	if (cst.children.addCommand) {
		return extractAddCommand(cst.children.addCommand[0]);
	}
	if (cst.children.showCommand) {
		return extractShowCommand(cst.children.showCommand[0]);
	}
	if (cst.children.setCommand) {
		return extractSetCommand(cst.children.setCommand[0]);
	}
	return { error: "Unknown command structure" };
}

function extractAddCommand(
	node: any,
): { command: AddCommand } | { error: string } {
	const moduleType = (node.children.moduleType[0] as IToken).image;
	const alias = node.children.alias
		? stripQuotes((node.children.alias[0] as IToken).image)
		: undefined;
	const parent = node.children.parent
		? (node.children.parent[0] as IToken).image
		: undefined;
	const chain = node.children.chain
		? (node.children.chain[0] as IToken).image
		: undefined;

	return {
		command: { type: "add", moduleType, alias, parent, chain },
	};
}

function extractShowCommand(
	node: any,
): { command: ShowCommand } | { error: string } {
	const what = node.children.Tree ? "tree" : "types";
	return { command: { type: "show", what } };
}

function extractSetCommand(
	node: any,
): { command: SetCommand } | { error: string } {
	const target = (node.children.target[0] as IToken).image;
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

function stripQuotes(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1).replace(/\\"/g, '"');
	}
	return s;
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

function validateChainConstraint(
	module: ModuleDefinition,
	chainName: string,
	moduleList: ModuleList,
): string | null {
	// Find the target parent module to check if this module's subtype
	// is accepted by the chain's constrainer. This is a simplified check.
	// The chain name typically maps to a modulation slot (e.g., "gain", "pitch").
	// For now, we check that the module subtype is compatible with known
	// modulation constrainers.

	// The subtype determines which chains accept this module:
	// - EnvelopeModulator → accepted by chains with constrainer "*" or "EnvelopeModulator"
	// - VoiceStartModulator → accepted by chains with constrainer "*" or "VoiceStartModulator"
	// - TimeVariantModulator → accepted by chains with constrainer "*" or "TimeVariantModulator"
	// etc.

	// For Phase 1, we just validate that the chain name looks reasonable.
	// Full chain constraint validation requires knowing the parent module's
	// modulation slots, which requires a running HISE instance or builder tree state.

	return null;
}

// ── Builder mode class ──────────────────────────────────────────────

export class BuilderMode implements Mode {
	readonly id: Mode["id"] = "builder";
	readonly name = "Builder";
	readonly accent = MODE_ACCENTS.builder;
	readonly prompt = "[builder] > ";

	private moduleList: ModuleList | null = null;

	constructor(moduleList?: ModuleList) {
		this.moduleList = moduleList ?? null;
	}

	setModuleList(moduleList: ModuleList): void {
		this.moduleList = moduleList;
	}

	async parse(
		input: string,
		_session: SessionContext,
	): Promise<CommandResult> {
		const result = parseBuilderInput(input);

		if ("error" in result) {
			return errorResult(result.error);
		}

		const cmd = result.command;

		switch (cmd.type) {
			case "add":
				return this.handleAdd(cmd);
			case "show":
				return this.handleShow(cmd);
			case "set":
				return this.handleSet(cmd);
			default:
				return errorResult("Unknown builder command");
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
		if (cmd.parent && cmd.chain) {
			parts.push(`to ${cmd.parent}.${cmd.chain}`);
		}
		return textResult(`Parsed: ${parts.join(" ")} (execution deferred — builder endpoints pending)`);
	}

	private handleShow(cmd: ShowCommand): CommandResult {
		if (cmd.what === "types") {
			if (!this.moduleList) {
				return errorResult("Module data not loaded");
			}
			return tableResult(
				["Module", "Type", "Subtype", "Category"],
				this.moduleList.modules.map((m) => [
					m.id,
					m.type,
					m.subtype,
					m.category.join(", "),
				]),
			);
		}

		// show tree — requires live HISE connection
		return textResult("Module tree display requires a HISE connection (not available in Phase 1).");
	}

	private handleSet(cmd: SetCommand): CommandResult {
		if (!this.moduleList) {
			return textResult(`set ${cmd.target} ${cmd.param} to ${cmd.value} (validation skipped)`);
		}

		const validation = validateSetCommand(cmd, this.moduleList);
		if (!validation.valid) {
			return errorResult(validation.errors.join("\n"));
		}

		return textResult(
			`Parsed: set ${cmd.target} ${cmd.param} to ${cmd.value} (execution deferred)`,
		);
	}
}
