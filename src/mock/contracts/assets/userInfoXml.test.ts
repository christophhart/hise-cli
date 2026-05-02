import { describe, expect, it } from "vitest";
import { parseUserInfoXml } from "./userInfoXml.js";

describe("parseUserInfoXml", () => {
	it("reads Company from <UserSettings>", () => {
		const got = parseUserInfoXml(`<?xml version="1.0"?>
<UserSettings>
  <Company value="vendor_username"/>
  <CompanyCode value="Abcd"/>
  <CompanyURL value="http://x"/>
</UserSettings>`);
		expect(got.company).toBe("vendor_username");
	});

	it("rejects <UserInfo> root", () => {
		expect(() => parseUserInfoXml(`<?xml version="1.0"?>
<UserInfo><Company value="x"/></UserInfo>`)).toThrow(/missing <UserSettings>/);
	});

	it("returns null when Company missing", () => {
		const got = parseUserInfoXml(`<?xml version="1.0"?>
<UserSettings>
  <CompanyCode value="x"/>
</UserSettings>`);
		expect(got.company).toBeNull();
	});

	it("throws on missing root", () => {
		expect(() => parseUserInfoXml("<root/>")).toThrow(/missing/);
	});
});
