import { describe, it, expect } from "vitest";
import { discoverBinaries, discoveryToCsv } from "./binary-discovery.js";

function makeFs(tree: Record<string, string[]>) {
	return async (dir: string): Promise<string[]> => {
		const normalized = dir.replace(/\\/g, "/");
		for (const [key, entries] of Object.entries(tree)) {
			if (key.replace(/\\/g, "/") === normalized) return entries;
		}
		throw new Error("ENOENT");
	};
}

describe("discoverBinaries — Windows", () => {
	it("finds VST3, AAX and standalone in Compiled subfolders", async () => {
		const list = makeFs({
			"C:/proj/Binaries/Compiled/VST3": ["MyPlugin.vst3"],
			"C:/proj/Binaries/Compiled/AAX": ["MyPlugin.aaxplugin"],
			"C:/proj/Binaries/Compiled/App": ["MyPlugin.exe", "readme.txt"],
		});
		const result = await discoverBinaries({
			projectFolder: "C:/proj",
			platform: "Windows",
			list,
			join: (...p) => p.join("\\"),
		});
		expect(result.vst3).toBe("C:/proj\\Binaries\\Compiled\\VST3\\MyPlugin.vst3");
		expect(result.aax).toBe(
			"C:/proj\\Binaries\\Compiled\\AAX\\MyPlugin.aaxplugin",
		);
		expect(result.standalone).toBe(
			"C:/proj\\Binaries\\Compiled\\App\\MyPlugin.exe",
		);
		expect(result.au).toBeUndefined();
	});

	it("returns empty discovery when no binaries exist", async () => {
		const list = makeFs({});
		const result = await discoverBinaries({
			projectFolder: "C:/empty",
			platform: "Windows",
			list,
		});
		expect(result.vst3).toBeUndefined();
		expect(result.aax).toBeUndefined();
		expect(result.standalone).toBeUndefined();
		expect(result.au).toBeUndefined();
	});

	it("ignores non-matching files in target dir", async () => {
		const list = makeFs({
			"C:/proj/Binaries/Compiled/VST3": ["readme.txt", "MyPlugin.dll"],
		});
		const result = await discoverBinaries({
			projectFolder: "C:/proj",
			platform: "Windows",
			list,
			join: (...p) => p.join("\\"),
		});
		expect(result.vst3).toBeUndefined();
	});
});

describe("discoverBinaries — macOS", () => {
	it("finds all four targets in shared Release dir", async () => {
		const list = makeFs({
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release": [
				"MyPlugin.vst3",
				"MyPlugin.component",
				"MyPlugin.aaxplugin",
				"MyPlugin.app",
				"randomNote.txt",
			],
		});
		const result = await discoverBinaries({
			projectFolder: "/proj",
			platform: "macOS",
			list,
		});
		expect(result.vst3).toBe(
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release/MyPlugin.vst3",
		);
		expect(result.au).toBe(
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release/MyPlugin.component",
		);
		expect(result.aax).toBe(
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release/MyPlugin.aaxplugin",
		);
		expect(result.standalone).toBe(
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release/MyPlugin.app",
		);
	});

	it("finds only AU when other formats are missing", async () => {
		const list = makeFs({
			"/proj/Binaries/Builds/MacOSXMakefile/build/Release": [
				"MyPlugin.component",
			],
		});
		const result = await discoverBinaries({
			projectFolder: "/proj",
			platform: "macOS",
			list,
		});
		expect(result.au).toContain(".component");
		expect(result.vst3).toBeUndefined();
		expect(result.aax).toBeUndefined();
		expect(result.standalone).toBeUndefined();
	});
});

describe("discoveryToCsv", () => {
	it("orders targets VST3,AU,AAX,Standalone", () => {
		expect(
			discoveryToCsv({
				standalone: "x",
				vst3: "x",
				aax: "x",
				au: "x",
			}),
		).toBe("VST3,AU,AAX,Standalone");
	});

	it("emits empty string when nothing found", () => {
		expect(discoveryToCsv({})).toBe("");
	});

	it("includes only present targets", () => {
		expect(discoveryToCsv({ vst3: "x", aax: "y" })).toBe("VST3,AAX");
	});
});
