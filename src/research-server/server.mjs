import { createServer } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import indexHtml from "../research-web/index.html?raw";
import { HIGHLIGHT_SURFACES } from "../engine/highlight/theme.js";
import { TOKEN_COLORS } from "../engine/highlight/tokens.js";
import { RestDocumentationHost } from "./documentation.mjs";
import { createPiModelHost } from "./model.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { publicResult, repairResearch, runResearch, unavailableValidation } from "./research.mjs";
import { openBrowser } from "./open-browser.js";

const RUN_TTL_MS = 10 * 60_000;
const MAX_BODY_BYTES = 1_000_000;
const MAX_CONCURRENT_RUNS = 2;

export async function launchResearchServer(options = {}) {
	const host = "127.0.0.1";
	const requestedPort = options.port ?? 4410;
	const siteUrl = options.siteUrl ?? process.env.HISE_RESEARCH_SITE_URL ?? "http://localhost:4401";
	const docsUrl = options.docsUrl ?? process.env.HISE_RESEARCH_DOCS_URL ?? "http://localhost:4406";
	const requestToken = randomBytes(24).toString("base64url");
	const modelHost = createPiModelHost({ cwd: process.cwd() });
	const docs = new RestDocumentationHost({ baseUrl: docsUrl });
	const runs = new Map();
	let activeRuns = 0;

	const server = createServer(async (req, res) => {
		try {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : requestedPort;
			const localOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
			const hostHeader = req.headers.host ?? "";
			if (hostHeader !== `127.0.0.1:${port}` && hostHeader !== `localhost:${port}`) return json(res, 403, { error: "Invalid host" });
			const url = new URL(req.url ?? "/", `http://${hostHeader}`);
			if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return serveIndex(res);
			if (req.method === "GET" && url.pathname === "/favicon.ico") { res.writeHead(204); return res.end(); }
			if (req.method === "GET" && url.pathname === "/api/config") return json(res, 200, { docsMode: "rest", siteUrl, requestToken });
			if (url.pathname.startsWith("/api/")) {
				const origin = req.headers.origin;
				if ((origin && !localOrigins.has(origin)) || req.headers["x-hise-research-token"] !== requestToken) return json(res, 403, { error: "Request origin was rejected" });
			}
			if (req.method === "GET" && url.pathname === "/api/status") {
				const [documentation, models] = await Promise.allSettled([docs.checkReady(), modelHost.checkReady()]);
				return json(res, 200, {
					documentation: documentation.status === "fulfilled",
					models: models.status === "fulfilled" ? models.value : null,
					errors: [documentation, models].flatMap((result) => result.status === "rejected" ? [errorMessage(result.reason)] : []),
				});
			}
			if (req.method === "POST" && url.pathname === "/api/research") {
				if (activeRuns >= MAX_CONCURRENT_RUNS) return json(res, 429, { error: "The research server is busy. Wait for an active request to finish." });
				activeRuns++;
				try { return await startResearch(req, res); } finally { activeRuns--; }
			}
			const validationMatch = req.method === "POST" && url.pathname.match(/^\/api\/research\/([a-f0-9-]+)\/validation$/i);
			if (validationMatch) return continueValidation(req, res, validationMatch[1]);
			json(res, 404, { error: "Not found" });
		} catch (error) {
			if (!res.headersSent) json(res, 500, { error: errorMessage(error) });
			else { sendEvent(res, { type: "error", error: errorMessage(error) }); res.end(); }
		}
	});

	const cleanup = setInterval(() => {
		const now = Date.now();
		for (const [token, entry] of runs) if (entry.expiresAt < now) runs.delete(token);
	}, 60_000);
	cleanup.unref();

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(requestedPort, host, () => { server.off("error", reject); resolve(); });
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : requestedPort;
	const browserUrl = `http://${host}:${port}`;
	if (!options.silent) process.stdout.write(`HISE research server listening on ${browserUrl}\n`);
	if (options.openBrowser !== false) openBrowser(browserUrl);
	server.on("close", () => clearInterval(cleanup));
	return server;

	async function startResearch(req, res) {
		const body = await readJson(req);
		const controller = streamResponse(req, res);
		try {
			const result = await runResearch(body, { docs, modelHost, signal: controller.signal, emit: (event) => sendEvent(res, event) });
			if (result.validationStatus === "pending") {
				const token = randomUUID();
				runs.set(token, { result, expiresAt: Date.now() + RUN_TTL_MS });
				sendResultEvents(res, result);
				sendEvent(res, { type: "validation-request", token, request: result.validationRequest });
			} else sendResultEvents(res, result);
			sendEvent(res, { type: "complete", result: publicResult(result) });
		} catch (error) {
			if (!controller.signal.aborted) sendEvent(res, { type: "error", error: errorMessage(error) });
		} finally { res.end(); }
	}

	async function continueValidation(req, res, token) {
		const entry = runs.get(token);
		if (!entry || entry.expiresAt < Date.now()) return json(res, 404, { error: "Validation run expired or was not found" });
		const body = await readJson(req);
		const controller = streamResponse(req, res);
		try {
			const unavailable = Array.isArray(body.results) ? body.results.find((item) => item?.unavailable)?.unavailable : undefined;
			const result = unavailable
				? unavailableValidation(entry.result, String(unavailable))
				: await repairResearch(entry.result, body.results, { signal: controller.signal, emit: (event) => sendEvent(res, event) });
			entry.result = { ...entry.result, ...result, _repair: entry.result._repair };
			entry.expiresAt = Date.now() + RUN_TTL_MS;
			sendEvent(res, markdownEvent(result.markdown));
			sendEvent(res, evidenceEvent(result.evidence));
			if (result.validationStatus === "pending") sendEvent(res, { type: "validation-request", token, request: result.validationRequest });
			else { runs.delete(token); sendEvent(res, { type: "usage", usage: result.usage }); }
			sendEvent(res, { type: "complete", result: publicResult(result) });
		} catch (error) {
			if (!controller.signal.aborted) sendEvent(res, { type: "error", error: errorMessage(error) });
		} finally { res.end(); }
	}

	function sendResultEvents(res, result) {
		sendEvent(res, markdownEvent(result.markdown));
		sendEvent(res, evidenceEvent(result.evidence));
		sendEvent(res, { type: "usage", usage: result.usage });
	}

	function markdownEvent(markdown) {
		return { type: "markdown", markdown, html: renderMarkdown(markdown, { siteUrl }) };
	}

	function evidenceEvent(evidence = []) {
		return { type: "evidence", evidence: evidence.map((item) => ({ ...item, url: item.url ? new URL(item.url, siteUrl).href : undefined })) };
	}

	function serveIndex(res) {
		const nonce = randomBytes(18).toString("base64url");
		const tokenCss = Object.entries(TOKEN_COLORS).map(([token, color]) => `.token-${token}{color:${color}}`).join("");
		const body = Buffer.from(indexHtml
			.replace("<style>", `<style nonce="${nonce}">`)
			.replace("</style>", `${tokenCss}</style>`)
			.replace("<script type=\"module\">", `<script type="module" nonce="${nonce}">`)
			.replaceAll("__CODE_BACKGROUND__", HIGHLIGHT_SURFACES.background)
			.replaceAll("__CODE_FOREGROUND__", HIGHLIGHT_SURFACES.bright));
		res.writeHead(200, securityHeaders({
			"Content-Type": "text/html; charset=utf-8",
			"Content-Length": body.length,
			"Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self' http://127.0.0.1:1900 http://localhost:1900; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
		}));
		res.end(body);
	}
}

function streamResponse(req, res) {
	res.writeHead(200, securityHeaders({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" }));
	res.flushHeaders?.();
	const controller = new AbortController();
	const abort = () => controller.abort(new Error("Client disconnected"));
	req.on("aborted", abort);
	res.on("close", () => { if (!res.writableEnded) abort(); });
	return controller;
}

function sendEvent(res, event) {
	if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJson(req) {
	const chunks = [];
	let size = 0;
	for await (const chunk of req) {
		size += chunk.length;
		if (size > MAX_BODY_BYTES) throw new Error("Request body is too large");
		chunks.push(chunk);
	}
	try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
	catch { throw new Error("Request body must be valid JSON"); }
}

function json(res, status, value) {
	const body = Buffer.from(JSON.stringify(value));
	res.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" }));
	res.end(body);
}

function securityHeaders(extra) {
	return { "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", ...extra };
}

function errorMessage(error) {
	return error instanceof Error ? error.message : String(error);
}
