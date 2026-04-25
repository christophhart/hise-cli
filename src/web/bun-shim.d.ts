// ── Minimal Bun ambient typing ──────────────────────────────────────
//
// We avoid pulling @types/bun (large, surface area) and instead declare
// only the APIs the web server uses. Compile-time only — at runtime,
// Bun.serve must exist (the --web command runs under bun build --compile
// or `bun run`, never plain Node).

declare global {
	interface ServerWebSocket<T = unknown> {
		readonly data: T;
		readonly readyState: number;
		send(data: string | ArrayBuffer | Uint8Array): number;
		close(code?: number, reason?: string): void;
		ping(data?: string | Uint8Array): number;
		subscribe(topic: string): void;
		unsubscribe(topic: string): void;
		publish(topic: string, data: string | ArrayBuffer | Uint8Array): number;
	}

	interface BunServerWebSocketHandler<T = unknown> {
		message(ws: ServerWebSocket<T>, message: string | Uint8Array): void | Promise<void>;
		open?(ws: ServerWebSocket<T>): void | Promise<void>;
		close?(ws: ServerWebSocket<T>, code: number, reason: string): void | Promise<void>;
		drain?(ws: ServerWebSocket<T>): void | Promise<void>;
		perMessageDeflate?: boolean;
	}

	interface BunServeOptions<T = unknown> {
		port?: number;
		hostname?: string;
		fetch(this: BunServer, req: Request, server: BunServer): Response | Promise<Response | undefined> | undefined;
		websocket?: BunServerWebSocketHandler<T>;
		error?(error: Error): Response | Promise<Response | undefined> | undefined;
	}

	interface BunServer {
		readonly port: number;
		readonly hostname: string;
		readonly url: URL;
		stop(closeActiveConnections?: boolean): void;
		upgrade<T>(req: Request, options?: { headers?: HeadersInit; data?: T }): boolean;
	}

	interface BunFile {
		readonly size: number;
		readonly type: string;
		text(): Promise<string>;
		arrayBuffer(): Promise<ArrayBuffer>;
		stream(): ReadableStream<Uint8Array>;
		exists(): Promise<boolean>;
	}

	const Bun: {
		serve<T = unknown>(options: BunServeOptions<T>): BunServer;
		file(path: string): BunFile;
		readonly version: string;
	};
}

export {};
