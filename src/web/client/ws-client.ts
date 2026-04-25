// ── WS client — typed protocol with request/response correlation ────

import type { ClientMsg, ServerMsg } from "../protocol.js";
import { decodeServer, encode } from "../protocol.js";
import { useStore } from "./state/store.js";

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let nextId = 0;
const pending = new Map<string, (msg: ServerMsg) => void>();

const newId = () => `c-${++nextId}`;

function urlForWs(): string {
	const url = new URL(location.href);
	const proto = url.protocol === "https:" ? "wss:" : "ws:";
	const token = url.searchParams.get("token") ?? "";
	return `${proto}//${url.host}/ws?token=${encodeURIComponent(token)}`;
}

function dropTokenFromUrl(): void {
	const url = new URL(location.href);
	if (url.searchParams.has("token")) {
		url.searchParams.delete("token");
		history.replaceState(null, "", url.toString());
	}
}

export function startWsClient(): () => void {
	connect();
	return () => {
		if (reconnectTimer != null) clearTimeout(reconnectTimer);
		socket?.close();
		socket = null;
	};
}

function connect(): void {
	const ws = new WebSocket(urlForWs());
	socket = ws;

	ws.addEventListener("open", () => {
		dropTokenFromUrl();
		useStore.getState().setConnected(true);
		// Ask for state snapshot in case the session has prior history
		send({ kind: "request-snapshot", id: newId() });
	});

	ws.addEventListener("message", (event) => {
		const text = typeof event.data === "string" ? event.data : "";
		const msg = decodeServer(text);
		if (!msg) return;

		// Resolve pending request
		if ("id" in msg) {
			const id = (msg as { id?: string }).id;
			if (id && pending.has(id)) {
				pending.get(id)!(msg);
				pending.delete(id);
			}
		}

		// Always feed the store
		useStore.getState().applyServerMsg(msg);
	});

	ws.addEventListener("close", () => {
		useStore.getState().setConnected(false);
		socket = null;
		reconnectTimer = window.setTimeout(connect, 1000);
	});

	ws.addEventListener("error", () => {
		// `close` will follow
	});
}

export function send(msg: ClientMsg): void {
	if (socket && socket.readyState === WebSocket.OPEN) {
		socket.send(encode(msg));
	}
}

export function request<T extends ServerMsg = ServerMsg>(msg: ClientMsg): Promise<T> {
	return new Promise((resolve, reject) => {
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			reject(new Error("WebSocket not open"));
			return;
		}
		pending.set(msg.id, (response) => resolve(response as T));
		socket.send(encode(msg));
		// 30s timeout
		setTimeout(() => {
			if (pending.has(msg.id)) {
				pending.delete(msg.id);
				reject(new Error("Request timed out"));
			}
		}, 30_000);
	});
}

// Convenience helpers ────────────────────────────────────────────────

export function submitInput(line: string): Promise<ServerMsg> {
	return request({ kind: "submit-input", id: newId(), line });
}

export function requestComplete(line: string, cursor: number): Promise<ServerMsg> {
	return request({ kind: "complete", id: newId(), line, cursor });
}
