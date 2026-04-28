// ── Analyse mode — audio waveform & spectrogram inspection ──────────

import type { CommandResult, TreeNode } from "../result.js";
import { errorResult, textResult, markdownResult, preformattedResult } from "../result.js";
import type { CompletionResult, Mode, SessionContext } from "./mode.js";
import { MODE_ACCENTS } from "./mode.js";
import type { CompletionEngine } from "../completion/engine.js";
import { parseWav, type WavData } from "../audio/wav.js";
import { renderWaveformBraille, renderWaveformBlocks } from "../audio/waveform.js";
import { renderSpectrogramBraille, renderSpectrogramShades } from "../audio/spectrogram.js";
import { frameWaveform, frameSpectrogram, type FrameInfo } from "../audio/frame.js";

// ── Settings ────────────────────────────────────────────────────────

interface AnalyseSettings {
	cols: number;
	rows: number;
	mode: "human" | "llm";
	gamma: number;
	range: number;
}

const DEFAULT_SETTINGS: AnalyseSettings = {
	cols: 60,
	rows: 6,
	mode: "human",
	gamma: 1.8,
	range: 60,
};

// ── Command parsing ─────────────────────────────────────────────────

interface ParsedCommand {
	verb: string;
	file: string;
	outputFile: string | null;
	inlineSettings: Partial<AnalyseSettings>;
}

function parseCommand(input: string): ParsedCommand | null {
	const trimmed = input.trim();
	const verb = trimmed.split(/\s+/)[0]?.toLowerCase();
	if (!verb || (verb !== "wave" && verb !== "spec")) return null;

	let rest = trimmed.slice(verb.length).trim();

	// Extract "with ..." clause
	const inlineSettings: Partial<AnalyseSettings> = {};
	const withIdx = rest.toLowerCase().indexOf(" with ");
	if (withIdx !== -1) {
		const withClause = rest.slice(withIdx + 6).trim();
		parseSettingsClause(withClause, inlineSettings);
		rest = rest.slice(0, withIdx).trim();
	}

	// Extract "to <file>" clause
	let outputFile: string | null = null;
	const toIdx = rest.toLowerCase().indexOf(" to ");
	if (toIdx !== -1) {
		outputFile = rest.slice(toIdx + 4).trim();
		rest = rest.slice(0, toIdx).trim();
	}

	const file = rest;
	if (!file) return null;

	return { verb, file, outputFile, inlineSettings };
}

function parseSettingsClause(clause: string, target: Partial<AnalyseSettings>): void {
	// Parse comma-separated key-value pairs: "resolution 40x4, mode human, gamma 1.2, range 40db"
	const parts = clause.split(",").map(s => s.trim());
	for (const part of parts) {
		const tokens = part.split(/\s+/);
		const key = tokens[0]?.toLowerCase();
		const value = tokens.slice(1).join(" ");
		applySetting(key, value, target);
	}
}

function applySetting(key: string, value: string, target: Partial<AnalyseSettings>): string | null {
	switch (key) {
		case "resolution": {
			const m = value.match(/^(\d+)x(\d+)$/);
			if (!m) return `Invalid resolution: "${value}". Use WxH (e.g. 60x6).`;
			target.cols = parseInt(m[1], 10);
			target.rows = parseInt(m[2], 10);
			return null;
		}
		case "mode":
			if (value !== "human" && value !== "llm") {
				return `Invalid mode: "${value}". Use "human" or "llm".`;
			}
			target.mode = value;
			return null;
		case "gamma": {
			const g = parseFloat(value);
			if (isNaN(g) || g <= 0) return `Invalid gamma: "${value}".`;
			target.gamma = g;
			return null;
		}
		case "range": {
			const rv = value.toLowerCase().replace("db", "");
			const r = parseFloat(rv);
			if (isNaN(r) || r <= 0) return `Invalid range: "${value}".`;
			target.range = r;
			return null;
		}
		default:
			return `Unknown setting: "${key}".`;
	}
}

// ── Analyse mode class ──────────────────────────────────────────────

const WAV_EXTENSIONS = new Set([".wav", ".wave"]);

export class AnalyseMode implements Mode {
	readonly id: Mode["id"] = "analyse";
	readonly name = "Analyse";
	readonly accent = MODE_ACCENTS.analyse;
	readonly prompt = "[analyse] > ";

	private readonly completionEngine: CompletionEngine | null;
	private currentDir = "";
	private rootDir = "";
	private settings: AnalyseSettings = { ...DEFAULT_SETTINGS };
	private cachedTree: TreeNode | null = null;

	constructor(completionEngine?: CompletionEngine) {
		this.completionEngine = completionEngine ?? null;
	}

	async onEnter(session: SessionContext): Promise<void> {
		// Resolve project folder from projects.xml if not yet set by HISE connection
		if (!session.projectFolder && session.resolveHiseProjectFolder) {
			const folder = await session.resolveHiseProjectFolder();
			if (folder) session.projectFolder = folder;
		}
		// Always reset root to current projectFolder
		const folder = session.projectFolder;
		if (folder) {
			this.rootDir = folder;
			this.currentDir = folder;
		}
		this.cachedTree = null;
	}

	async parse(input: string, session: SessionContext): Promise<CommandResult> {
		// Re-sync root if projectFolder changed after mode entry
		const folder = session.projectFolder;
		if (folder && this.rootDir !== folder) {
			this.rootDir = folder;
			this.currentDir = folder;
			this.cachedTree = null;
		}

		const trimmed = input.trim();
		if (!trimmed) return { type: "empty" };

		const lower = trimmed.toLowerCase();

		// Help
		if (lower === "help") return this.showHelp();

		// cd
		if (lower.startsWith("cd ") || lower === "cd") {
			return this.handleCd(trimmed.slice(2).trim(), session);
		}

		// use
		if (lower.startsWith("use ")) {
			return this.handleUse(trimmed.slice(4).trim());
		}

		// wave / spec
		const cmd = parseCommand(trimmed);
		if (cmd) return this.handleRender(cmd, session);

		return errorResult(`Unknown command: "${trimmed}". Type "help" for available commands.`);
	}

	complete(input: string, _cursor: number): CompletionResult {
		const trimmed = input.trimStart();
		const leadingSpaces = input.length - trimmed.length;
		const lower = trimmed.toLowerCase();

		const commands = ["wave", "spec", "cd", "use", "help"];
		const firstWord = lower.split(/\s+/)[0];

		// Complete command names
		if (!lower.includes(" ")) {
			const items = commands
				.filter(c => c.startsWith(lower))
				.map(c => ({ label: c, detail: c === "wave" ? "Render waveform" : c === "spec" ? "Render spectrogram" : c === "cd" ? "Change directory" : c === "use" ? "Set session defaults" : "Show help" }));
			return { items, from: leadingSpaces, to: input.length, label: "Analyse commands" };
		}

		// Complete settings for "use"
		if (firstWord === "use") {
			const settingKeys = ["resolution", "mode", "gamma", "range"];
			const rest = trimmed.slice(4).trim().toLowerCase();
			const lastComma = rest.lastIndexOf(",");
			const current = lastComma >= 0 ? rest.slice(lastComma + 1).trim() : rest;
			const items = settingKeys
				.filter(k => k.startsWith(current))
				.map(k => ({ label: k }));
			return { items, from: input.length - current.length, to: input.length, label: "Settings" };
		}

		// For wave/spec/cd: no file completion yet (requires async listDirectory)
		return { items: [], from: 0, to: input.length };
	}

	// ── Tree sidebar ────────────────────────────────────────────────

	getTree(): TreeNode | null {
		return this.cachedTree;
	}

	getSelectedPath(): string[] {
		return [];
	}

	selectNode(path: string[]): void {
		// Could auto-render the selected file
	}

	invalidateTree(): void {
		this.cachedTree = null;
	}

	// ── Command handlers ────────────────────────────────────────────

	private handleCd(target: string, session: SessionContext): CommandResult {
		if (!target || target === "/") {
			this.currentDir = this.rootDir;
			this.cachedTree = null;
			return textResult(`/ (${this.rootDir})`);
		}

		if (target === "..") {
			if (this.currentDir === this.rootDir) {
				return session.popMode();
			}
			// Go up one level but not above root
			const sep = this.currentDir.includes("\\") ? "\\" : "/";
			const parts = this.currentDir.split(sep);
			parts.pop();
			const parent = parts.join(sep);
			if (parent.length >= this.rootDir.length) {
				this.currentDir = parent;
			}
			this.cachedTree = null;
			return textResult(this.relativePath());
		}

		// Navigate into subdirectory
		const sep = this.currentDir.includes("\\") ? "\\" : "/";
		this.currentDir = this.currentDir + sep + target;
		this.cachedTree = null;
		return textResult(this.relativePath());
	}

	private handleUse(clause: string): CommandResult {
		const errors: string[] = [];
		parseSettingsClause(clause, this.settings);
		const parts = clause.split(",").map(s => s.trim());
		for (const part of parts) {
			const tokens = part.split(/\s+/);
			const key = tokens[0]?.toLowerCase();
			const value = tokens.slice(1).join(" ");
			const err = applySetting(key, value, this.settings);
			if (err) errors.push(err);
		}
		if (errors.length > 0) return errorResult(errors.join("\n"));

		const s = this.settings;
		return textResult(`Settings: resolution ${s.cols}x${s.rows}, mode ${s.mode}, gamma ${s.gamma}, range ${s.range}db`);
	}

	private async handleRender(cmd: ParsedCommand, session: SessionContext): Promise<CommandResult> {
		if (!session.readBinaryFile) {
			return errorResult("File reading not available in this environment.");
		}

		if (!this.currentDir) {
			return errorResult("No project folder set. Connect to HISE or ensure projects.xml exists.");
		}

		// Resolve file path relative to current directory
		const sep = this.currentDir.includes("\\") ? "\\" : "/";
		const isAbsolute = /^[A-Za-z]:[\\/]|^\//.test(cmd.file);
		const filePath = isAbsolute
			? cmd.file
			: this.currentDir + sep + cmd.file;

		// Read and parse WAV
		let buffer: Uint8Array;
		try {
			buffer = await session.readBinaryFile(filePath);
		} catch (err) {
			return errorResult(`Cannot read file: ${String(err)}`);
		}

		let wav: WavData;
		try {
			wav = parseWav(buffer);
		} catch (err) {
			return errorResult(`Cannot parse WAV: ${String(err)}`);
		}

		// Merge inline settings with session defaults
		const s: AnalyseSettings = { ...this.settings, ...cmd.inlineSettings };

		const info: FrameInfo = {
			fileName: cmd.file,
			sampleRate: wav.sampleRate,
			bitsPerSample: wav.bitsPerSample,
			numChannels: wav.numChannels,
			numFrames: wav.numFrames,
		};

		let output: string;
		if (cmd.verb === "wave") {
			const lines = s.mode === "human"
				? renderWaveformBraille(wav.samples, s.cols, s.rows)
				: renderWaveformBlocks(wav.samples, s.cols, s.rows);
			output = frameWaveform(lines, s.cols, info);
		} else {
			const opts = { gamma: s.gamma, dynamicRange: s.range };
			const lines = s.mode === "human"
				? renderSpectrogramBraille(wav.samples, wav.sampleRate, s.cols, s.rows, opts)
				: renderSpectrogramShades(wav.samples, wav.sampleRate, s.cols, s.rows, opts);
			output = frameSpectrogram(lines, s.cols, info);
		}

		// Write to file if requested
		if (cmd.outputFile && session.writeTextFile) {
			const outIsAbsolute = /^[A-Za-z]:[\\/]|^\//.test(cmd.outputFile);
			const outPath = outIsAbsolute
				? cmd.outputFile
				: this.currentDir + sep + cmd.outputFile;
			try {
				await session.writeTextFile(outPath, output + "\n");
			} catch (err) {
				return errorResult(`Cannot write file: ${String(err)}`);
			}
			return preformattedResult(`Written to ${cmd.outputFile}\n\n${output}`, this.accent);
		}

		return preformattedResult(output, this.accent);
	}

	private showHelp(): CommandResult {
		return markdownResult(`## Analyse Mode

| Command | Description |
|---------|-------------|
| \`wave <file>\` | Render waveform |
| \`spec <file>\` | Render spectrogram |
| \`cd <dir>\` | Navigate folder |
| \`use <settings>\` | Set session defaults |

### Options

\`\`\`
wave test.wav to output.txt          Write to file
wave test.wav with resolution 40x4   Inline settings
wave test.wav with mode llm          LLM-friendly output
\`\`\`

### Session settings

\`\`\`
use resolution 60x6
use mode human, gamma 1.8, range 60db
\`\`\`

### Settings

| Key | Default | Description |
|-----|---------|-------------|
| \`resolution\` | 60x6 | Width x Height in characters |
| \`mode\` | human | \`human\` (braille) or \`llm\` (blocks/shades) |
| \`gamma\` | 1.8 | Spectrogram contrast (higher = more contrast) |
| \`range\` | 60db | Spectrogram dynamic range |`);
	}

	// ── Tree building ───────────────────────────────────────────────

	async buildTree(session: SessionContext): Promise<TreeNode | null> {
		if (!session.listDirectory) return null;

		try {
			return await this.buildTreeNode(session, this.currentDir, ".");
		} catch {
			return null;
		}
	}

	private async buildTreeNode(
		session: SessionContext,
		dir: string,
		label: string,
	): Promise<TreeNode> {
		const entries = await session.listDirectory!(dir);
		const children: TreeNode[] = [];

		for (const entry of entries) {
			if (entry.isDir) {
				children.push({
					label: entry.name,
					id: entry.name,
					nodeKind: "chain",
					children: [], // lazy — populated on expand
				});
			} else if (isWavFile(entry.name)) {
				children.push({
					label: entry.name,
					id: entry.name,
					nodeKind: "module",
				});
			}
		}

		return { label, id: label, children };
	}

	private relativePath(): string {
		if (this.currentDir === this.rootDir) return "/";
		const rel = this.currentDir.slice(this.rootDir.length);
		return rel.replace(/\\/g, "/") || "/";
	}
}

function isWavFile(name: string): boolean {
	const lower = name.toLowerCase();
	return WAV_EXTENSIONS.has(lower.slice(lower.lastIndexOf(".")));
}
