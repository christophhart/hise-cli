import { describe, expect, it } from "vitest";
import { lookupSourcePreprocessor, parseProjectInfoXml } from "./projectInfoXml.js";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>

<ProjectSettings>
  <Name value="MyPlugin"/>
  <Version value="1.0.0"/>
  <ExtraDefinitionsWindows value="HAS_LICENSE_KEY=1&#13;&#10;WIN_FLAG=2"/>
  <ExtraDefinitionsOSX value="HAS_LICENSE_KEY=1"/>
  <ExtraDefinitionsLinux value=""/>
  <ExtraDefinitionsNetworkDll value=""/>
  <OSXStaticLibs value=""/>
  <WindowsStaticLibFolder value=""/>
</ProjectSettings>`;

describe("parseProjectInfoXml", () => {
	it("extracts each setting's value attribute", () => {
		const info = parseProjectInfoXml(SAMPLE);
		expect(info.settings.Name).toBe("MyPlugin");
		expect(info.settings.Version).toBe("1.0.0");
		expect(info.settings.ExtraDefinitionsWindows).toContain("HAS_LICENSE_KEY=1");
		expect(info.settings.ExtraDefinitionsWindows).toContain("WIN_FLAG=2");
	});

	it("preserves empty value strings", () => {
		const info = parseProjectInfoXml(SAMPLE);
		expect(info.settings.OSXStaticLibs).toBe("");
		expect(info.settings.ExtraDefinitionsLinux).toBe("");
	});

	it("throws on missing ProjectSettings root", () => {
		expect(() => parseProjectInfoXml("<root/>")).toThrow(/missing/);
	});
});

describe("lookupSourcePreprocessor", () => {
	const info = parseProjectInfoXml(SAMPLE);

	it("finds value defined consistently across slots", () => {
		const got = lookupSourcePreprocessor(info, "HAS_LICENSE_KEY");
		expect(got.value).toBe("1");
		expect(got.warnings).toHaveLength(0);
	});

	it("finds value defined only in one slot", () => {
		const got = lookupSourcePreprocessor(info, "WIN_FLAG");
		expect(got.value).toBe("2");
	});

	it("returns null for unknown macro", () => {
		const got = lookupSourcePreprocessor(info, "NEVER_DEFINED");
		expect(got.value).toBeNull();
	});

	it("warns on divergent slot values", () => {
		const divergent = parseProjectInfoXml(`<?xml version="1.0"?>
<ProjectSettings>
  <ExtraDefinitionsWindows value="FOO=1"/>
  <ExtraDefinitionsOSX value="FOO=2"/>
  <ExtraDefinitionsLinux value=""/>
  <ExtraDefinitionsNetworkDll value=""/>
</ProjectSettings>`);
		const got = lookupSourcePreprocessor(divergent, "FOO");
		expect(got.value).toBe("1"); // Windows precedence
		expect(got.warnings).toHaveLength(1);
		expect(got.warnings[0]).toMatch(/divergent/);
	});

	it("ignores blank and malformed lines", () => {
		const tricky = parseProjectInfoXml(`<?xml version="1.0"?>
<ProjectSettings>
  <ExtraDefinitionsWindows value="&#13;&#10;noequalshere&#13;&#10;BAR=baz"/>
  <ExtraDefinitionsOSX value=""/>
  <ExtraDefinitionsLinux value=""/>
  <ExtraDefinitionsNetworkDll value=""/>
</ProjectSettings>`);
		expect(lookupSourcePreprocessor(tricky, "BAR").value).toBe("baz");
		expect(lookupSourcePreprocessor(tricky, "noequalshere").value).toBeNull();
	});
});
