// ── launchWeb — Bun-served WebSocket + static SPA frontend ──────────
//
// Single binary (--web flag). Spawns Bun.serve on 127.0.0.1, accepts
// one WS per browser tab, broadcasts state through the singleton
// WebHost. SPA assets are embedded at build time via
// scripts/embed-web-assets.mjs and served from memory.

import { randomUUID } from "node:crypto";
import type { NodeRuntime } from "../bootstrap-runtime.js";
import { HttpHiseConnection, type HiseConnection } from "../engine/hise.js";
import {
	createSession,
	loadSessionDatasets,
	type SessionDatasets,
} from "../session-bootstrap.js";
import { wireScriptFileOps, wireExtendedFileOps } from "../node-io.js";
import { createDefaultMockRuntime } from "../mock/runtime.js";
import { registerUpdateHandlers } from "../tui/wizard-handlers/index.js";
import { createWebHost, type WebHost, type WsClient } from "./session-host.js";
import { createRestHandler } from "./rest-handlers.js";
import { dispatchClientMessage } from "./ws-handler.js";
import { openBrowser } from "./open-browser.js";
import { startObserverServer } from "../tui/observer.js";

export interface LaunchWebOptions {
	runtime: NodeRuntime;
	useMock: boolean;
	openBrowser: boolean;
	port?: number;
}

export async function launchWeb(options: LaunchWebOptions): Promise<void> {
	if (typeof Bun === "undefined") {
		throw new Error(
			"hise-cli --web requires the Bun runtime. Install Bun (https://bun.sh) or use the bun build --compile binary.",
		);
	}

	// ── Connection ────────────────────────────────────────────────────
	const mockRuntime = options.useMock ? createDefaultMockRuntime() : null;
	const connection: HiseConnection = mockRuntime?.connection ?? new HttpHiseConnection();

	// ── Session + datasets ────────────────────────────────────────────
	let datasets: SessionDatasets = {};
	const { session, completionEngine } = createSession({
		connection,
		handlerRegistry: options.runtime.handlerRegistry,
		launcher: options.runtime.hiseLauncher,
		getModuleList: () => datasets.moduleList,
		getScriptnodeList: () => datasets.scriptnodeList,
		getComponentProperties: () => datasets.componentProperties,
	});
	wireScriptFileOps(session);
	wireExtendedFileOps(session);
	datasets = await loadSessionDatasets(options.runtime.dataLoader, completionEngine, session);

	// Push wizard handlers that need a live connection.
	registerUpdateHandlers(options.runtime.handlerRegistry, {
		executor: options.runtime.phaseExecutor,
		connection,
		launcher: options.runtime.hiseLauncher,
	});

	// ── Web host ──────────────────────────────────────────────────────
	const host = createWebHost({ session, completionEngine, connection });

	session.onWizardProgress = (progress) => {
		host.broadcast({ kind: "wizard-progress", progress });
	};

	// ── LLM observer (CLI invocations from other shells) ─────────────
	let observerServer: ReturnType<typeof startObserverServer> | null = null;
	try {
		observerServer = startObserverServer((event) => {
			host.broadcast({ kind: "llm-event", event });
		});
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === "EADDRINUSE") {
			process.stderr.write(
				"another hise-cli frontend is already running (observer port in use); LLM event monitor disabled.\n",
			);
		} else {
			throw err;
		}
	}

	// ── HTTP + WS ─────────────────────────────────────────────────────
	const token = randomUUID();
	const restFetch = createRestHandler();

	const server = startServer(options.port ?? 1901, token, host, restFetch);

	const url = `http://${server.hostname}:${server.port}/?token=${token}`;
	process.stdout.write(`hise-cli web ready: ${url}\n`);
	process.stdout.write("Ctrl+C to stop.\n");

	if (options.openBrowser) openBrowser(url);

	// ── Lifecycle ─────────────────────────────────────────────────────
	await new Promise<void>((res) => {
		const stop = () => {
			try {
				server.stop();
			} catch {
				// ignore
			}
			try {
				observerServer?.close();
			} catch {
				// ignore
			}
			try {
				if ("destroy" in connection && typeof connection.destroy === "function") {
					connection.destroy();
				}
			} catch {
				// ignore
			}
			res();
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
	});
}

// ── Bun server bootstrap ────────────────────────────────────────────

interface WsData {
	tokenOk: boolean;
	client: WsClient;
}

function startServer(
	port: number,
	token: string,
	host: WebHost,
	restFetch: (req: Request) => Promise<Response | undefined>,
): BunServer {
	const tryPort = (p: number): BunServer => {
		try {
			return Bun.serve<WsData>({
				hostname: "127.0.0.1",
				port: p,
				async fetch(req, srv) {
					const url = new URL(req.url);
					if (url.pathname === "/ws") {
						const incomingToken = url.searchParams.get("token");
						if (incomingToken !== token) {
							return new Response("Forbidden", { status: 403 });
						}
						const client: WsClient = {
							send: () => undefined,
							close: () => undefined,
						};
						const upgraded = srv.upgrade<WsData>(req, {
							data: { tokenOk: true, client },
						});
						if (upgraded) return undefined;
						return new Response("Upgrade failed", { status: 400 });
					}
					return (await restFetch(req)) ?? new Response("Not Found", { status: 404 });
				},
				websocket: {
					open(ws) {
						ws.data.client = {
							send: (text) => {
								try {
									ws.send(text);
								} catch {
									// ignore
								}
							},
							close: () => {
								try {
									ws.close();
								} catch {
									// ignore
								}
							},
						};
						host.attach(ws.data.client);
						// Send initial snapshot
						host.broadcast({ kind: "session-state", state: host.snapshot() });
					},
					async message(ws, raw) {
						const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw);
						await dispatchClientMessage({ host, client: ws.data.client }, text);
					},
					close(ws) {
						host.detach(ws.data.client);
					},
				},
			});
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === "EADDRINUSE" && p !== 0) {
				process.stderr.write(`port ${p} in use, picking ephemeral...\n`);
				return tryPort(0);
			}
			throw err;
		}
	};
	return tryPort(port);
}

