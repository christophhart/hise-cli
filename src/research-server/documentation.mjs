const ALLOWED_TOOLS = new Set([
	"explore_hise",
	"search_hise",
	"query_scriptnode",
	"get_doc_content",
	"search_examples",
	"get_example",
]);

export class RestDocumentationHost {
	constructor({ baseUrl = "http://localhost:4406", fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
		this.baseUrl = normalizeBaseUrl(baseUrl);
		this.fetchImpl = fetchImpl;
		this.timeoutMs = timeoutMs;
	}

	async checkReady(signal) {
		const value = await this.#fetchJson(`${this.baseUrl}/api/tools`, { method: "GET", headers: { Accept: "application/json" } }, signal, 5_000);
		const names = extractToolNames(value);
		const missing = [...ALLOWED_TOOLS].filter((name) => !names.has(name));
		if (missing.length > 0) throw new Error(`Documentation service is missing required tools: ${missing.join(", ")}`);
		return value;
	}

	async callTool(name, args = {}, signal) {
		if (!ALLOWED_TOOLS.has(name)) throw new Error(`Unsupported documentation operation: ${name}`);
		return this.#fetchJson(`${this.baseUrl}/api/tools/${encodeURIComponent(name)}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify(args),
		}, signal, this.timeoutMs);
	}

	async #fetchJson(url, init, outerSignal, timeoutMs) {
		const controller = new AbortController();
		const abort = () => controller.abort(outerSignal?.reason);
		outerSignal?.addEventListener("abort", abort, { once: true });
		const timer = setTimeout(() => controller.abort(new Error("Documentation request timed out")), timeoutMs);
		try {
			const response = await this.fetchImpl(url, { ...init, signal: controller.signal });
			const text = await response.text();
			let value = null;
			try { value = text ? JSON.parse(text) : null; } catch { throw new Error("Documentation service returned invalid JSON"); }
			if (!response.ok) throw new Error(`Documentation service returned HTTP ${response.status}: ${errorText(value)}`);
			if (value && typeof value === "object" && (value.ok === false || value.isError === true)) throw new Error(`Documentation tool failed: ${errorText(value)}`);
			return value;
		} finally {
			clearTimeout(timer);
			outerSignal?.removeEventListener("abort", abort);
		}
	}
}

export { ALLOWED_TOOLS };

function normalizeBaseUrl(value) {
	let url = String(value).replace(/\/+$/, "");
	for (const suffix of ["/api/tools", "/mcp", "/api"]) if (url.endsWith(suffix)) url = url.slice(0, -suffix.length);
	return url;
}

function extractToolNames(value) {
	const list = Array.isArray(value?.tools) ? value.tools : Array.isArray(value) ? value : [];
	return new Set(list.map((item) => typeof item === "string" ? item : item?.name).filter((item) => typeof item === "string"));
}

function errorText(value) {
	if (typeof value?.error === "string") return value.error;
	const content = Array.isArray(value?.content) ? value.content : [];
	return content.map((item) => typeof item?.text === "string" ? item.text : "").filter(Boolean).join("\n") || JSON.stringify(value);
}
