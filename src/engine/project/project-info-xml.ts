// ── Pure parsers for HISE project metadata XML files ────────────────
//
// `project_info.xml` and `user_info.xml` are simple XML files generated
// by HISE — every settable field is a single self-closing element with a
// `value` attribute (and optional `type`/`description`/`options`
// attributes which we ignore). No nesting, no text content, no CDATA.
//
// Parsing is intentionally regex-based for this fixed schema: it keeps
// the engine layer dependency-free (no `node:` imports here, no XML
// parser package), and the schema is stable HISE-generated output.
// The Node-side wrapper that reads the actual files lives in
// `src/tui/wizard-handlers/publish-detect.ts`.

export interface ProjectInfo {
	readonly name: string;
	readonly version: string;
	readonly bundleIdentifier: string;
	readonly pluginCode: string;
	readonly description?: string;
}

export interface UserInfo {
	readonly company: string;
	readonly companyCode: string;
	readonly companyURL?: string;
	readonly companyCopyright?: string;
	readonly teamDevelopmentID?: string;
}

export interface ProjectMetadata {
	readonly project: ProjectInfo;
	readonly user: UserInfo;
}

export class ProjectInfoParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProjectInfoParseError";
	}
}

function readField(xml: string, tag: string): string | null {
	// Match <Tag value="..." ...attrs/> where attrs may include
	// type="..." description="..." options="..." in any order.
	// We only care about the value attribute.
	const re = new RegExp(`<${tag}\\b[^>]*\\bvalue\\s*=\\s*"([^"]*)"`, "i");
	const match = re.exec(xml);
	return match ? match[1] : null;
}

function requireField(xml: string, tag: string, file: string): string {
	const value = readField(xml, tag);
	if (value === null) {
		throw new ProjectInfoParseError(
			`Missing required <${tag}> element in ${file}`,
		);
	}
	return value;
}

/** Parse the contents of a HISE `project_info.xml` file. */
export function parseProjectInfo(xml: string): ProjectInfo {
	if (!/<ProjectSettings\b/.test(xml)) {
		throw new ProjectInfoParseError(
			"Not a HISE project_info.xml — missing <ProjectSettings> root",
		);
	}
	const name = requireField(xml, "Name", "project_info.xml");
	const version = requireField(xml, "Version", "project_info.xml");
	const bundleIdentifier = requireField(
		xml,
		"BundleIdentifier",
		"project_info.xml",
	);
	const pluginCode = requireField(xml, "PluginCode", "project_info.xml");
	const description = readField(xml, "Description") ?? undefined;
	return { name, version, bundleIdentifier, pluginCode, description };
}

/** Parse the contents of a HISE `user_info.xml` file. */
export function parseUserInfo(xml: string): UserInfo {
	if (!/<UserSettings\b/.test(xml)) {
		throw new ProjectInfoParseError(
			"Not a HISE user_info.xml — missing <UserSettings> root",
		);
	}
	const company = requireField(xml, "Company", "user_info.xml");
	const companyCode = requireField(xml, "CompanyCode", "user_info.xml");
	const companyURL = readField(xml, "CompanyURL") ?? undefined;
	const companyCopyright = readField(xml, "CompanyCopyright") ?? undefined;
	const teamDevelopmentID = readField(xml, "TeamDevelopmentID") ?? undefined;
	return {
		company,
		companyCode,
		companyURL,
		companyCopyright,
		teamDevelopmentID,
	};
}
