import { describe, it, expect } from "vitest";
import {
	parseProjectInfo,
	parseUserInfo,
	ProjectInfoParseError,
} from "./project-info-xml.js";

const MINIMAL_PROJECT_INFO = `<?xml version="1.0" encoding="UTF-8"?>

<ProjectSettings>
  <Name value="hise_project"/>
  <Version value="1.0.0"/>
  <Description value=""/>
  <BundleIdentifier value="com.myCompany.product"/>
  <PluginCode value="Abcd"/>
</ProjectSettings>
`;

const FULL_PROJECT_INFO = `<?xml version="1.0" encoding="UTF-8"?>

<ProjectSettings>
  <Name value="Demo Project" type="TEXT" description="Project Name"/>
  <Version value="1.2.3" type="TEXT" description="Project version"/>
  <Description value="The most simple HISE project" type="TEXT" description="Project description"/>
  <BundleIdentifier value="com.HISEDemoProject.pkg" type="TEXT" description="Bundle Identifier"/>
  <PluginCode value="Hidp" type="TEXT" description="a 4 character ID code"/>
  <EmbedAudioFiles value="Yes" type="LIST" description="Embed Audio files in plugin" options="Yes&#10;No"/>
</ProjectSettings>
`;

const USER_INFO = `<?xml version="1.0" encoding="UTF-8"?>

<UserSettings>
  <Company value="My Company"/>
  <CompanyCode value="Abcd"/>
  <CompanyURL value="http://yourcompany.com"/>
  <CompanyCopyright value="(c)2017, Company"/>
  <TeamDevelopmentID value="ABCDE12345"/>
</UserSettings>
`;

describe("parseProjectInfo", () => {
	it("parses a minimal project_info.xml", () => {
		const info = parseProjectInfo(MINIMAL_PROJECT_INFO);
		expect(info.name).toBe("hise_project");
		expect(info.version).toBe("1.0.0");
		expect(info.bundleIdentifier).toBe("com.myCompany.product");
		expect(info.pluginCode).toBe("Abcd");
		expect(info.description).toBe("");
	});

	it("ignores extra type/description attributes", () => {
		const info = parseProjectInfo(FULL_PROJECT_INFO);
		expect(info.name).toBe("Demo Project");
		expect(info.version).toBe("1.2.3");
		expect(info.bundleIdentifier).toBe("com.HISEDemoProject.pkg");
		expect(info.pluginCode).toBe("Hidp");
		expect(info.description).toBe("The most simple HISE project");
	});

	it("throws on non-HISE XML (missing root element)", () => {
		expect(() => parseProjectInfo("<Other/>")).toThrow(
			ProjectInfoParseError,
		);
	});

	it("throws on missing required field", () => {
		const xml = `<ProjectSettings><Name value="x"/></ProjectSettings>`;
		expect(() => parseProjectInfo(xml)).toThrow(/Missing required <Version>/);
	});

	it("preserves whitespace and special chars in values", () => {
		const xml = `<ProjectSettings>
			<Name value="My Plugin"/>
			<Version value="1.0.0-rc.1"/>
			<BundleIdentifier value="com.example.my-plugin"/>
			<PluginCode value="MyPg"/>
		</ProjectSettings>`;
		const info = parseProjectInfo(xml);
		expect(info.name).toBe("My Plugin");
		expect(info.version).toBe("1.0.0-rc.1");
		expect(info.bundleIdentifier).toBe("com.example.my-plugin");
	});
});

describe("parseUserInfo", () => {
	it("parses a full user_info.xml", () => {
		const info = parseUserInfo(USER_INFO);
		expect(info.company).toBe("My Company");
		expect(info.companyCode).toBe("Abcd");
		expect(info.companyURL).toBe("http://yourcompany.com");
		expect(info.companyCopyright).toBe("(c)2017, Company");
		expect(info.teamDevelopmentID).toBe("ABCDE12345");
	});

	it("treats optional fields as undefined when missing", () => {
		const xml = `<UserSettings>
			<Company value="Acme"/>
			<CompanyCode value="Acme"/>
		</UserSettings>`;
		const info = parseUserInfo(xml);
		expect(info.company).toBe("Acme");
		expect(info.companyURL).toBeUndefined();
		expect(info.companyCopyright).toBeUndefined();
		expect(info.teamDevelopmentID).toBeUndefined();
	});

	it("throws when required Company is missing", () => {
		const xml = `<UserSettings><CompanyCode value="x"/></UserSettings>`;
		expect(() => parseUserInfo(xml)).toThrow(/Missing required <Company>/);
	});

	it("throws on non-HISE XML (missing root element)", () => {
		expect(() => parseUserInfo("<ProjectSettings/>")).toThrow(
			ProjectInfoParseError,
		);
	});
});
