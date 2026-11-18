import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startDap, parseDapOptions } from "./server.js";

const root = resolve(".");
const uri = pathToFileURL(resolve("Scripts/test.js")).href;
let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((done) => server!.close(() => done())); server = undefined; } });

async function mock(handler: (route: string, body: Record<string, unknown>) => object): Promise<string> {
	server = createServer(async (request, response) => {
		let text = "";
		for await (const chunk of request) text += chunk;
		const result = handler(request.url ?? "", text ? JSON.parse(text) as Record<string, unknown> : {});
		const status = "httpStatus" in result ? Number(result.httpStatus) : 200;
		response.writeHead(status, { "Content-Type": "application/json" });
		response.end(JSON.stringify({ success: status === 200, apiVersion: "0.13.0", ...result }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
function protocol(baseUrl: string): { send: (command: string, args?: object) => number; next: (predicate?: (message: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>; close: () => void } {
	const input = new PassThrough(), output = new PassThrough();
	startDap({ baseUrl, timeoutMs: 1000, pollMs: 20, logLevel: "quiet" }, input, output);
	let buffer = Buffer.alloc(0), seq = 0;
	const messages: Array<Record<string, unknown>> = [], waiters: Array<() => void> = [];
	output.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (true) {
			const end = buffer.indexOf("\r\n\r\n");
			if (end < 0) return;
			const size = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1];
			if (!size || buffer.length < end + 4 + Number(size)) return;
			messages.push(JSON.parse(buffer.subarray(end + 4, end + 4 + Number(size)).toString()) as Record<string, unknown>);
			buffer = buffer.subarray(end + 4 + Number(size));
			for (const waiter of waiters.splice(0)) waiter();
		}
	});
	return {
		send: (command, args = {}) => {
			const id = ++seq, value = Buffer.from(JSON.stringify({ seq: id, type: "request", command, arguments: args }));
			// Deliberately split headers and send UTF-8 JSON as separate chunks.
			input.write(`Content-Length: ${value.length}\r\n`);
			input.write(Buffer.concat([Buffer.from("\r\n"), value]));
			return id;
		},
		next: async (predicate = () => true) => {
			const deadline = Date.now() + 2000;
			while (Date.now() < deadline) {
				const index = messages.findIndex(predicate);
				if (index >= 0) return messages.splice(index, 1)[0];
				await Promise.race([new Promise<void>((done) => waiters.push(done)), new Promise((done) => setTimeout(done, 50))]);
			}
			throw Error(`No matching DAP message: ${JSON.stringify(messages)}`);
		},
		close: () => { input.destroy(); output.destroy(); },
	};
}
const response = (id: number) => (message: Record<string, unknown>): boolean => message.type === "response" && message.request_seq === id;
const event = (name: string) => (message: Record<string, unknown>): boolean => message.type === "event" && message.event === name;

describe("DAP proxy", () => {
	it("parses bounded options", () => {
		expect(parseDapOptions(["--poll-ms=80", "--project-root", root]).pollMs).toBe(80);
		expect(() => parseDapOptions(["--poll-ms=0"])).toThrow();
	});
	it("validates the project before attach and sends only protocol messages", async () => {
		const baseUrl = await mock(() => ({ project: { projectFolder: root } }));
		const client = protocol(baseUrl);
		try {
			const init = client.send("initialize", { pathFormat: "uri", linesStartAt1: false, columnsStartAt1: false });
			expect((await client.next(response(init))).body).toMatchObject({ supportsConfigurationDoneRequest: true, supportsEvaluateForHovers: true });
			const attach = client.send("attach", { projectFolder: resolve("other") });
			expect((await client.next(response(attach))).success).toBe(false);
		} finally { client.close(); }
	});
	it("binds on the first source, preserves UI-only breakpoints and rejects unsupported breakpoint fields", async () => {
		let bound = false;
		const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
		const baseUrl = await mock((route, body) => {
			calls.push({ route, body });
			if (route === "/api/status") return { project: { projectFolder: root } };
			if (route === "/api/dap/session/open") return {};
			if (route.startsWith("/api/dap/state")) return { state: bound ? "running" : "unbound", latestSequence: 0, ...(bound ? { moduleId: "MainInterface" } : {}) };
			if (route.startsWith("/api/dap/breakpoints/list")) return { breakpoints: bound ? [
				{ breakpointId: 1, sourceUri: uri, line: 2, verified: true },
				{ breakpointId: 2, sourceUri: uri, line: 4, verified: true },
			] : [] };
			if (route === "/api/dap/breakpoints/set") { bound = true; return { moduleId: "MainInterface", breakpoints: [{ breakpointId: 2, sourceUri: uri, line: 4, verified: true }] }; }
			if (route.startsWith("/api/dap/events")) return { nextSequence: 0, events: [] };
			return {};
		});
		const client = protocol(baseUrl);
		try {
			await client.next(response(client.send("initialize")));
			await client.next(response(client.send("attach")));
			await client.next(event("initialized"));
			const unsupported = client.send("setBreakpoints", { source: { path: resolve("Scripts/test.js") }, breakpoints: [{ line: 4, hitCondition: "2" }] });
			expect((await client.next(response(unsupported))).success).toBe(false);
			const set = client.send("setBreakpoints", { source: { path: resolve("Scripts/test.js") }, breakpoints: [{ line: 4 }] });
			expect((await client.next(response(set))).body).toMatchObject({ breakpoints: [{ id: 1, verified: true }] });
			expect((await client.next(event("breakpoint"))).body).toMatchObject({ reason: "new", breakpoint: { id: 2, line: 2 } });
			expect(calls.find((call) => call.route === "/api/dap/breakpoints/set")?.body).toMatchObject({ sourceUri: uri, breakpoints: [{ line: 4 }] });
			await client.next(response(client.send("disconnect")));
		} finally { client.close(); }
	});
	it("buffers an existing stop until configurationDone and forwards external resume and output", async () => {
		let running = false;
		const baseUrl = await mock((route) => {
			if (route === "/api/status") return { project: { projectFolder: root } };
			if (route === "/api/dap/session/open") return { moduleId: "MainInterface", threadId: 1 };
			if (route.startsWith("/api/dap/state")) return { state: running ? "running" : "stopped", stoppedGeneration: 2, latestSequence: 5, moduleId: "MainInterface", threadId: 1 };
			if (route.startsWith("/api/dap/breakpoints/list")) return { breakpoints: [] };
			if (route.startsWith("/api/dap/events")) {
				if (route.includes("afterSequence=5")) {
					running = true;
					return { nextSequence: 7, events: [{ sequence: 6, type: "output", output: "hello", location: { uri, line: 4 } }, { sequence: 7, type: "resumed" }] };
				}
				return { nextSequence: 7, events: [] };
			}
			return {};
		});
		const client = protocol(baseUrl);
		try {
			await client.next(response(client.send("initialize")));
			await client.next(response(client.send("attach", { moduleId: "MainInterface" })));
			await client.next(event("initialized"));
			await client.next(response(client.send("configurationDone")));
			expect((await client.next(event("stopped"))).body).toMatchObject({ threadId: 1, allThreadsStopped: true });
			expect((await client.next(event("output"))).body).toMatchObject({ output: "hello", line: 4 });
			expect((await client.next(event("continued"))).body).toMatchObject({ threadId: 1 });
			await client.next(response(client.send("disconnect")));
		} finally { client.close(); }
	});
	it("resnapshots on event-journal overflow with stable IDs for surviving breakpoints", async () => {
		let overflow = false;
		const baseUrl = await mock((route) => {
			if (route === "/api/status") return { project: { projectFolder: root } };
			if (route === "/api/dap/session/open") return { moduleId: "MainInterface" };
			if (route.startsWith("/api/dap/state")) return { state: "running", latestSequence: overflow ? 520 : 1, moduleId: "MainInterface" };
			if (route.startsWith("/api/dap/breakpoints/list")) return { breakpoints: [
				{ breakpointId: 1, sourceUri: uri, line: 1, verified: true },
				...(overflow ? [{ breakpointId: 3, sourceUri: uri, line: 3, verified: true }] : [{ breakpointId: 2, sourceUri: uri, line: 2, verified: true }]),
			] };
			if (route.startsWith("/api/dap/events")) {
				if (!overflow) { overflow = true; return { httpStatus: 409, errors: [{ errorMessage: "journal overflow" }] }; }
				return { nextSequence: 520, events: [] };
			}
			return {};
		});
		const client = protocol(baseUrl);
		try {
			await client.next(response(client.send("initialize")));
			await client.next(response(client.send("attach", { moduleId: "MainInterface" })));
			await client.next(event("initialized"));
			const a = await client.next(event("breakpoint")), b = await client.next(event("breakpoint"));
			expect([a.body, b.body]).toEqual(expect.arrayContaining([
				expect.objectContaining({ reason: "new", breakpoint: expect.objectContaining({ id: 1 }) }),
				expect.objectContaining({ reason: "new", breakpoint: expect.objectContaining({ id: 2 }) }),
			]));
			expect((await client.next((m) => event("breakpoint")(m) && (m.body as { reason: string }).reason === "removed")).body).toMatchObject({ breakpoint: { id: 2 } });
			expect((await client.next((m) => event("breakpoint")(m) && (m.body as { reason: string }).reason === "new")).body).toMatchObject({ breakpoint: { id: 3 } });
			await client.next(response(client.send("disconnect")));
		} finally { client.close(); }
	});
	it("attaches, snapshots existing breakpoints, maps lines, controls execution, and closes without compilation", async () => {
		const calls: string[] = [];
		let cursor = 3, stopped = false;
		const baseUrl = await mock((route, body) => {
			calls.push(route);
			if (route === "/api/status") return { project: { projectFolder: root } };
			if (route === "/api/dap/session/open") return { moduleId: "MainInterface", threadId: 1 };
			if (route.startsWith("/api/dap/state")) return { state: stopped ? "stopped" : "running", stoppedGeneration: 1, latestSequence: cursor, moduleId: "MainInterface", threadId: 1 };
			if (route.startsWith("/api/dap/breakpoints/list")) return { breakpoints: [{ breakpointId: 7, verified: true, sourceUri: uri, line: 4, column: 1 }] };
			if (route.startsWith("/api/dap/events")) return { nextSequence: cursor, events: stopped && route.includes("afterSequence=3") ? [{ sequence: 4, type: "stopped", reason: "breakpoint", threadId: 1, stoppedGeneration: 1 }] : [], moduleId: "MainInterface" };
			if (route === "/api/dap/breakpoints/set") return { moduleId: "MainInterface", breakpoints: [{ breakpointId: 7, verified: true, sourceUri: uri, line: 4, column: 1 }] };
			if (route === "/api/dap/stackTrace") return { frames: [{ frameId: 1, name: "onInit", uri, line: 4, column: 1 }] };
			if (route === "/api/dap/evaluate") return { result: "3", variablesReference: 0 };
			if (route === "/api/dap/continue") { stopped = false; cursor = 4; return {}; }
			return {};
		});
		const client = protocol(baseUrl);
		try {
			const init = client.send("initialize", { pathFormat: "uri", linesStartAt1: false, columnsStartAt1: false });
			await client.next(response(init));
			const attach = client.send("attach", { moduleId: "MainInterface" });
			expect((await client.next(response(attach))).success).toBe(true);
			await client.next(event("initialized"));
			const snapshot = await client.next(event("breakpoint"));
			expect(snapshot.body).toMatchObject({ reason: "new", breakpoint: { id: 1, line: 3, column: 0, source: { path: uri } } });
			const set = client.send("setBreakpoints", { source: { path: uri }, breakpoints: [{ line: 3, condition: "true" }] });
			expect((await client.next(response(set))).body).toMatchObject({ breakpoints: [{ id: 1, line: 3 }] });
			stopped = true; cursor = 4;
			const done = client.send("configurationDone");
			await client.next(response(done));
			await client.next(event("stopped"));
			const stack = client.send("stackTrace", { threadId: 1 });
			const frames = (await client.next(response(stack))).body as { stackFrames: Array<{ id: number; line: number }> };
			expect(frames.stackFrames[0].line).toBe(3);
			const evalId = client.send("evaluate", { expression: "1+2", context: "hover", frameId: frames.stackFrames[0].id });
			expect((await client.next(response(evalId))).body).toMatchObject({ result: "3", variablesReference: 0 });
			const resume = client.send("continue", { threadId: 1 });
			expect((await client.next(response(resume))).success).toBe(true);
			const stale = client.send("evaluate", { expression: "1", context: "hover", frameId: frames.stackFrames[0].id });
			expect((await client.next(response(stale))).success).toBe(false);
			const disconnect = client.send("disconnect");
			await client.next(response(disconnect));
			await client.next(event("terminated"));
			expect(calls).toContain("/api/dap/session/close");
			expect(calls).not.toContain("/api/recompile");
		} finally { client.close(); }
	});
});
