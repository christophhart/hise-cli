import { afterEach, describe, expect, it } from "vitest";
import { startObserverServer, type ObserverEvent } from "./observer.js";

const servers = new Set<import("node:http").Server>();

afterEach(() => {
	for (const server of servers) {
		server.close();
	}
	servers.clear();
});

async function postEvent(port: number, payload: unknown): Promise<Response> {
	return fetch(`http://127.0.0.1:${port}/observer/events`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}

describe("observer server", () => {
	it("accepts observer events and forwards them to the callback", async () => {
		const received: ObserverEvent[] = [];
		const port = 19112;
		const server = startObserverServer((event) => received.push(event), port);
		servers.add(server);

		const response = await postEvent(port, {
			id: "cmd-1",
			type: "command.start",
			source: "llm",
			command: "/script Engine.getSampleRate()",
			mode: "script",
			timestamp: Date.now(),
		});

		expect(response.status).toBe(204);
		expect(received).toHaveLength(1);
		expect(received[0]).toMatchObject({
			type: "command.start",
			command: "/script Engine.getSampleRate()",
		});
	});

	it("rejects malformed json payloads", async () => {
		const port = 19113;
		const server = startObserverServer(() => {}, port);
		servers.add(server);

		const response = await fetch(`http://127.0.0.1:${port}/observer/events`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{bad-json",
		});

		expect(response.status).toBe(400);
	});

	it("returns 404 for unsupported routes", async () => {
		const port = 19114;
		const server = startObserverServer(() => {}, port);
		servers.add(server);

		const response = await fetch(`http://127.0.0.1:${port}/not-found`, {
			method: "POST",
		});

		expect(response.status).toBe(404);
	});
});
