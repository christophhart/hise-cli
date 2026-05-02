import { describe, expect, it } from "vitest";
import { normalizeGiteaTags } from "./giteaTag.js";

describe("normalizeGiteaTags", () => {
	it("normalizes a happy-path tag", () => {
		const got = normalizeGiteaTags([
			{
				name: "1.2.0",
				commit: { sha: "abc123def", created: "2026-01-15T11:22:33Z" },
				zipball_url: "https://git.hise.dev/v/r/archive/1.2.0.zip",
			},
		]);
		expect(got).toEqual([{
			name: "1.2.0",
			commitSha: "abc123def",
			commitCreated: "2026-01-15T11:22:33Z",
			zipballUrl: "https://git.hise.dev/v/r/archive/1.2.0.zip",
		}]);
	});

	it("rejects missing commit", () => {
		expect(() => normalizeGiteaTags([{ name: "x", zipball_url: "u" }]))
			.toThrow(/tag\.commit/);
	});

	it("rejects non-array root", () => {
		expect(() => normalizeGiteaTags({})).toThrow(/must be an array/);
	});

	it("includes index in error path", () => {
		expect(() => normalizeGiteaTags([
			{ name: "x", commit: { sha: "a", created: "b" }, zipball_url: "u" },
			{ name: "y" },
		])).toThrow(/gitea tags\[1\]/);
	});
});
