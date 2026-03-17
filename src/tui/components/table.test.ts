// ── Table formatter tests ──────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { formatTable } from "./table.js";
import { lightenHex, schemes } from "../theme.js";

const testScheme = schemes.monokai;

describe("formatTable - basic rendering", () => {
	it("formats simple table with standard density", () => {
		const lines = formatTable(
			["A", "B"],
			[["1", "2"]],
			testScheme,
			"standard",
		);

		// Structure: top border, header, divider, 1 row, bottom border
		expect(lines).toHaveLength(5);
		expect(lines[1].text).toContain("A");
		expect(lines[1].text).toContain("B");
		expect(lines[3].text).toContain("1");
		expect(lines[3].text).toContain("2");
	});

	it("includes vertical separators in header and rows", () => {
		const lines = formatTable(["A", "B"], [["1", "2"]], testScheme, "standard");
		expect(lines[1].text).toContain("\u2502"); // │ in header
		expect(lines[3].text).toContain("\u2502"); // │ in row
	});

	it("includes horizontal divider with junctions", () => {
		const lines = formatTable(["A", "B"], [["1", "2"]], testScheme, "standard");
		expect(lines[2].text).toContain("\u2500"); // ─
		expect(lines[2].text).toContain("\u253C"); // ┼ (center junction)
		expect(lines[2].text).toContain("\u251C"); // ├ (left junction)
		expect(lines[2].text).toContain("\u2524"); // ┤ (right junction)
	});

	it("includes top border with corners", () => {
		const lines = formatTable(["A", "B"], [["1", "2"]], testScheme, "standard");
		expect(lines[0].text).toContain("\u250C"); // ┌ (top-left)
		expect(lines[0].text).toContain("\u252C"); // ┬ (top junction)
		expect(lines[0].text).toContain("\u2510"); // ┐ (top-right)
	});

	it("includes bottom border with corners", () => {
		const lines = formatTable(["A", "B"], [["1", "2"]], testScheme, "standard");
		expect(lines[4].text).toContain("\u2514"); // └ (bottom-left)
		expect(lines[4].text).toContain("\u2534"); // ┴ (bottom junction)
		expect(lines[4].text).toContain("\u2518"); // ┘ (bottom-right)
	});

	it("auto-sizes columns to content", () => {
		const lines = formatTable(
			["Short", "VeryLongHeader"],
			[["X", "Y"]],
			testScheme,
			"standard",
		);

		const headerLine = lines[1].text;
		// VeryLongHeader should determine the second column width
		expect(headerLine).toContain("VeryLongHeader");
	});
});

describe("formatTable - density variations", () => {
	it("compact density has no cell padding", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "compact");
		// Structure: top, header, divider, row, bottom
		const headerLine = lines[1].text;
		// Header should be: │A│ (no padding around single char)
		expect(headerLine).toBe("\u2502A\u2502");
	});

	it("standard density has 1-space cell padding", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "standard");
		const headerLine = lines[1].text;
		// Should be: │ A │
		expect(headerLine).toBe("\u2502 A \u2502");
	});

	it("spacious density has 2-space cell padding", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "spacious");
		const headerLine = lines[1].text;
		// Should be: │  A  │
		expect(headerLine).toBe("\u2502  A  \u2502");
	});

	it("divider adjusts for density", () => {
		const compact = formatTable(["A"], [["1"]], testScheme, "compact");
		const spacious = formatTable(["A"], [["1"]], testScheme, "spacious");

		// Spacious should have longer divider due to padding
		expect(spacious[2].text.length).toBeGreaterThan(compact[2].text.length);
	});
});

describe("formatTable - multiple columns and rows", () => {
	it("formats table with multiple columns", () => {
		const lines = formatTable(
			["Name", "Age", "City"],
			[["Alice", "30", "NYC"]],
			testScheme,
			"standard",
		);

		expect(lines[1].text).toContain("Name");
		expect(lines[1].text).toContain("Age");
		expect(lines[1].text).toContain("City");
	});

	it("formats table with multiple rows", () => {
		const lines = formatTable(
			["Name"],
			[["Alice"], ["Bob"], ["Charlie"]],
			testScheme,
			"standard",
		);

		// Structure: top, header, divider, 3 rows, bottom
		expect(lines).toHaveLength(7);
		expect(lines[3].text).toContain("Alice");
		expect(lines[4].text).toContain("Bob");
		expect(lines[5].text).toContain("Charlie");
	});

	it("handles varying cell lengths", () => {
		const lines = formatTable(
			["A"],
			[["short"], ["verylongcontent"]],
			testScheme,
			"standard",
		);

		// Column should size to longest content
		const row1 = lines[3].text;
		const row2 = lines[4].text;
		expect(row1.length).toBe(row2.length); // Both rows same width
	});
});

describe("formatTable - color scheme", () => {
	it("applies header color and bold", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "standard");
		// Base line color is muted (for separators)
		expect(lines[1].color).toBe(testScheme.foreground.muted);
		expect(lines[1].bold).toBe(true);
		
		// Header cell content uses lightened color via spans
		expect(lines[1].spans).toBeDefined();
		const cellSpans = lines[1].spans!.filter(s => s.text.includes("A"));
		expect(cellSpans.length).toBeGreaterThan(0);
		expect(cellSpans[0].color).toBe(lightenHex(testScheme.foreground.default, 0.2));
	});

	it("applies muted color to borders", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "standard");
		expect(lines[0].color).toBe(testScheme.foreground.muted); // top border
		expect(lines[2].color).toBe(testScheme.foreground.muted); // divider
		expect(lines[4].color).toBe(testScheme.foreground.muted); // bottom border
	});

	it("applies default color to data rows", () => {
		const lines = formatTable(["A"], [["1"]], testScheme, "standard");
		// Base line color is muted (for separators)
		expect(lines[3].color).toBe(testScheme.foreground.muted);
		expect(lines[3].bold).toBeUndefined();
		
		// Data cell content uses default color via spans
		expect(lines[3].spans).toBeDefined();
		const cellSpans = lines[3].spans!.filter(s => s.text.includes("1"));
		expect(cellSpans.length).toBeGreaterThan(0);
		expect(cellSpans[0].color).toBe(testScheme.foreground.default);
	});

	it("applies muted color to all separators (vertical bars)", () => {
		const lines = formatTable(["A", "B"], [["1", "2"]], testScheme, "standard");
		
		// Header row separators should be muted
		const headerSeparators = lines[1].spans!.filter(s => s.text === "\u2502");
		expect(headerSeparators.length).toBe(3); // │ A │ B │
		expect(headerSeparators.every(s => s.color === testScheme.foreground.muted)).toBe(true);
		
		// Data row separators should be muted
		const dataSeparators = lines[3].spans!.filter(s => s.text === "\u2502");
		expect(dataSeparators.length).toBe(3); // │ 1 │ 2 │
		expect(dataSeparators.every(s => s.color === testScheme.foreground.muted)).toBe(true);
	});
});

describe("formatTable - edge cases", () => {
	it("handles empty rows", () => {
		const lines = formatTable(["A", "B"], [], testScheme, "standard");
		// Structure: top border, header, divider, bottom border
		expect(lines).toHaveLength(4);
	});

	it("handles empty cells", () => {
		const lines = formatTable(
			["A", "B"],
			[["", "value"]],
			testScheme,
			"standard",
		);

		expect(lines[3].text).toContain("value");
	});

	it("handles null/undefined cells gracefully", () => {
		const lines = formatTable(
			["A"],
			[[undefined as unknown as string]],
			testScheme,
			"standard",
		);

		// Should not crash, treats as empty string
		// Structure: top, header, divider, row, bottom
		expect(lines).toHaveLength(5);
	});
});
