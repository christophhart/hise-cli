import { afterEach, describe, expect, it } from "vitest";
import { launchResearchServer } from "./server.mjs";

let server;
afterEach(async () => {
	if (server) await new Promise((resolve) => server.close(resolve));
	server = undefined;
});

describe("research server", () => {
	it("serves embedded assets on loopback and protects API requests", async () => {
		server = await launchResearchServer({ port: 0, openBrowser: false, silent: true });
		const address = server.address();
		const baseUrl = `http://127.0.0.1:${address.port}`;
		const page = await fetch(baseUrl);
		expect(page.status).toBe(200);
		const policy = page.headers.get("content-security-policy");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).not.toContain("unsafe-inline");
		const html = await page.text();
		expect(html).toContain("HISE Research Assistant");
		expect(html).toContain(".token-keyword{color:#bbbbff}");

		const rejected = await fetch(`${baseUrl}/api/research`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ question: "test" }),
		});
		expect(rejected.status).toBe(403);

		const config = await fetch(`${baseUrl}/api/config`).then((response) => response.json());
		expect(config.requestToken).toEqual(expect.any(String));
	});
});
