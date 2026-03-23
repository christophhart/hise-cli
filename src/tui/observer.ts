import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { OBSERVER_ROUTE, type ObserverEvent } from "../observer/protocol.js";

export const OBSERVER_PORT = 1902;

export type { ObserverEvent };

export function startObserverServer(
	onEvent: (event: ObserverEvent) => void,
	port = Number(process.env.HISE_TUI_OBSERVER_PORT || OBSERVER_PORT),
): Server {
	const server = createServer(async (req, res) => {
		if (req.method !== "POST" || req.url !== OBSERVER_ROUTE) {
			respond(res, 404);
			return;
		}

		const body = await readBody(req);
		if (!body) {
			respond(res, 400);
			return;
		}

		try {
			onEvent(JSON.parse(body) as ObserverEvent);
			respond(res, 204);
		} catch {
			respond(res, 400);
		}
	});

	server.on("error", () => {
		// Best-effort only. If the port is unavailable, observer mirroring is disabled.
	});
	server.listen(port, "127.0.0.1");
	return server;
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			data += chunk;
		});
		req.on("end", () => resolve(data));
		req.on("error", reject);
	});
}

function respond(res: ServerResponse, statusCode: number): void {
	res.statusCode = statusCode;
	res.end();
}
