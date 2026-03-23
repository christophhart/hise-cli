// ── HISE Connection — transport abstraction ─────────────────────────

// Response types matching the HISE REST API (verified against RestHelpers.cpp)

export interface HiseEnvelopeResponse {
	success: boolean;
	result: string;
	value?: unknown;
	moduleId?: string;
	logs: string[];
	errors: Array<{ errorMessage: string; callstack: string[] }>;
}

export type HiseSuccessResponse = HiseEnvelopeResponse & { success: true };

export interface HiseErrorResponse {
	error: true;
	message: string;
}

export type HiseResponse = HiseEnvelopeResponse | HiseErrorResponse;

export function isErrorResponse(
	response: HiseResponse,
): response is HiseErrorResponse {
	return "error" in response && response.error === true;
}

export function isSuccessResponse(
	response: HiseResponse,
): response is HiseSuccessResponse {
	return isEnvelopeResponse(response) && response.success === true;
}

export function isEnvelopeResponse(
	response: HiseResponse,
): response is HiseEnvelopeResponse {
	return "success" in response
		&& typeof response.success === "boolean"
		&& typeof response.result === "string"
		&& Array.isArray(response.logs)
		&& Array.isArray(response.errors);
}

// ── HiseConnection interface ────────────────────────────────────────

export interface HiseConnection {
	get(endpoint: string): Promise<HiseResponse>;
	post(endpoint: string, body: object): Promise<HiseResponse>;
	probe(): Promise<boolean>;
	destroy(): void;
}

// ── HttpHiseConnection — fetch()-based implementation ───────────────

export class HttpHiseConnection implements HiseConnection {
	private readonly baseUrl: string;
	private abortController: AbortController | null = null;

	constructor(host = "127.0.0.1", port = 1900) {
		this.baseUrl = `http://${host}:${port}`;
	}

	async get(endpoint: string): Promise<HiseResponse> {
		const url = `${this.baseUrl}${endpoint}`;
		try {
			const response = await fetch(url, {
				method: "GET",
				signal: this.abortController?.signal,
			});
			return (await response.json()) as HiseResponse;
		} catch (error) {
			return { error: true, message: String(error) };
		}
	}

	async post(endpoint: string, body: object): Promise<HiseResponse> {
		const url = `${this.baseUrl}${endpoint}`;
		try {
			const response = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
				signal: this.abortController?.signal,
			});
			return (await response.json()) as HiseResponse;
		} catch (error) {
			return { error: true, message: String(error) };
		}
	}

	async probe(): Promise<boolean> {
		try {
			const response = await fetch(`${this.baseUrl}/api/status`, {
				method: "GET",
				signal: AbortSignal.timeout(3000),
			});
			return response.ok;
		} catch {
			// Connection refused, timeout, or 503 — HISE not ready
			return false;
		}
	}

	destroy(): void {
		this.abortController?.abort();
		this.abortController = null;
	}
}

// ── MockHiseConnection — configurable per-endpoint responses ────────

export type MockEndpointHandler = (
	body?: object,
) => HiseResponse | Promise<HiseResponse>;

export class MockHiseConnection implements HiseConnection {
	private readonly getHandlers = new Map<string, MockEndpointHandler>();
	private readonly postHandlers = new Map<string, MockEndpointHandler>();
	private probeResult = true;
	readonly calls: Array<{
		method: "GET" | "POST";
		endpoint: string;
		body?: object;
	}> = [];

	onGet(endpoint: string, handler: MockEndpointHandler): this {
		this.getHandlers.set(endpoint, handler);
		return this;
	}

	onPost(endpoint: string, handler: MockEndpointHandler): this {
		this.postHandlers.set(endpoint, handler);
		return this;
	}

	setProbeResult(result: boolean): this {
		this.probeResult = result;
		return this;
	}

	async get(endpoint: string): Promise<HiseResponse> {
		this.calls.push({ method: "GET", endpoint });
		const handler = this.getHandlers.get(endpoint);
		if (handler) {
			return handler();
		}
		return { error: true, message: `No mock handler for GET ${endpoint}` };
	}

	async post(endpoint: string, body: object): Promise<HiseResponse> {
		this.calls.push({ method: "POST", endpoint, body });
		const handler = this.postHandlers.get(endpoint);
		if (handler) {
			return handler(body);
		}
		return {
			error: true,
			message: `No mock handler for POST ${endpoint}`,
		};
	}

	async probe(): Promise<boolean> {
		return this.probeResult;
	}

	destroy(): void {
		// No resources to clean up in mock
	}
}
