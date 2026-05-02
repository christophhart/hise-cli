import { describe, expect, it } from "vitest";
import { parseUserInfoXml } from "./userInfoXml.js";

describe("parseUserInfoXml", () => {
	it("reads Company", () => {
		const got = parseUserInfoXml(`<?xml version="1.0"?>
<UserInfo>
  <Company value="vendor_username"/>
</UserInfo>`);
		expect(got.company).toBe("vendor_username");
	});

	it("returns null when Company missing", () => {
		const got = parseUserInfoXml(`<?xml version="1.0"?>
<UserInfo>
  <SomethingElse value="x"/>
</UserInfo>`);
		expect(got.company).toBeNull();
	});

	it("throws on missing root", () => {
		expect(() => parseUserInfoXml("<root/>")).toThrow(/missing/);
	});
});
