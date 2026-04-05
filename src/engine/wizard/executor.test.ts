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
	});
});
