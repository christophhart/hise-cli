import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { startDap } from "../dap/server.js";
import { DapRestClient } from "../dap/rest.js";

const baseUrl = "http://127.0.0.1:1900";

/** Non-mutating live DAP parity: no fixture installation, compilation or breakpoint edits. */
describe("DAP live contract", () => {
	it("initializes, attaches, snapshots, negotiates a thread and releases its controller", async () => {
		const rest = new DapRestClient({ baseUrl, timeoutMs: 3000 });
		const status = await rest.request<{ project: { projectFolder: string }; scriptProcessors: Array<{ moduleId: string }> }>("status");
		const moduleId = status.scriptProcessors?.[0]?.moduleId;
		if (!moduleId) throw Error("Live DAP contract requires a script processor");
		const input = new PassThrough(), output = new PassThrough();
		startDap({ baseUrl, timeoutMs: 3000, pollMs: 75, logLevel: "quiet" }, input, output);
		let buffer = Buffer.alloc(0), seq = 0;
		const received: Array<Record<string, unknown>> = [];
		const waiters: Array<() => void> = [];
		output.on("data", (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			while (true) {
				const header = buffer.indexOf("\r\n\r\n");
				if (header < 0) return;
				const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, header).toString())?.[1]);
				if (!length || buffer.length < header + 4 + length) return;
				received.push(JSON.parse(buffer.subarray(header + 4, header + 4 + length).toString()) as Record<string, unknown>);
				buffer = buffer.subarray(header + 4 + length);
				for (const waiter of waiters.splice(0)) waiter();
			}
		});
		const send = (command: string, args: object = {}): number => {
			const id = ++seq;
			const body = Buffer.from(JSON.stringify({ seq: id, type: "request", command, arguments: args }));
			input.write(`Content-Length: ${body.length}\r\n\r\n`);
			input.write(body);
			return id;
		};
		const next = async (predicate: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> => {
			const deadline = Date.now() + 6000;
			while (Date.now() < deadline) {
				const index = received.findIndex(predicate);
				if (index >= 0) return received.splice(index, 1)[0];
				await Promise.race([new Promise<void>((done) => waiters.push(done)), new Promise((done) => setTimeout(done, 50))]);
			}
			throw Error(`Timed out waiting for DAP response: ${JSON.stringify(received)}`);
		};
		const response = (id: number) => (message: Record<string, unknown>): boolean => message.type === "response" && message.request_seq === id;
		try {
			expect((await next(response(send("initialize")))).success).toBe(true);
			expect((await next(response(send("attach", { moduleId, projectFolder: status.project.projectFolder })))).success).toBe(true);
			expect((await next((message) => message.event === "initialized")).event).toBe("initialized");
			expect((await next(response(send("configurationDone")))).success).toBe(true);
			expect((await next(response(send("threads")))).body).toMatchObject({ threads: [{ id: 1, name: "HISE Script Execution" }] });
			expect((await next(response(send("disconnect")))).success).toBe(true);
			expect((await next((message) => message.event === "terminated")).event).toBe("terminated");
		} finally {
			input.destroy(); output.destroy();
		}
	});
});
