// Source-package `user_info.xml` parser. Spec §3.5.
// Only field consumed by the asset manager is `Company`.

import { XMLParser } from "fast-xml-parser";
import { decodeXmlEntities } from "./xml.js";

export interface UserInfo {
	company: string | null;
}

const PARSER = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseAttributeValue: false,
});

export function parseUserInfoXml(xml: string): UserInfo {
	const parsed = PARSER.parse(xml) as Record<string, unknown>;
	const root = parsed.UserInfo;
	if (!root || typeof root !== "object") {
		throw new Error("user_info.xml: missing <UserInfo> root");
	}
	const data = root as Record<string, unknown>;
	const company = data.Company;
	if (company && typeof company === "object" && !Array.isArray(company)) {
		const attrs = company as Record<string, unknown>;
		if (typeof attrs.value === "string") return { company: decodeXmlEntities(attrs.value) };
	}
	return { company: null };
}
