import { describe, it, expect } from "vitest";
import {
	parseDuration,
	parseFrequency,
	parseNoteOrNumber,
	normalizeVelocity,
	parseEventLine,
	buildInjectPayload,
	formatEventSummary,
	sequenceDuration,
	extractName,
} from "./sequence-parser.js";
import type { SequenceEvent, NoteEvent, TestSignalEvent } from "./sequence-types.js";

describe("parseDuration", () => {
	it("parses milliseconds", () => {
		expect(parseDuration("500ms")).toBe(500);
		expect(parseDuration("0ms")).toBe(0);
		expect(parseDuration("1200ms")).toBe(1200);
	});

	it("parses seconds to milliseconds", () => {
		expect(parseDuration("1.2s")).toBe(1200);
		expect(parseDuration("2s")).toBe(2000);
		expect(parseDuration("0.5s")).toBe(500);
	});

	it("returns null for invalid input", () => {
		expect(parseDuration("abc")).toBeNull();
		expect(parseDuration("500")).toBeNull();
		expect(parseDuration("")).toBeNull();
		expect(parseDuration("-100ms")).toBeNull();
	});
});

describe("parseFrequency", () => {
	it("parses Hz", () => {
		expect(parseFrequency("440Hz")).toBe(440);
		expect(parseFrequency("20Hz")).toBe(20);
	});

	it("parses kHz to Hz", () => {
		expect(parseFrequency("1kHz")).toBe(1000);
		expect(parseFrequency("20kHz")).toBe(20000);
		expect(parseFrequency("2.5kHz")).toBe(2500);
	});

	it("returns null for invalid input", () => {
		expect(parseFrequency("abc")).toBeNull();
		expect(parseFrequency("440")).toBeNull();
		expect(parseFrequency("")).toBeNull();
	});
});

describe("parseNoteOrNumber", () => {
	it("parses note names with C3=60", () => {
		expect(parseNoteOrNumber("C3")).toBe(60);
		expect(parseNoteOrNumber("A4")).toBe(81);
		expect(parseNoteOrNumber("C4")).toBe(72);
		expect(parseNoteOrNumber("C0")).toBe(24);
	});

	it("handles sharps and flats", () => {
		expect(parseNoteOrNumber("C#3")).toBe(61);
		expect(parseNoteOrNumber("Db3")).toBe(61);
		expect(parseNoteOrNumber("F#4")).toBe(78);
	});

	it("parses raw MIDI numbers", () => {
		expect(parseNoteOrNumber("60")).toBe(60);
		expect(parseNoteOrNumber("0")).toBe(0);
		expect(parseNoteOrNumber("127")).toBe(127);
	});

	it("returns null for invalid input", () => {
		expect(parseNoteOrNumber("H4")).toBeNull();
		expect(parseNoteOrNumber("C")).toBeNull();
		expect(parseNoteOrNumber("128")).toBeNull();
		expect(parseNoteOrNumber("abc")).toBeNull();
	});

	it("handles case insensitivity", () => {
		expect(parseNoteOrNumber("c3")).toBe(60);
		expect(parseNoteOrNumber("a4")).toBe(81);
	});
});

describe("normalizeVelocity", () => {
	it("keeps values 0-1 as-is", () => {
		expect(normalizeVelocity(0.5)).toBe(0.5);
		expect(normalizeVelocity(1.0)).toBe(1.0);
		expect(normalizeVelocity(0)).toBe(0);
	});

	it("normalizes 2-127 by dividing by 127", () => {
		expect(normalizeVelocity(127)).toBeCloseTo(1.0);
		expect(normalizeVelocity(100)).toBeCloseTo(100 / 127);
		expect(normalizeVelocity(64)).toBeCloseTo(64 / 127);
	});

	it("returns null for out of range", () => {
		expect(normalizeVelocity(-1)).toBeNull();
		expect(normalizeVelocity(128)).toBeNull();
	});
});

describe("parseEventLine", () => {
	describe("play note", () => {
		it("parses full note spec", () => {
			const result = parseEventLine("0ms play C3 127 for 500ms");
			expect(result).toEqual({
				type: "note",
				timestamp: 0,
				noteNumber: 60,
				velocity: 1.0,
				duration: 500,
				channel: 1,
			});
		});

		it("defaults velocity and duration", () => {
			const result = parseEventLine("100ms play E4");
			expect(typeof result).not.toBe("string");
			const note = result as NoteEvent;
			expect(note.noteNumber).toBe(76);
			expect(note.velocity).toBe(1.0);
			expect(note.duration).toBe(500);
		});

		it("parses raw MIDI number", () => {
			const result = parseEventLine("0ms play 64 100 for 1s");
			expect(typeof result).not.toBe("string");
			const note = result as NoteEvent;
			expect(note.noteNumber).toBe(64);
			expect(note.velocity).toBeCloseTo(100 / 127);
			expect(note.duration).toBe(1000);
		});
	});

	describe("play signal", () => {
		it("parses sine with frequency and duration", () => {
			const result = parseEventLine("1.2s play sine at 440Hz for 500ms");
			expect(result).toEqual({
				type: "testsignal",
				timestamp: 1200,
				signal: "sine",
				duration: 500,
				frequency: 440,
			});
		});

		it("parses sweep with from/to/for", () => {
			const result = parseEventLine("0ms play sweep from 20Hz to 20kHz for 1.5s");
			expect(typeof result).not.toBe("string");
			const sig = result as TestSignalEvent;
			expect(sig.signal).toBe("sweep");
			expect(sig.startFrequency).toBe(20);
			expect(sig.endFrequency).toBe(20000);
			expect(sig.duration).toBe(1500);
		});

		it("parses noise with defaults", () => {
			const result = parseEventLine("0ms play noise");
			expect(typeof result).not.toBe("string");
			const sig = result as TestSignalEvent;
			expect(sig.signal).toBe("noise");
			expect(sig.duration).toBe(500);
		});
	});

	describe("send", () => {
		it("parses CC", () => {
			const result = parseEventLine("500ms send CC 1 127");
			expect(result).toEqual({
				type: "cc",
				timestamp: 500,
				controller: 1,
				value: 127,
				channel: 1,
			});
		});

		it("parses pitchbend", () => {
			const result = parseEventLine("0ms send pitchbend 8192");
			expect(result).toEqual({
				type: "pitchbend",
				timestamp: 0,
				value: 8192,
				channel: 1,
			});
		});

		it("rejects invalid CC values", () => {
			expect(typeof parseEventLine("0ms send CC 128 0")).toBe("string");
			expect(typeof parseEventLine("0ms send CC 0 128")).toBe("string");
		});
	});

	describe("set", () => {
		it("parses processor.param value", () => {
			const result = parseEventLine("800ms set SimpleGain.Gain -12");
			expect(result).toEqual({
				type: "set_attribute",
				timestamp: 800,
				processorId: "SimpleGain",
				parameterId: "Gain",
				value: -12,
			});
		});

		it("handles multi-word processor IDs with dots", () => {
			const result = parseEventLine("0ms set My.Nested.Module.Param 5");
			expect(typeof result).not.toBe("string");
			if (typeof result !== "string") {
				expect(result.type).toBe("set_attribute");
				if (result.type === "set_attribute") {
					expect(result.processorId).toBe("My.Nested.Module");
					expect(result.parameterId).toBe("Param");
				}
			}
		});

		it("rejects missing dot", () => {
			expect(typeof parseEventLine("0ms set NoDot 5")).toBe("string");
		});
	});

	describe("eval", () => {
		it("parses expression with id", () => {
			const result = parseEventLine("900ms eval Synth.getNumPressedKeys() as voice_test");
			expect(result).toEqual({
				type: "repl",
				timestamp: 900,
				expression: "Synth.getNumPressedKeys()",
				moduleId: "Interface",
				id: "voice_test",
			});
		});

		it("handles multi-word expressions", () => {
			const result = parseEventLine("0ms eval 1 + 2 as sum_test");
			expect(typeof result).not.toBe("string");
			if (typeof result !== "string" && result.type === "repl") {
				expect(result.expression).toBe("1 + 2");
				expect(result.id).toBe("sum_test");
			}
		});

		it("preserves quotes in expressions", () => {
			const result = parseEventLine('0ms eval Content.getComponent("Page1Btn").getValue() as BTN_VAL');
			expect(result).toEqual({
				type: "repl",
				timestamp: 0,
				expression: 'Content.getComponent("Page1Btn").getValue()',
				moduleId: "Interface",
				id: "BTN_VAL",
			});
		});

		it("rejects missing 'as'", () => {
			expect(typeof parseEventLine("0ms eval something")).toBe("string");
		});
	});

	it("rejects invalid timestamp", () => {
		expect(typeof parseEventLine("abc play C3")).toBe("string");
	});

	it("rejects unknown verb", () => {
		const result = parseEventLine("0ms dance C3");
		expect(typeof result).toBe("string");
		expect(result).toContain("Unknown verb");
	});
});

describe("buildInjectPayload", () => {
	it("builds payload with blocking", () => {
		const def = {
			name: "test",
			events: [
				{ type: "note" as const, timestamp: 0, noteNumber: 60, velocity: 1.0, duration: 500, channel: 1 },
			],
		};
		const payload = buildInjectPayload(def, { blocking: true });
		expect(payload.blocking).toBe(true);
		expect(payload.messages).toHaveLength(1);
		expect(payload.messages[0]).toEqual({
			type: "note",
			noteNumber: 60,
			velocity: 1.0,
			duration: 500,
			channel: 1,
			timestamp: 0,
		});
	});

	it("sets blocking when recordOutput is provided", () => {
		const def = { name: "test", events: [] };
		const payload = buildInjectPayload(def, { recordOutput: "test.wav" });
		expect(payload.blocking).toBe(true);
		expect(payload.recordOutput).toBe("test.wav");
	});
});

describe("formatEventSummary", () => {
	it("formats note events", () => {
		const summary = formatEventSummary({
			type: "note", timestamp: 0, noteNumber: 60,
			velocity: 1.0, duration: 500, channel: 1,
		});
		expect(summary).toBe("note C3 vel=127 dur=500ms");
	});

	it("formats CC events", () => {
		expect(formatEventSummary({
			type: "cc", timestamp: 0, controller: 1, value: 127, channel: 1,
		})).toBe("CC 1 = 127");
	});

	it("formats sweep events", () => {
		const summary = formatEventSummary({
			type: "testsignal", timestamp: 0, signal: "sweep",
			duration: 1500, startFrequency: 20, endFrequency: 20000,
		});
		expect(summary).toBe("sweep 20Hz-20000Hz dur=1.5s");
	});
});

describe("sequenceDuration", () => {
	it("computes max timestamp + duration", () => {
		const events: SequenceEvent[] = [
			{ type: "note", timestamp: 0, noteNumber: 60, velocity: 1, duration: 500, channel: 1 },
			{ type: "note", timestamp: 1000, noteNumber: 64, velocity: 1, duration: 200, channel: 1 },
		];
		expect(sequenceDuration(events)).toBe(1200);
	});

	it("returns 0 for empty events", () => {
		expect(sequenceDuration([])).toBe(0);
	});
});

describe("extractName", () => {
	it("extracts quoted name", () => {
		expect(extractName('"My Sequence"')).toBe("My Sequence");
		expect(extractName("'Test'")).toBe("Test");
	});

	it("extracts bare word", () => {
		expect(extractName("MySequence")).toBe("MySequence");
	});

	it("returns null for empty", () => {
		expect(extractName("")).toBeNull();
	});
});
