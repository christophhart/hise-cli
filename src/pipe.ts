import * as fs from "node:fs";
import * as net from "node:net";

export const PIPE_PREFIX = "hise-repl";

export interface ReplResponse {
	success?: boolean;
	result?: Record<string, unknown>;
	error?: string;
	message?: string;
	progress?: boolean | number;
}

export type OutputLineType = "command" | "result" | "error" | "info";

export interface OutputLine {
	id: number;
	type: OutputLineType;
	text: string;
	timestamp: number;
}

export interface ParsedPipeMessage {
	raw: string;
	payload: ReplResponse | null;
}

type MessageHandler = (message: ParsedPipeMessage) => void;
type CloseHandler = () => void;
type ErrorHandler = (error: Error) => void;

export function isFinalResponse(message: ReplResponse): boolean {
	return "success" in message;
}

export function isProgressMessage(message: ReplResponse): boolean {
	return "progress" in message && !("success" in message);
}

export const SIMPLE_COMMANDS = new Set([
	"status",
	"project.info",
	"quit",
	"shutdown",
	"spin",
]);

export function parseInput(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.startsWith("{")) {
		try {
			JSON.parse(trimmed);
			return trimmed;
		} catch {
			return null;
		}
	}

	const parts = trimmed.split(/\s+/);
	const command = parts[0].toLowerCase();

	if (SIMPLE_COMMANDS.has(command)) {
		return JSON.stringify({ cmd: command });
	}

	return JSON.stringify({ cmd: command });
}

export function getPipePath(name: string): string {
	if (process.platform === "win32") {
		return `\\\\.\\pipe\\${name}`;
	}

	return `/tmp/${name}`;
}

export function discoverPipes(): string[] {
	const pipes: string[] = [];

	if (process.platform === "win32") {
		try {
			const entries = fs.readdirSync("\\\\.\\pipe\\");
			for (const entry of entries) {
				if (entry.startsWith(PIPE_PREFIX)) {
					pipes.push(entry);
				}
			}
		} catch {
			// Not fatal.
		}
	} else {
		try {
			const entries = fs.readdirSync("/tmp");
			const seen = new Set<string>();
			for (const entry of entries) {
				const match = entry.match(/^(hise-repl[^_]*)_(?:in|out)$/);
				if (!match || seen.has(match[1])) {
					continue;
				}

				seen.add(match[1]);
				pipes.push(match[1]);
			}
		} catch {
			// Not fatal.
		}
	}

	return pipes;
}

function stringifyValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}

	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		value === undefined
	) {
		return String(value);
	}

	return JSON.stringify(value);
}

export function responseToOutputLines(
	response: ReplResponse,
	nextId: () => number
): OutputLine[] {
	if (!response.success) {
		return [
			{
				id: nextId(),
				type: "error",
				text: `Error: ${response.error || "Unknown error"}`,
				timestamp: Date.now(),
			},
		];
	}

	if (response.message) {
		return [
			{
				id: nextId(),
				type: "info",
				text: response.message,
				timestamp: Date.now(),
			},
		];
	}

	if (response.result && typeof response.result === "object") {
		const entries = Object.entries(response.result);
		if (entries.length === 0) {
			return [
				{
					id: nextId(),
					type: "result",
					text: "{}",
					timestamp: Date.now(),
				},
			];
		}

		return entries.map(([key, value]) => ({
			id: nextId(),
			type: "result" as const,
			text: `${key}: ${stringifyValue(value)}`,
			timestamp: Date.now(),
		}));
	}

	return [
		{
			id: nextId(),
			type: "info",
			text: JSON.stringify(response),
			timestamp: Date.now(),
		},
	];
}

export class PipeConnection {
	private readonly messageHandlers = new Set<MessageHandler>();
	private readonly closeHandlers = new Set<CloseHandler>();
	private readonly errorHandlers = new Set<ErrorHandler>();
	private recvBuffer = "";

	constructor(private readonly socket: net.Socket) {
		this.socket.on("data", this.handleData);
		this.socket.on("close", this.handleClose);
		this.socket.on("error", this.handleError);
	}

	private handleData = (data: Buffer): void => {
		this.recvBuffer += data.toString("utf-8");

		let newlineIndex = this.recvBuffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = this.recvBuffer.slice(0, newlineIndex).trim();
			this.recvBuffer = this.recvBuffer.slice(newlineIndex + 1);
			newlineIndex = this.recvBuffer.indexOf("\n");

			if (!line) {
				continue;
			}

			let payload: ReplResponse | null = null;
			try {
				payload = JSON.parse(line) as ReplResponse;
			} catch {
				payload = null;
			}

			for (const handler of this.messageHandlers) {
				handler({ raw: line, payload });
			}
		}
	};

	private handleClose = (): void => {
		for (const handler of this.closeHandlers) {
			handler();
		}
	};

	private handleError = (error: Error): void => {
		for (const handler of this.errorHandlers) {
			handler(error);
		}
	};

	send(json: string): void {
		this.socket.write(`${json}\n`, "utf-8");
	}

	onMessage(handler: MessageHandler): () => void {
		this.messageHandlers.add(handler);
		return () => {
			this.messageHandlers.delete(handler);
		};
	}

	onClose(handler: CloseHandler): () => void {
		this.closeHandlers.add(handler);
		return () => {
			this.closeHandlers.delete(handler);
		};
	}

	onError(handler: ErrorHandler): () => void {
		this.errorHandlers.add(handler);
		return () => {
			this.errorHandlers.delete(handler);
		};
	}

	destroy(): void {
		this.socket.destroy();
	}
}

export function connect(pipeName: string): Promise<PipeConnection> {
	return new Promise((resolve, reject) => {
		const path = getPipePath(pipeName);
		const socket = net.connect({ path }, () => {
			resolve(new PipeConnection(socket));
		});

		socket.once("error", (error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT" || error.code === "ECONNREFUSED") {
				reject(new Error(`No HISE instance found on pipe '${pipeName}'`));
				return;
			}

			reject(error);
		});
	});
}
