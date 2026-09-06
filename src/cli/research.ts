import { homedir } from "node:os";
import { join } from "node:path";
import { runHiseResearch, type HiseResearchProgress } from "./ai-tools.js";
import { HttpHiseConnection } from "../engine/hise.js";
import { RestMcpClient } from "../mcp/restClient.js";

export async function runResearchCommand(argv: string[]): Promise<void> {
	const json = argv.includes("--json") || argv.includes("--agent");
	const query = argv.filter((arg) => arg !== "--json" && arg !== "--agent" && arg !== "--compact").join(" ").trim();
	if (!query) {
		process.stderr.write("-research requires a question\n");
		process.exitCode = 2;
		return;
	}
	const connection = new HttpHiseConnection();
	let projectDir = process.cwd();
	try {
		const status = await connection.get("/api/status") as unknown as { project?: { projectFolder?: string } };
		if (status.project?.projectFolder) projectDir = status.project.projectFolder;
		const markdown = await runHiseResearch(query, {
			connection,
			mcpClient: new RestMcpClient({ defaultUrl: process.env.HISE_DOCS_API_URL ?? process.env.HISE_MCP_URL }),
			cwd: projectDir,
			agentDir: join(homedir(), ".hise", "agent"),
			onProgress: json ? undefined : renderResearchProgress,
		});
		process.stdout.write(json ? `${JSON.stringify({ ok: true, value: { markdown, stats: extractResearchStats(markdown) } })}\n` : `${markdown}\n`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stdout.write(json ? `${JSON.stringify({ ok: false, code: "execution_error", error: message })}\n` : "");
		if (!json) process.stderr.write(`${message}\n`);
		process.exitCode = 1;
	} finally {
		connection.destroy();
	}
}

export function extractResearchStats(markdown: string): Record<string, unknown> {
	const modelLine = markdown.match(/^Research model: (.+)$/m)?.[1];
	const modelMatch = modelLine?.match(/^(.*) \(([^()]*)\)$/);
	const usage = markdown.match(/^Research usage: ([\d.]+k?) input · ([\d.]+k?) output · ([\d.]+k?) total tokens$/m);
	const validation = markdown.match(/^Script validation: (.+)$/m)?.[1];
	return {
		model: modelMatch?.[1] ?? modelLine,
		reasoningLevel: modelMatch?.[2],
		inputTokens: parseTokenCount(usage?.[1]),
		outputTokens: parseTokenCount(usage?.[2]),
		totalTokens: parseTokenCount(usage?.[3]),
		validation,
	};
}

function parseTokenCount(value: string | undefined): number | undefined {
	if (!value) return undefined;
	return Math.round(Number.parseFloat(value) * (value.endsWith("k") ? 1000 : 1));
}

function renderResearchProgress(progress: HiseResearchProgress): void {
	if (progress.type === "start" || progress.type === "diagnostics") return;
	const marker = progress.ok === false ? "x" : "ok";
	const detail = progress.detail ? ` - ${progress.detail}` : "";
	const elapsed = ((progress.elapsedMs ?? 0) / 1000).toFixed(1);
	process.stderr.write(`[${marker}] ${progress.label}${detail} (${elapsed}s)\n`);
}
