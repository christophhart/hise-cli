export interface DapRestOptions {
	baseUrl: string;
	timeoutMs: number;
}

export class DapRestError extends Error {
	constructor(readonly status: number, message: string, readonly payload?: Record<string, unknown>) { super(message); }
}

/** DAP needs HTTP status codes (notably 409 journal overflow), unlike one-shot CLI calls. */
export class DapRestClient {
	constructor(private readonly options: DapRestOptions) {}

	async request<T>(route: string, body?: object, query?: Record<string, string | number>, timeoutMs = this.options.timeoutMs): Promise<T> {
		const url = new URL(`/api/${route}`, this.options.baseUrl);
		for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
		let response: Response;
		try {
			response = await fetch(url, {
				method: body === undefined ? "GET" : "POST",
				headers: body === undefined ? undefined : { "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(timeoutMs),
			});
		} catch (error) {
			throw new DapRestError(0, `HISE unavailable (${route}): ${String(error)}`);
		}
		let data: unknown;
		try { data = await response.json(); }
		catch { throw new DapRestError(response.status, `Malformed HISE response (${route}, HTTP ${response.status})`); }
		if (!data || typeof data !== "object" || !("success" in data)) {
			throw new DapRestError(response.status, `Malformed HISE response (${route})`);
		}
		if (!response.ok || data.success !== true) {
			const errors = "errors" in data && Array.isArray(data.errors)
				? data.errors.map((entry: unknown) => typeof entry === "object" && entry !== null && "errorMessage" in entry ? String(entry.errorMessage) : String(entry)).join("; ") : "";
			throw new DapRestError(response.status, `HISE ${route} failed (HTTP ${response.status}): ${errors || "unknown error"}`, data as Record<string, unknown>);
		}
		return data as T;
	}
}
