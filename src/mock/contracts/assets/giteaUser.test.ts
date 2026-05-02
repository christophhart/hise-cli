import { describe, expect, it } from "vitest";
import { normalizeGiteaRepos, normalizeGiteaUser } from "./giteaUser.js";

describe("normalizeGiteaUser", () => {
	it("uses email as displayName when present", () => {
		const got = normalizeGiteaUser({
			username: "vendor",
			email: "vendor@example.com",
		});
		expect(got).toEqual({
			username: "vendor",
			email: "vendor@example.com",
			displayName: "vendor@example.com",
		});
	});

	it("falls back to username when email missing", () => {
		const got = normalizeGiteaUser({ username: "vendor" });
		expect(got.displayName).toBe("vendor");
		expect(got.email).toBeNull();
	});

	it("accepts gitea 'login' field as username alias", () => {
		const got = normalizeGiteaUser({ login: "vendor" });
		expect(got.username).toBe("vendor");
	});

	it("rejects missing username/login", () => {
		expect(() => normalizeGiteaUser({}))
			.toThrow(/missing username/);
	});

	it("rejects non-object", () => {
		expect(() => normalizeGiteaUser([])).toThrow();
		expect(() => normalizeGiteaUser(null)).toThrow();
	});
});

describe("normalizeGiteaRepos", () => {
	it("normalizes happy-path repo entry", () => {
		const got = normalizeGiteaRepos([
			{
				url: "https://git.hise.dev/api/v1/repos/v/r",
				name: "r",
				owner: { username: "v" },
			},
		]);
		expect(got).toEqual([{
			name: "r",
			owner: "v",
			url: "https://git.hise.dev/api/v1/repos/v/r",
		}]);
	});

	it("rejects missing owner", () => {
		expect(() => normalizeGiteaRepos([{ name: "r", url: "u" }]))
			.toThrow(/owner/);
	});

	it("rejects non-array root", () => {
		expect(() => normalizeGiteaRepos({})).toThrow(/must be an array/);
	});
});
