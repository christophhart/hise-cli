// ── DataLoader — isomorphic static dataset access ───────────────────

// Types derived from the actual JSON data shapes in data/*.json.
// The engine layer defines the interfaces; platform-specific implementations
// (Node.js filesystem, browser fetch/bundle) live in tui/ or cli/.

// ── Module List types (data/moduleList.json) ────────────────────────

export interface ParameterRange {
	min: number;
	max: number;
	stepSize: number;
	middlePosition?: number;
}

export interface ModuleParameter {
	parameterIndex: number;
	id: string;
	metadataType: string;
	description: string;
	type: "Slider" | "Button" | "ComboBox";
	disabled: boolean;
	range: ParameterRange;
	defaultValue: number | string;
	chainIndex?: number;
	mode?: string;
	unit?: string;
}

export interface ModuleModulation {
	chainIndex: number;
	id: string;
	metadataType: string;
	parameterIndex?: number;
	disabled: boolean;
	description: string;
	constrainer: string;
	modulationMode: string;
	colour: number;
}

export type ModuleType =
	| "Modulator"
	| "Effect"
	| "MidiProcessor"
	| "SoundGenerator";

export type ModuleSubtype =
	| "EnvelopeModulator"
	| "MasterEffect"
	| "MidiProcessor"
	| "VoiceStartModulator"
	| "SoundGenerator"
	| "TimeVariantModulator"
	| "VoiceEffect"
	| "MonophonicEffect";

export interface ModuleDefinition {
	id: string;
	prettyName: string;
	description: string;
	type: ModuleType;
	subtype: ModuleSubtype;
	category: string[];
	builderPath: string;
	hasChildren: boolean;
	hasFX: boolean;
	metadataType: string;
	parameters?: ModuleParameter[];
	modulation?: ModuleModulation[];
	interfaces?: string[];
	constrainer?: string;
	fx_constrainer?: string;
	child_fx_constrainer?: string;
}

export interface ModuleList {
	version: string;
	categories: Record<string, string>;
	modules: ModuleDefinition[];
}

// ── Scriptnode List types (data/scriptnodeList.json) ─────────────────

export interface ScriptnodeParameter {
	parameterIndex: number;
	id: string;
	metadataType: string;
	description: string;
	type: string;
	disabled: boolean;
	range: ParameterRange;
	defaultValue: number;
}

export interface ScriptnodeModulation {
	chainIndex: number;
	id: string;
	metadataType: string;
	disabled: boolean;
	description: string;
	constrainer: string;
	modulationMode: string;
	colour: number;
}

export interface ScriptnodeDefinition {
	id: string;
	description: string;
	type: string;
	subtype: string;
	category: string[];
	hasChildren: boolean;
	hasFX: boolean;
	fx_constrainer?: string;
	metadataType: string;
	parameters?: ScriptnodeParameter[];
	modulation?: ScriptnodeModulation[];
	hasMidi: boolean;
	properties: Record<string, unknown>;
	interfaces?: string[];
	constrainer?: string;
}

// Keyed by "factory.nodeId" (e.g. "control.bang")
export type ScriptnodeList = Record<string, ScriptnodeDefinition>;

// ── Scripting API types (data/scripting_api.json) ────────────────────

export interface ApiParameter {
	name: string;
	type: string;
}

export interface ApiExample {
	title: string;
	code: string;
}

export interface ApiMethod {
	name: string;
	returnType: string;
	description: string;
	parameters: ApiParameter[];
	examples: ApiExample[];
}

export type ApiClassCategory =
	| "namespace"
	| "object"
	| "scriptnode"
	| "component";

export interface ApiClass {
	description: string;
	category: ApiClassCategory;
	methods: ApiMethod[];
}

export interface ScriptingApi {
	version: string;
	generated: string;
	enrichedClasses: string[];
	classes: Record<string, ApiClass>;
}

// ── DataLoader interface ────────────────────────────────────────────

export interface DataLoader {
	loadModuleList(): Promise<ModuleList>;
	loadScriptingApi(): Promise<ScriptingApi>;
	loadScriptnodeList(): Promise<ScriptnodeList>;
}
