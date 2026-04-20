import { describe, expect, it, vi } from "vitest";
import { WizardExecutor } from "./executor.js";
import { WizardHandlerRegistry } from "./handler-registry.js";
import { MockHiseConnection } from "../hise.js";
import type { WizardDefinition, WizardProgress } from "./types.js";

function minimalDef(overrides: Partial<WizardDefinition> = {}): WizardDefinition {
	return {
		id: "test",
		header: "Test Wizard",
		tabs: [],
		tasks: [],
		postActions: [],
		globalDefaults: {},
		...overrides,
	};
}

describe("WizardExecutor", () => {
	describe("initialize", () => {
		it("returns empty object when no init defined", async () => {
			const executor = new WizardExecutor({ connection: null, handlerRegistry: null });
			const result = await executor.initialize(minimalDef());
			expect(result).toEqual({});
		});

		it("calls internal init handler", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerInit("detect", async (wizardId) => ({
				platform: "macOS",
				wizardId,
			}));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({ init: { type: "internal", function: "detect" } });
			const result = await executor.initialize(def);
			expect(result).toEqual({ platform: "macOS", wizardId: "test" });
		});

		it("calls http init via GET /api/wizard/initialise", async () => {
			const conn = new MockHiseConnection();
			conn.onGet("/api/wizard/initialise", () => ({
				success: true,
				result: { defaultPath: "/home/user/HISE" },
				logs: [],
				errors: [],
			}));
			const executor = new WizardExecutor({ connection: conn, handlerRegistry: null });
			const def = minimalDef({ init: { type: "http", function: "initialise" } });
			const result = await executor.initialize(def);
			expect(result).toEqual({ defaultPath: "/home/user/HISE" });
		});

		it("returns empty on internal init handler missing", async () => {
			const registry = new WizardHandlerRegistry();
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({ init: { type: "internal", function: "missing" } });
			const result = await executor.initialize(def);
			expect(result).toEqual({});
		});

		it("returns empty on http init with no connection", async () => {
			const executor = new WizardExecutor({ connection: null, handlerRegistry: null });
			const def = minimalDef({ init: { type: "http", function: "initialise" } });
			const result = await executor.initialize(def);
			expect(result).toEqual({});
		});
	});

	describe("execute", () => {
		it("succeeds with zero tasks", async () => {
			const executor = new WizardExecutor({ connection: null, handlerRegistry: null });
			const result = await executor.execute(minimalDef(), {});
			expect(result.success).toBe(true);
		});

		it("executes internal tasks via handler registry", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("doStuff", async (answers) => ({
				success: true,
				message: `Did stuff with ${answers.name}`,
			}));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "doStuff", type: "internal" }],
			});
			const result = await executor.execute(def, { name: "test" });
			expect(result.success).toBe(true);
			expect(result.message).toContain("completed successfully");
		});

		it("executes http tasks via HISE connection", async () => {
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: "compiled",
				logs: ["log1"],
				errors: [],
			}));
			const executor = new WizardExecutor({ connection: conn, handlerRegistry: null });
			const def = minimalDef({
				tasks: [{ id: "compile", function: "compileTask", type: "http" }],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(true);
			expect(result.logs).toEqual(["log1"]);
		});

		it("fails when http task has no connection", async () => {
			const executor = new WizardExecutor({ connection: null, handlerRegistry: null });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "fn", type: "http" }],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(false);
			expect(result.message).toContain("No HISE connection");
		});

		it("fails when internal task handler is missing", async () => {
			const registry = new WizardHandlerRegistry();
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "missing", type: "internal" }],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(false);
			expect(result.message).toContain("No handler registered");
		});

		it("halts on first failing task", async () => {
			const registry = new WizardHandlerRegistry();
			const calls: string[] = [];
			registry.registerTask("fail", async () => {
				calls.push("fail");
				return { success: false, message: "boom" };
			});
			registry.registerTask("second", async () => {
				calls.push("second");
				return { success: true, message: "ok" };
			});
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "fail", type: "internal" },
					{ id: "t2", function: "second", type: "internal" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(false);
			expect(calls).toEqual(["fail"]);
		});

		it("executes mixed task types sequentially", async () => {
			const registry = new WizardHandlerRegistry();
			const order: string[] = [];
			registry.registerTask("internal1", async () => {
				order.push("internal");
				return { success: true, message: "ok" };
			});
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => {
				order.push("http");
				return { success: true, result: "done", logs: [], errors: [] };
			});
			const executor = new WizardExecutor({ connection: conn, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "internal1", type: "internal" },
					{ id: "t2", function: "httpTask", type: "http" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(true);
			expect(order).toEqual(["internal", "http"]);
		});

		it("reports progress with scaled percentages", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("t1", async (_answers, onProgress) => {
				onProgress({ phase: "t1", percent: 50, message: "halfway" });
				return { success: true, message: "ok" };
			});
			registry.registerTask("t2", async (_answers, onProgress) => {
				onProgress({ phase: "t2", percent: 100, message: "done" });
				return { success: true, message: "ok" };
			});
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "t1", type: "internal" },
					{ id: "t2", function: "t2", type: "internal" },
				],
			});
			const progress: WizardProgress[] = [];
			await executor.execute(def, {}, (p) => progress.push(p));
			// t1 at 50% → scaled to 25% (first half), t2 at 100% → scaled to 100%
			// Filter to only task-emitted progress (has a non-heading message)
			const taskProgress = progress.filter((p) =>
				(p.phase === "t1" || p.phase === "t2") && p.message && !p.message.startsWith("__heading__"),
			);
			expect(taskProgress[0]!.percent).toBe(25);
			expect(taskProgress[1]!.percent).toBe(100);
		});

		it("collects logs from all tasks", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("t1", async () => ({
				success: true,
				message: "ok",
				logs: ["log1"],
			}));
			registry.registerTask("t2", async () => ({
				success: true,
				message: "ok",
				logs: ["log2", "log3"],
			}));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "t1", type: "internal" },
					{ id: "t2", function: "t2", type: "internal" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.logs).toEqual(["log1", "log2", "log3"]);
		});

		it("returns nextTaskIndex on failure so /resume can pick up", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("ok", async () => ({ success: true, message: "ok" }));
			registry.registerTask("boom", async () => ({ success: false, message: "boom" }));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "ok", type: "internal" },
					{ id: "t2", function: "boom", type: "internal" },
					{ id: "t3", function: "ok", type: "internal" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(false);
			expect(result.nextTaskIndex).toBe(1);
		});

		it("omits nextTaskIndex when every task succeeds", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("ok", async () => ({ success: true, message: "ok" }));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "ok", type: "internal" }],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(true);
			expect(result.nextTaskIndex).toBeUndefined();
		});

		it("startIndex skips earlier tasks when resuming", async () => {
			const registry = new WizardHandlerRegistry();
			const calls: string[] = [];
			registry.registerTask("one", async () => {
				calls.push("one");
				return { success: true, message: "ok" };
			});
			registry.registerTask("two", async () => {
				calls.push("two");
				return { success: true, message: "ok" };
			});
			registry.registerTask("three", async () => {
				calls.push("three");
				return { success: true, message: "ok" };
			});
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "one", type: "internal" },
					{ id: "t2", function: "two", type: "internal" },
					{ id: "t3", function: "three", type: "internal" },
				],
			});
			const result = await executor.execute(def, {}, undefined, { startIndex: 1 });
			expect(result.success).toBe(true);
			expect(calls).toEqual(["two", "three"]);
		});

		it("startIndex=0 behaves like a normal run", async () => {
			const registry = new WizardHandlerRegistry();
			const calls: string[] = [];
			registry.registerTask("one", async () => {
				calls.push("one");
				return { success: true, message: "ok" };
			});
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "one", type: "internal" }],
			});
			await executor.execute(def, {}, undefined, { startIndex: 0 });
			expect(calls).toEqual(["one"]);
		});

		it("emits 'Resuming' starting message when startIndex > 0", async () => {
			const registry = new WizardHandlerRegistry();
			registry.registerTask("ok", async () => ({ success: true, message: "ok" }));
			const executor = new WizardExecutor({ connection: null, handlerRegistry: registry });
			const def = minimalDef({
				header: "Demo",
				tasks: [
					{ id: "t1", function: "ok", type: "internal" },
					{ id: "t2", function: "ok", type: "internal" },
				],
			});
			const progress: WizardProgress[] = [];
			await executor.execute(def, {}, (p) => progress.push(p), { startIndex: 1 });
			const starting = progress.find((p) => p.phase === "Starting");
			expect(starting?.message).toContain("Resuming Demo");
		});
	});

	describe("async job polling", () => {
		it("handles async job response with polling", async () => {
			let pollCount = 0;
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: { jobId: "j1", async: true },
				logs: [],
				errors: [],
			}));
			conn.onGet("/api/wizard/status", () => {
				pollCount++;
				if (pollCount < 2) {
					return {
						success: true,
						result: { finished: false, progress: 0.5, message: "Working..." },
						logs: [],
						errors: [],
					};
				}
				return {
					success: true,
					result: { finished: true, progress: 1.0, message: "Done" },
					logs: ["completed"],
					errors: [],
				};
			});

			const executor = new WizardExecutor({ connection: conn, handlerRegistry: null });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "asyncFn", type: "http" }],
			});
			const progress: WizardProgress[] = [];
			const result = await executor.execute(def, {}, (p) => progress.push(p));
			expect(result.success).toBe(true);
			expect(result.message).toContain("completed successfully");
			expect(result.logs).toEqual(["completed"]);
			// Should have received progress updates from polling
			const pollProgress = progress.filter((p) => p.message === "Working...");
			expect(pollProgress.length).toBeGreaterThanOrEqual(1);
		});

		it("handles async job failure", async () => {
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: { jobId: "j2", async: true },
				logs: [],
				errors: [],
			}));
			conn.onGet("/api/wizard/status", () => ({
				success: false,
				result: { finished: true, progress: 0.6, message: "Engine error" },
				logs: ["partial log"],
				errors: [{ errorMessage: "Buffer underrun", callstack: [] }],
			}));

			const executor = new WizardExecutor({ connection: conn, handlerRegistry: null });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "asyncFn", type: "http" }],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(false);
			expect(result.message).toContain("Buffer underrun");
		});

		it("cancels async polling on abort", async () => {
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: { jobId: "j3", async: true },
				logs: [],
				errors: [],
			}));
			conn.onGet("/api/wizard/status", () => ({
				success: true,
				result: { finished: false, progress: 0.1, message: "Still going" },
				logs: [],
				errors: [],
			}));

			const controller = new AbortController();
			const executor = new WizardExecutor({ connection: conn, handlerRegistry: null });
			const def = minimalDef({
				tasks: [{ id: "t1", function: "asyncFn", type: "http" }],
			});

			// Abort after a short delay
			setTimeout(() => controller.abort(), 600);
			const result = await executor.execute(def, {}, undefined, { signal: controller.signal });
			expect(result.success).toBe(false);
			expect(result.message).toBe("Cancelled.");
		});
	});

	describe("prepare-only + inter-task data", () => {
		it("passes prepare result data to subsequent internal task", async () => {
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: {
					buildScript: "/path/to/build.sh",
					buildDirectory: "/path/to/Binaries",
					configuration: "Release",
					projectFile: "/path/to/project.jucer",
				},
				logs: ["Generated build files"],
				errors: [],
			}));

			const receivedContext: Record<string, string>[] = [];
			const registry = new WizardHandlerRegistry();
			registry.registerTask("compileProject", async (_answers, _onProgress, _signal, context) => {
				receivedContext.push(context ?? {});
				return { success: true, message: "compiled" };
			});

			const executor = new WizardExecutor({ connection: conn, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "prepare", function: "prepareExport", type: "http" },
					{ id: "compile", function: "compileProject", type: "internal" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(true);
			expect(receivedContext).toHaveLength(1);
			expect(receivedContext[0]).toEqual({
				buildScript: "/path/to/build.sh",
				buildDirectory: "/path/to/Binaries",
				configuration: "Release",
				projectFile: "/path/to/project.jucer",
			});
		});

		it("forwards data across multiple tasks", async () => {
			const conn = new MockHiseConnection();
			conn.onPost("/api/wizard/execute", () => ({
				success: true,
				result: {
					buildScript: "/build.sh",
					buildDirectory: "/bin",
				},
				logs: [],
				errors: [],
			}));

			const registry = new WizardHandlerRegistry();
			registry.registerTask("internal1", async (_answers, _onProgress, _signal, context) => ({
				success: true,
				message: "ok",
				data: { ...context, extra: "value" },
			}));

			let finalContext: Record<string, string> = {};
			registry.registerTask("internal2", async (_answers, _onProgress, _signal, context) => {
				finalContext = context ?? {};
				return { success: true, message: "done" };
			});

			const executor = new WizardExecutor({ connection: conn, handlerRegistry: registry });
			const def = minimalDef({
				tasks: [
					{ id: "t1", function: "httpPrepare", type: "http" },
					{ id: "t2", function: "internal1", type: "internal" },
					{ id: "t3", function: "internal2", type: "internal" },
				],
			});
			const result = await executor.execute(def, {});
			expect(result.success).toBe(true);
			expect(finalContext.buildScript).toBe("/build.sh");
			expect(finalContext.extra).toBe("value");
		});
	});
});
