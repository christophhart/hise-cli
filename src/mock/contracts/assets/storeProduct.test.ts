import { describe, expect, it } from "vitest";
import { normalizeStoreCatalog, parseRepoLink } from "./storeProduct.js";

describe("parseRepoLink", () => {
	it("extracts vendor and repo id", () => {
		expect(parseRepoLink("https://git.hise.dev/vendor_username/synth_building_blocks"))
			.toEqual({ vendor: "vendor_username", repoId: "synth_building_blocks" });
	});

	it("ignores trailing path", () => {
		expect(parseRepoLink("https://git.hise.dev/vendor/repo/extra/path"))
			.toEqual({ vendor: "vendor", repoId: "repo" });
	});

	it("returns null for malformed url", () => {
		expect(parseRepoLink("not a url")).toBeNull();
	});

	it("returns null when path too short", () => {
		expect(parseRepoLink("https://git.hise.dev/vendor")).toBeNull();
	});
});

describe("normalizeStoreCatalog", () => {
	it("normalizes a happy-path entry", () => {
		const got = normalizeStoreCatalog([
			{
				product_name: "Synth Building Blocks",
				product_short_description: "Reusable synth components",
				path: "/products/synth_building_blocks",
				thumbnail: "https://store.hise.dev/x.png",
				repo_link: "https://git.hise.dev/vendor/synth_building_blocks",
			},
		]);
		expect(got).toHaveLength(1);
		expect(got[0]).toMatchObject({
			productName: "Synth Building Blocks",
			vendor: "vendor",
			repoId: "synth_building_blocks",
		});
	});

	it("skips entries with no repo_link", () => {
		const got = normalizeStoreCatalog([
			{ product_name: "Without Repo" },
			{ product_name: "X", repo_link: "https://git.hise.dev/v/r" },
		]);
		expect(got).toHaveLength(1);
		expect(got[0].productName).toBe("X");
	});

	it("rejects malformed repo_link", () => {
		expect(() => normalizeStoreCatalog([{ product_name: "X", repo_link: "garbage" }]))
			.toThrow(/parse as gitea URL/);
	});

	it("rejects non-array root", () => {
		expect(() => normalizeStoreCatalog({})).toThrow(/must be an array/);
	});

	it("rejects missing product_name", () => {
		expect(() => normalizeStoreCatalog([
			{ repo_link: "https://git.hise.dev/v/r" },
		])).toThrow(/product_name/);
	});
});
