import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { HiseLspRestClient, startLsp } from "./server.js";

const root = resolve(".");
const uri = pathToFileURL(resolve("Scripts/test.js")).href;
const rootUri = pathToFileURL(root).href;
let server: Server | undefined;

afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>((done) => server!.close(() => done())); server = undefined; } });

async function mock(handler: (route: string, body: Record<string, unknown>) => object): Promise<string> {
	server = createServer(async (request, response) => {
		let text = "";
		for await (const part of request) text += part;
		const result = handler(request.url ?? "", text ? JSON.parse(text) as Record<string, unknown> : {});
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify({ success: true, apiVersion: "0.13.0", ...result }));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

function protocol(baseUrl: string): {
	send: (value: object) => void;
	next: (method?: string) => Promise<Record<string, unknown>>;
	close: () => void;
} {
	const input = new PassThrough();
	const output = new PassThrough();
	startLsp({ baseUrl, timeoutMs: 2000, logLevel: "quiet" }, input, output);
	let buffer = Buffer.alloc(0);
	const messages: Array<Record<string, unknown>> = [];
	const waiters: Array<() => void> = [];
	output.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		while (true) {
			const end = buffer.indexOf("\r\n\r\n");
			if (end < 0) break;
			const length = /Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1];
			if (!length || buffer.length < end + 4 + Number(length)) break;
			messages.push(JSON.parse(buffer.subarray(end + 4, end + 4 + Number(length)).toString()) as Record<string, unknown>);
			buffer = buffer.subarray(end + 4 + Number(length));
			for (const waiter of waiters.splice(0)) waiter();
		}
	});
	return {
		send: (value) => { const body = JSON.stringify(value); input.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); },
		next: async (method) => {
			const deadline = Date.now() + 3000;
			while (Date.now() < deadline) {
				const index = messages.findIndex((message) => method === undefined ? "id" in message : message.method === method);
				if (index >= 0) return messages.splice(index, 1)[0];
				await Promise.race([new Promise<void>((done) => waiters.push(done)), new Promise((done) => setTimeout(done, 300))]);
			}
			throw Error(`No LSP message ${method ?? "response"}: ${JSON.stringify(messages)}`);
		},
		close: () => { input.destroy(); output.destroy(); },
	};
}

describe("LSP proxy", () => {
	it("rejects unsuccessful REST responses", async () => {
		const baseUrl = await mock(() => ({ success: false, errors: [{ errorMessage: "not ready" }] }));
		await expect(new HiseLspRestClient({ baseUrl, timeoutMs: 2000 }).request("status"))
			.rejects.toThrow("not ready");
	});

	it("validates the workspace before advertising capabilities", async () => {
		const baseUrl = await mock(() => ({ project: { projectFolder: resolve("other-project") } }));
		const client = protocol(baseUrl);
		try {
			client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri, capabilities: {} } });
			const result = await client.next();
			expect(result.error).toMatchObject({ message: expect.stringContaining("does not match") });
		} finally { client.close(); }
	});

	it("opens, publishes diagnostics, changes full text, queries, saves and closes without compiling", async () => {
		const calls: Array<{ route: string; body: Record<string, unknown> }> = [];
		const baseUrl = await mock((route, body) => {
			calls.push({ route, body });
			if (route === "/api/status") return { project: { projectFolder: root } };
			if (route === "/api/lsp/document/open") return { uri, version: 1, epoch: 3, documentKind: "included", processors: ["MainInterface"], diagnosticsByUri: [{ uri, processors: [{ moduleId: "MainInterface", diagnostics: [] }] }] };
			if (route === "/api/lsp/document/change") return { uri, version: body.version, diagnosticsByUri: [{ uri, processors: [{ moduleId: "MainInterface", diagnostics: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, severity: 1, message: "oops" }] }] }] };
			if (route === "/api/lsp/completion") return { items: [{ label: "Content", kind: 6 }], isIncomplete: false };
			return {};
		});
		const client = protocol(baseUrl);
		try {
			client.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { processId: null, rootUri, capabilities: {} } });
			const initialized = await client.next();
			expect(initialized.result).toMatchObject({ capabilities: { referencesProvider: true, hoverProvider: true } });
			client.send({ jsonrpc: "2.0", method: "initialized", params: {} });
			client.send({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "javascript", version: 1, text: "a" } } });
			expect((await client.next("textDocument/publishDiagnostics")).params).toMatchObject({ uri, version: 1, diagnostics: [] });
			client.send({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: "ab" }] } });
			expect((await client.next("textDocument/publishDiagnostics")).params).toMatchObject({ uri, version: 2, diagnostics: [{ message: "oops" }] });
			client.send({ jsonrpc: "2.0", id: 2, method: "textDocument/completion", params: { textDocument: { uri }, position: { line: 0, character: 1 } } });
			expect((await client.next()).result).toMatchObject({ items: [{ label: "Content" }] });
			client.send({ jsonrpc: "2.0", method: "textDocument/didSave", params: { textDocument: { uri }, text: "ab" } });
			client.send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
			expect((await client.next("textDocument/publishDiagnostics")).params).toMatchObject({ uri, diagnostics: [] });
			expect(calls.find((call) => call.route === "/api/lsp/document/change")?.body).toMatchObject({ epoch: 3, version: 2, text: "ab" });
			expect(calls.find((call) => call.route === "/api/lsp/document/save")?.body).toMatchObject({ epoch: 3, version: 2 });
			expect(calls.some((call) => call.route === "/api/recompile")).toBe(false);
		} finally { client.close(); }
	});
});
