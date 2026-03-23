import { HttpHiseConnection, isEnvelopeResponse, isErrorResponse, isSuccessResponse } from "../engine/hise.js";

export async function requireLiveHiseConnection(): Promise<HttpHiseConnection> {
	const connection = new HttpHiseConnection();
	const alive = await connection.probe();
	if (!alive) {
		connection.destroy();
		throw new Error("Live contract tests require a running HISE REST API on localhost:1900");
	}
	return connection;
}

export async function getLiveStatusPayload(connection: HttpHiseConnection): Promise<unknown> {
	const response = await connection.get("/api/status");
	if (isErrorResponse(response)) {
		throw new Error(response.message);
	}
	if (!isSuccessResponse(response)) {
		throw new Error("Unexpected HISE status response");
	}
	if (response.value !== undefined) return response.value;
	if (typeof response.result === "string" && response.result !== "") {
		return JSON.parse(response.result);
	}
	return response as unknown;
}

export function sanitizeFormattingSnapshot(text: string): string {
	return text
		.replace(/\b(?:Mock|Demo)\b/g, "<name>")
		.replace(/\/[^\n|]+/g, "<path>")
		.replace(/\d+(?:\.\d+)?/g, "<n>")
		.replace(/<n>\.<n>(?:\.<n>)?(?:-mock)?/g, "<version>")
		.replace(/<n> MB/g, "<size>")
		.replace(/<n> Hz/g, "<rate>")
		.replace(/<n>%/g, "<percent>");
}

export async function postLiveRepl(
	connection: HttpHiseConnection,
	expression: string,
	moduleId = "Interface",
) {
	const response = await connection.post("/api/repl", { expression, moduleId });
	if (isErrorResponse(response)) {
		throw new Error(response.message);
	}
	if (!isEnvelopeResponse(response)) {
		throw new Error("Unexpected HISE repl response");
	}
	return response;
}
