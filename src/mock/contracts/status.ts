export interface StatusServerInfo {
	version: string;
	compileTimeout?: string;
}

export interface StatusProjectInfo {
	name: string;
	projectFolder: string;
	scriptsFolder: string;
}

export interface StatusCallbackInfo {
	id: string;
	empty: boolean;
}

export interface StatusScriptProcessorInfo {
	moduleId: string;
	isMainInterface: boolean;
	externalFiles: string[];
	callbacks: StatusCallbackInfo[];
}

export interface StatusPayload {
	server: StatusServerInfo;
	project: StatusProjectInfo;
	scriptProcessors: StatusScriptProcessorInfo[];
}

export function normalizeStatusPayload(value: unknown): StatusPayload {
	if (!value || typeof value !== "object") {
		throw new Error("Status payload must be an object");
	}

	const data = value as Record<string, unknown>;
	return {
		server: normalizeServerInfo(data.server),
		project: normalizeProjectInfo(data.project),
		scriptProcessors: normalizeScriptProcessors(data.scriptProcessors),
	};
}

function normalizeServerInfo(value: unknown): StatusServerInfo {
	if (!value || typeof value !== "object") {
		throw new Error("Status payload server must be an object");
	}
	const data = value as Record<string, unknown>;
	return {
		version: asString(data.version, "server.version"),
		compileTimeout: optionalString(data.compileTimeout, "server.compileTimeout"),
	};
}

function normalizeProjectInfo(value: unknown): StatusProjectInfo {
	if (!value || typeof value !== "object") {
		throw new Error("Status payload project must be an object");
	}
	const data = value as Record<string, unknown>;
	return {
		name: asString(data.name, "project.name"),
		projectFolder: asString(data.projectFolder, "project.projectFolder"),
		scriptsFolder: asString(data.scriptsFolder, "project.scriptsFolder"),
	};
}

function normalizeScriptProcessors(value: unknown): StatusScriptProcessorInfo[] {
	if (!Array.isArray(value)) {
		throw new Error("Status payload scriptProcessors must be an array");
	}
	return value.map((item) => normalizeScriptProcessor(item));
}

function normalizeScriptProcessor(value: unknown): StatusScriptProcessorInfo {
	if (!value || typeof value !== "object") {
		throw new Error("Status script processor must be an object");
	}
	const data = value as Record<string, unknown>;
	return {
		moduleId: asString(data.moduleId, "scriptProcessor.moduleId"),
		isMainInterface: asBoolean(data.isMainInterface, "scriptProcessor.isMainInterface"),
		externalFiles: stringArray(data.externalFiles, "scriptProcessor.externalFiles"),
		callbacks: normalizeCallbacks(data.callbacks),
	};
}

function normalizeCallbacks(value: unknown): StatusCallbackInfo[] {
	if (!Array.isArray(value)) {
		throw new Error("Status script processor callbacks must be an array");
	}
	return value.map((item) => {
		if (!item || typeof item !== "object") {
			throw new Error("Status callback must be an object");
		}
		const data = item as Record<string, unknown>;
		return {
			id: asString(data.id, "callback.id"),
			empty: asBoolean(data.empty, "callback.empty"),
		};
	});
}

function asString(value: unknown, label: string): string {
	if (typeof value !== "string") throw new Error(`${label} must be a string`);
	return value;
}

function optionalString(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined;
	return asString(value, label);
}

function asBoolean(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
	return value;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		throw new Error(`${label} must be a string array`);
	}
	return value;
}
