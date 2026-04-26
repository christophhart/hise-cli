// ── HTTP request handler — token check + static asset serving ───────

import { embeddedAssets } from "./embedded-assets.js";

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

export function createRestHandler() {
	return async function fetch(req: Request): Promise<Response | undefined> {
		const url = new URL(req.url);
		const path = url.pathname === "/" ? "/index.html" : url.pathname;
		const data = embeddedAssets.get(path);
		if (!data) {
			return new Response("Not Found", { status: 404 });
		}
		return new Response(data as BodyInit, {
			headers: {
				"Content-Type": contentTypeFor(path),
				"Cache-Control": "no-cache",
				"X-Content-Type-Options": "nosniff",
			},
		});
	};
}
