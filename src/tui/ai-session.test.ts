import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { removeAiModelConfig, TuiAiSession } from "./ai-session.js";

function createAdapter(): TuiAiSession {
	return new TuiAiSession({
		connection: {} as never,
		dataLoader: {} as never,
		projectDir: "/project",
		onEvent: () => {},
	});
}

describe("TuiAiSession model settings", () => {
	it("includes the reasoning level in the display label", () => {
		const adapter = createAdapter();
		const fakeSession = { model: { provider: "openrouter", id: "model" }, thinkingLevel: "high" };
		(adapter as unknown as { piSession: typeof fakeSession }).piSession = fakeSession;
		expect(adapter.modelLabel).toBe("openrouter/model");
		expect(adapter.modelDisplayLabel).toBe("openrouter/model (high)");
	});

	it("awaits model selection before persisting reasoning", async () => {
		const adapter = createAdapter();
		const model = { provider: "openai", id: "reasoning" };
		const calls: string[] = [];
		const flush = vi.fn(async () => { calls.push("flush"); });
		const fakeSession = {
			model: undefined as typeof model | undefined,
			modelRuntime: {
				getModel: () => model,
			},
			setModel: vi.fn(async (_model: typeof model, options: { persist?: boolean }) => {
				await Promise.resolve();
				fakeSession.model = model;
				calls.push(`model:${String(options.persist)}`);
			}),
			setThinkingLevel: vi.fn((_level: string, options: { persist?: boolean }) => {
				expect(fakeSession.model).toBe(model);
				calls.push(`thinking:${String(options.persist)}`);
			}),
			settingsManager: { flush, drainErrors: () => [] },
		};
		(adapter as unknown as { piSession: typeof fakeSession }).piSession = fakeSession;

		await adapter.selectModel("openai/reasoning", "high");

		expect(calls).toEqual(["model:true", "thinking:true", "flush"]);
	});

	it("removes model state while preserving unrelated settings", async () => {
		const root = await mkdtemp(join(tmpdir(), "hise-ai-nuke-"));
		await mkdir(root, { recursive: true });
		await Promise.all([
			writeFile(join(root, "auth.json"), "{}"),
			writeFile(join(root, "models.json"), "{}"),
			writeFile(join(root, "models-store.json"), "{}"),
			writeFile(join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "gpt", defaultThinkingLevel: "high", theme: "dark" })),
		]);

		await removeAiModelConfig(root);

		await expect(readFile(join(root, "auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(root, "models.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(root, "models-store.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect(JSON.parse(await readFile(join(root, "settings.json"), "utf8"))).toEqual({ theme: "dark" });
	});

	it("returns the refreshed model snapshot", async () => {
		const adapter = createAdapter();
		let models = [{ provider: "openai", id: "old" }];
		const refresh = vi.fn(async () => {
			models = [{ provider: "openai", id: "new" }];
			return { aborted: false, errors: new Map() };
		});
		const fakeSession = {
			modelRuntime: {
				refresh,
				getAvailableSnapshot: () => models,
			},
		};
		(adapter as unknown as { piSession: typeof fakeSession }).piSession = fakeSession;

		await expect(adapter.refreshModels()).resolves.toEqual(["openai/new"]);
		expect(refresh).toHaveBeenCalledWith({ allowNetwork: true });
	});
});
