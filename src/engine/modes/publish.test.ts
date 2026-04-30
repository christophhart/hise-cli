import { describe, expect, it } from "vitest";
import { PublishMode } from "./publish.js";
import type { CommandResult } from "../result.js";
import type { SessionContext } from "./mode.js";

function createMockSession(): {
	session: SessionContext;
	calls: string[];
} {
	const calls: string[] = [];
	const session: SessionContext = {
		connection: null,
		popMode: () => ({ type: "text", content: "Exited publish mode." }),
		handleInput: async (raw: string): Promise<CommandResult> => {
			calls.push(raw);
			return { type: "text", content: `(stub) dispatched: ${raw}` };
		},
	};
	return { session, calls };
}

describe("PublishMode identity", () => {
	it("has correct id, name, accent, prompt", () => {
		const mode = new PublishMode();
		expect(mode.id).toBe("publish");
		expect(mode.name).toBe("Publish");
		expect(mode.accent).toBe("#ff79c6");
		expect(mode.prompt).toBe("[publish] > ");
	});
});

describe("PublishMode help / dispatch", () => {
	it("shows help table for empty input", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("", session);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("/publish commands");
			expect(result.content).toContain("check");
			expect(result.content).toContain("build");
		}
	});

	it("shows help table for `help` verb", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("help", session);
		expect(result.type).toBe("markdown");
	});

	it("rejects unknown verbs with a hint", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("frobnicate", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("frobnicate");
		}
	});
});

describe("PublishMode `check` verb", () => {
	it("rejects `check` with no target", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("check", session);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("system");
		}
	});

	it("returns a stub markdown for `check system` (full impl in PR5)", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("check system", session);
		expect(result.type).toBe("markdown");
	});

	it("rejects `check binaries` with no list", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("check binaries", session);
		expect(result.type).toBe("error");
	});

	it("accepts `check binaries VST3,AU` and echoes the parsed list", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse(
			"check binaries VST3,AU",
			session,
		);
		expect(result.type).toBe("markdown");
		if (result.type === "markdown") {
			expect(result.content).toContain("VST3, AU");
		}
	});

	it("rejects `check binaries` with unknown target", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse(
			"check binaries VST3,LV2",
			session,
		);
		expect(result.type).toBe("error");
		if (result.type === "error") {
			expect(result.message).toContain("LV2");
		}
	});

	it("rejects unknown check sub-target", async () => {
		const { session } = createMockSession();
		const result = await new PublishMode().parse("check oranges", session);
		expect(result.type).toBe("error");
	});
});

describe("PublishMode `build` verb", () => {
	it("dispatches `/wizard run build_installer` with no overrides", async () => {
		const { session, calls } = createMockSession();
		await new PublishMode().parse("build", session);
		expect(calls).toEqual(["/wizard run build_installer"]);
	});

	it("forwards `with K=V` clause verbatim", async () => {
		const { session, calls } = createMockSession();
		await new PublishMode().parse("build with codesign=1", session);
		expect(calls).toEqual(["/wizard run build_installer with codesign=1"]);
	});

	it("returns an error when host has no handleInput", async () => {
		const session: SessionContext = {
			connection: null,
			popMode: () => ({ type: "text", content: "" }),
		};
		const result = await new PublishMode().parse("build", session);
		expect(result.type).toBe("error");
	});
});

describe("PublishMode completion", () => {
	it("completes verb names at the start of the line", () => {
		const mode = new PublishMode();
		const completion = mode.complete!("c", 1);
		const labels = completion.items.map((i) => i.label);
		expect(labels).toContain("check");
		expect(labels).not.toContain("build");
	});

	it("returns no items past the first token", () => {
		const mode = new PublishMode();
		const completion = mode.complete!("check ", 6);
		expect(completion.items).toEqual([]);
	});
});
