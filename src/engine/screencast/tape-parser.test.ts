import { describe, expect, it } from "vitest";
import { parseTape } from "./tape-parser.js";

describe("tape parser", () => {
	it("parses empty input", () => {
		const result = parseTape("");
		expect(result.commands).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	it("skips comments and blank lines", () => {
		const result = parseTape(`
# This is a comment
   # Indented comment

# Another comment
`);
		expect(result.commands).toHaveLength(0);
		expect(result.errors).toHaveLength(0);
	});

	it("parses Output command", () => {
		const result = parseTape('Output demo.cast');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({ type: "Output", path: "demo.cast" });
	});

	it("parses Set commands", () => {
		const result = parseTape(`
Set Shell bash
Set Width 120
Set Height 40
Set TypingSpeed 50ms
`);
		expect(result.commands).toHaveLength(4);
		expect(result.commands[0]).toEqual({ type: "Set", key: "Shell", value: "bash" });
		expect(result.commands[1]).toEqual({ type: "Set", key: "Width", value: "120" });
	});

	it("rejects unknown Set keys", () => {
		const result = parseTape("Set FakeKey value");
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].message).toContain("Unknown Set key");
	});

	it("parses Type with quoted text", () => {
		const result = parseTape('Type "/script"');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({ type: "Type", text: "/script" });
	});

	it("parses Type without quotes", () => {
		const result = parseTape("Type Engine.getSampleRate()");
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Type",
			text: "Engine.getSampleRate()",
		});
	});

	it("parses Type with speed", () => {
		const result = parseTape('Type "hello" 100ms');
		expect(result.commands).toHaveLength(1);
		const cmd = result.commands[0];
		expect(cmd.type).toBe("Type");
		if (cmd.type === "Type") {
			expect(cmd.text).toBe("hello");
			expect(cmd.speed).toBe(100);
		}
	});

	it("parses key commands", () => {
		const result = parseTape(`
Enter
Backspace
Tab
Escape
Up 3
Down
Ctrl+C
Ctrl+Space
`);
		expect(result.commands).toHaveLength(8);
		expect(result.commands[0]).toEqual({ type: "Key", key: "Enter" });
		expect(result.commands[4]).toEqual({ type: "Key", key: "Up", count: 3 });
		expect(result.commands[6]).toEqual({ type: "Key", key: "Ctrl+C" });
		expect(result.commands[7]).toEqual({ type: "Key", key: "Ctrl+Space" });
	});

	it("parses Sleep", () => {
		const result = parseTape(`
Sleep 500ms
Sleep 2s
Sleep 100
`);
		expect(result.commands).toHaveLength(3);
		expect(result.commands[0]).toEqual({ type: "Sleep", duration: 500, unit: "ms" });
		expect(result.commands[1]).toEqual({ type: "Sleep", duration: 2, unit: "s" });
		expect(result.commands[2]).toEqual({ type: "Sleep", duration: 100, unit: "ms" });
	});

	it("parses Wait", () => {
		const result = parseTape('Wait "connected"');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Wait",
			pattern: "connected",
		});
	});

	it("parses Wait with timeout", () => {
		const result = parseTape('Wait "ready" 5s');
		expect(result.commands).toHaveLength(1);
		const cmd = result.commands[0];
		if (cmd.type === "Wait") {
			expect(cmd.pattern).toBe("ready");
			expect(cmd.timeout).toBe(5000);
		}
	});

	it("parses Expect", () => {
		const result = parseTape('Expect "44100"');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Expect",
			pattern: "44100",
		});
	});

	it("parses Expect with statusbar region", () => {
		const result = parseTape('Expect "builder" statusbar');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Expect",
			pattern: "builder",
			region: "statusbar",
		});
	});

	it("parses Expect with input region", () => {
		const result = parseTape('Expect "/help" input');
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Expect",
			pattern: "/help",
			region: "input",
		});
	});

	it("parses Snapshot", () => {
		const result = parseTape("Snapshot after-mode-switch");
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0]).toEqual({
			type: "Snapshot",
			name: "after-mode-switch",
		});
	});

	it("parses Annotation", () => {
		const result = parseTape('Annotation "Enter builder mode" 3s');
		expect(result.commands).toHaveLength(1);
		const cmd = result.commands[0];
		if (cmd.type === "Annotation") {
			expect(cmd.text).toBe("Enter builder mode");
			expect(cmd.duration).toBe(3000);
		}
	});

	it("parses Hide and Show", () => {
		const result = parseTape(`
Hide
Type "internal setup"
Enter
Show
`);
		expect(result.commands).toHaveLength(4);
		expect(result.commands[0]).toEqual({ type: "Hide" });
		expect(result.commands[3]).toEqual({ type: "Show" });
	});

	it("reports errors with line numbers", () => {
		const result = parseTape(`
Type "/script"
Enter
FakeCommand something
Type "hello"
AnotherFake
`);
		expect(result.commands).toHaveLength(3);
		expect(result.errors).toHaveLength(2);
		expect(result.errors[0].line).toBe(4);
		expect(result.errors[0].message).toContain("Unknown command: FakeCommand");
		expect(result.errors[1].line).toBe(6);
	});

	it("parses a complete screencast script", () => {
		const script = `
# Mode switching demo
Output mode-switching.cast
Set Width 120
Set Height 40
Set TypingSpeed 50ms

Sleep 1s
Annotation "Starting in root mode"

Type "/script"
Enter
Wait "\\[script:Interface\\]"
Expect "script" statusbar

Type "Engine.getSampleRate()"
Enter
Sleep 500ms
Expect "44100"

Type "/exit"
Enter
Expect ">" input

Snapshot end-state
`;
		const result = parseTape(script);
		expect(result.errors).toHaveLength(0);
		expect(result.commands.length).toBeGreaterThan(10);

		// Verify the sequence contains expected command types
		const types = result.commands.map((c) => c.type);
		expect(types).toContain("Output");
		expect(types).toContain("Set");
		expect(types).toContain("Type");
		expect(types).toContain("Key");
		expect(types).toContain("Sleep");
		expect(types).toContain("Wait");
		expect(types).toContain("Expect");
		expect(types).toContain("Annotation");
		expect(types).toContain("Snapshot");
	});
});
