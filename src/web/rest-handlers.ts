// ── HTTP request handler — token check + static asset serving ───────

import { resolve, normalize } from "node:path";

export interface RestHandlerOptions {
	/** Returns the absolute filesystem path of `dist/web/` (the built SPA). */
	assetRoot: string;
}

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".mjs": "application/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".map": "application/json; charset=utf-8",
};

function contentTypeFor(path: string): string {
	const dot = path.lastIndexOf(".");
	if (dot < 0) return "application/octet-stream";
	return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

export function createRestHandler(options: RestHandlerOptions) {
	const root = resolve(options.assetRoot);

	return async function fetch(req: Request): Promise<Response | undefined> {
		const url = new URL(req.url);

		// Static assets bind to 127.0.0.1 only — anyone reaching them is
		// already on this machine. The token gates the WS upgrade in
		// server.ts; that's where session control lives.
		// SPA root → serve index.html
		const path = url.pathname === "/" ? "/index.html" : url.pathname;
		const filePath = normalize(resolve(root, "." + path));

		// Path traversal guard
		if (!filePath.startsWith(root)) {
			return new Response("Forbidden", { status: 403 });
		}

		const file = Bun.file(filePath);
		if (!(await file.exists())) {
			return new Response("Not Found", { status: 404 });
		}

		return new Response(await file.arrayBuffer(), {
			headers: {
				"Content-Type": contentTypeFor(filePath),
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			},
		});
	};
}
