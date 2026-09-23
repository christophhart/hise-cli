import { homedir } from "node:os";
import { join } from "node:path";
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";

let oauthRegistered = false;

export function createPiModelHost({ cwd = process.cwd(), agentDir = process.env.HISE_RESEARCH_AGENT_DIR || join(homedir(), ".hise", "agent") } = {}) {
	return {
		async checkReady() {
			const adapter = await this.beginRequest();
			return adapter.describe();
		},
		async beginRequest() {
			registerOauth();
			const settingsManager = SettingsManager.create(cwd, agentDir);
			const settings = settingsManager.getGlobalSettings();
			const modelRuntime = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				modelsStorePath: join(agentDir, "models-store.json"),
				refreshOnCreate: false,
			});
			// Match hise-cli's model picker: refresh configured provider catalogues,
			// then fall back to the cached catalogue if the network is unavailable.
			try { await modelRuntime.refresh({ allowNetwork: true }); } catch { /* cached models remain usable */ }
			const provider = typeof settings.defaultProvider === "string" ? settings.defaultProvider : "";
			const thinkerId = typeof settings.defaultModel === "string" ? settings.defaultModel : "";
			const thinker = provider && thinkerId ? modelRuntime.getModel(provider, thinkerId) : undefined;
			if (!thinker) throw new Error("No thinker model is configured. Select thinker and worker models with hise-cli /ai, then authenticate with /login.");
			const workerRef = typeof settings.workerModel === "string" ? settings.workerModel : `${provider}/${thinkerId}`;
			const slash = workerRef.indexOf("/");
			const worker = slash > 0 ? modelRuntime.getModel(workerRef.slice(0, slash), workerRef.slice(slash + 1)) : undefined;
			if (!worker) throw new Error(`The configured worker model \"${workerRef}\" is unavailable. Select it again with hise-cli /ai.`);
			const thinkingLevel = typeof settings.defaultThinkingLevel === "string" ? settings.defaultThinkingLevel : "off";
			return new PiRequestModelAdapter({ cwd, agentDir, settingsManager, modelRuntime, thinker, worker, thinkingLevel });
		},
	};
}

class PiRequestModelAdapter {
	constructor(options) {
		Object.assign(this, options);
	}

	describe() {
		return {
			thinker: `${this.thinker.provider}/${this.thinker.id}`,
			worker: `${this.worker.provider}/${this.worker.id}`,
			thinkingLevel: this.thinkingLevel,
		};
	}

	async complete(role, { system, prompt, signal, onDelta }) {
		const model = role === "worker" ? this.worker : this.thinker;
		const loader = new DefaultResourceLoader({
			cwd: this.cwd,
			agentDir: this.agentDir,
			settingsManager: this.settingsManager,
			systemPromptOverride: () => system,
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd: this.cwd,
			agentDir: this.agentDir,
			modelRuntime: this.modelRuntime,
			model,
			thinkingLevel: this.thinkingLevel,
			settingsManager: this.settingsManager,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(this.cwd),
			noTools: "all",
			tools: [],
			customTools: [],
		});
		let text = "";
		const unsubscribe = session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
				text += event.assistantMessageEvent.delta;
				onDelta?.(event.assistantMessageEvent.delta);
			}
		});
		const abort = () => { void session.abort(); };
		signal?.addEventListener("abort", abort, { once: true });
		try {
			if (!session.model || session.model.provider === "unknown") throw new Error(`The ${role} model is unavailable or unauthenticated. Configure it with hise-cli /ai and /login.`);
			await session.prompt(prompt);
			if (!text) text = assistantText(session.messages);
			const stats = session.getSessionStats();
			return {
				text,
				model: `${model.provider}/${model.id}`,
				thinkingLevel: session.thinkingLevel,
				usage: {
					input: stats.tokens.input,
					output: stats.tokens.output,
					cacheRead: stats.tokens.cacheRead,
					total: stats.tokens.total,
					cost: stats.cost,
				},
			};
		} finally {
			signal?.removeEventListener("abort", abort);
			unsubscribe();
			await session.dispose();
		}
	}
}

function registerOauth() {
	if (oauthRegistered) return;
	registerBunOAuthFlows();
	oauthRegistered = true;
}

function assistantText(messages) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		const text = message.content.filter((part) => part?.type === "text").map((part) => part.text).join("\n");
		if (text) return text;
	}
	return "";
}
