import { describe, it, expect } from "vitest";
import { SequenceMode } from "./sequence.js";
import { MockHiseConnection } from "../hise.js";
import type { SessionContext } from "./mode.js";

function makeSession(connection: MockHiseConnection | null = null): SessionContext {
	return {
		connection,
		popMode: () => ({ type: "empty" }),
	};
}

describe("SequenceMode", () => {
	describe("create / events / flush lifecycle", () => {
		it("creates, adds events, and flushes a sequence", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			const createResult = await mode.parse('create "Test"', session);
			expect(createResult.type).toBe("text");
			expect((createResult as { content: string }).content).toContain("Defining sequence");

			const noteResult = await mode.parse("0ms play C3 127 for 500ms", session);
			expect(noteResult.type).toBe("text");
			expect((noteResult as { content: string }).content).toContain("note C3");

			const ccResult = await mode.parse("500ms send CC 1 127", session);
			expect(ccResult.type).toBe("text");
			expect((ccResult as { content: string }).content).toContain("CC 1");

			const flushResult = await mode.parse("flush", session);
			expect(flushResult.type).toBe("text");
			expect((flushResult as { content: string }).content).toContain("2 events");
		});

		it("rejects double create", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			await mode.parse('create "A"', session);
			const result = await mode.parse('create "B"', session);
			expect(result.type).toBe("error");
		});

		it("rejects flush without create", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			const result = await mode.parse("flush", session);
			expect(result.type).toBe("error");
			expect((result as { message: string }).message).toContain("No active");
		});

		it("reports event parse errors without aborting definition", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			await mode.parse('create "Test"', session);
			const badResult = await mode.parse("0ms dance C3", session);
			expect(badResult.type).toBe("error");

			// Can still add valid events after error
			const goodResult = await mode.parse("0ms play C3", session);
			expect(goodResult.type).toBe("text");
		});
	});

	describe("show", () => {
		it("shows sequence details", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			await mode.parse('create "MySeq"', session);
			await mode.parse("0ms play C3 127 for 500ms", session);
			await mode.parse("500ms send CC 74 100", session);
			await mode.parse("flush", session);

			const result = await mode.parse('show "MySeq"', session);
			expect(result.type).toBe("markdown");
			const content = (result as { content: string }).content;
			expect(content).toContain("MySeq");
			expect(content).toContain("2");
		});

		it("errors on unknown sequence", async () => {
			const mode = new SequenceMode();
			const result = await mode.parse('show "Nope"', makeSession());
			expect(result.type).toBe("error");
		});
	});

	describe("play", () => {
		it("sends correct POST body and stores repl results", async () => {
			const mode = new SequenceMode();
			const mock = new MockHiseConnection();

			mock.onPost("/api/testing/sequence", () => ({
				success: true,
				isPlaying: false,
				durationMs: 1000,
				eventsInSequence: 2,
				playedEvents: 2,
				progress: 1.0,
				replResults: [
					{ id: "voice_test", expression: "Synth.getNumPressedKeys()", moduleId: "Interface", timestamp: 500, success: true, value: 1 },
				],
				logs: [],
				errors: [],
			}));

			const session = makeSession(mock);

			await mode.parse('create "PlayTest"', session);
			await mode.parse("0ms play C3", session);
			await mode.parse("500ms eval Synth.getNumPressedKeys() as voice_test", session);
			await mode.parse("flush", session);

			const playResult = await mode.parse('play "PlayTest"', session);
			expect(playResult.type).toBe("text");
			expect((playResult as { content: string }).content).toContain("completed");

			// Verify POST body
			const postCall = mock.calls.find(c => c.method === "POST" && c.endpoint === "/api/testing/sequence");
			expect(postCall).toBeDefined();
			const body = postCall!.body as { messages: unknown[]; blocking: boolean };
			expect(body.blocking).toBe(true);
			expect(body.messages).toHaveLength(2);

			// Verify get retrieves stored repl result
			const getResult = await mode.parse("get voice_test", session);
			expect(getResult.type).toBe("text");
			expect((getResult as { content: string }).content).toBe("1");
		});

		it("errors without connection", async () => {
			const mode = new SequenceMode();
			const session = makeSession(null);

			await mode.parse('create "NoConn"', session);
			await mode.parse("0ms play C3", session);
			await mode.parse("flush", session);

			const result = await mode.parse('play "NoConn"', session);
			expect(result.type).toBe("error");
			expect((result as { message: string }).message).toContain("No HISE connection");
		});

		it("errors on unknown sequence", async () => {
			const mode = new SequenceMode();
			const mock = new MockHiseConnection();
			const result = await mode.parse('play "Nope"', makeSession(mock));
			expect(result.type).toBe("error");
		});
	});

	describe("record", () => {
		it("sends recordOutput in payload", async () => {
			const mode = new SequenceMode();
			const mock = new MockHiseConnection();

			mock.onPost("/api/testing/sequence", () => ({
				success: true,
				isPlaying: false,
				durationMs: 500,
				logs: [],
				errors: [],
			}));

			const session = makeSession(mock);

			await mode.parse('create "RecTest"', session);
			await mode.parse("0ms play sine at 440Hz for 500ms", session);
			await mode.parse("flush", session);

			const result = await mode.parse('record "RecTest" as D:/Tests/output.wav', session);
			expect(result.type).toBe("text");
			expect((result as { content: string }).content).toContain("Recorded to");

			const postCall = mock.calls.find(c => c.method === "POST");
			const body = postCall!.body as { recordOutput: string; blocking: boolean };
			expect(body.recordOutput).toBe("D:/Tests/output.wav");
			expect(body.blocking).toBe(true);
		});
	});

	describe("stop", () => {
		it("sends allNotesOff", async () => {
			const mode = new SequenceMode();
			const mock = new MockHiseConnection();

			mock.onPost("/api/testing/sequence", () => ({ success: true, logs: [], errors: [] }));

			const result = await mode.parse("stop", makeSession(mock));
			expect(result.type).toBe("text");
			expect((result as { content: string }).content).toContain("All notes off");

			const postCall = mock.calls.find(c => c.method === "POST");
			const body = postCall!.body as { messages: Array<{ type: string }> };
			expect(body.messages[0]!.type).toBe("allNotesOff");
		});
	});

	describe("get", () => {
		it("returns error for unknown id", async () => {
			const mode = new SequenceMode();
			const result = await mode.parse("get unknown_id", makeSession());
			expect(result.type).toBe("error");
		});

		it("returns empty string for missing id arg", async () => {
			const mode = new SequenceMode();
			const result = await mode.parse("get", makeSession());
			expect(result.type).toBe("error");
		});
	});

	describe("help", () => {
		it("returns help in both phases", async () => {
			const mode = new SequenceMode();
			const session = makeSession();

			const helpCmd = await mode.parse("help", session);
			expect(helpCmd.type).toBe("markdown");

			// Also works during define phase
			await mode.parse('create "H"', session);
			const helpDef = await mode.parse("help", session);
			expect(helpDef.type).toBe("markdown");
		});
	});

	describe("unknown command", () => {
		it("returns error for unknown command", async () => {
			const mode = new SequenceMode();
			const result = await mode.parse("foobar", makeSession());
			expect(result.type).toBe("error");
		});
	});
});
