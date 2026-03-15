// ── TapeCommand — VHS-derived screencast format ─────────────────────

// VHS command vocabulary (https://github.com/charmbracelet/vhs) extended
// with Expect, Snapshot, and Annotation for testing and documentation.

export type TapeCommand =
	| OutputCommand
	| SetCommand
	| TypeCommand
	| KeyCommand
	| SleepCommand
	| WaitCommand
	| ExpectCommand
	| SnapshotCommand
	| AnnotationCommand
	| HideCommand
	| ShowCommand;

export interface OutputCommand {
	type: "Output";
	path: string;
}

export interface SetCommand {
	type: "Set";
	key: SetKey;
	value: string;
}

export type SetKey =
	| "Shell"
	| "FontSize"
	| "Width"
	| "Height"
	| "TypingSpeed"
	| "Theme"
	| "Padding"
	| "Framerate"
	| "PlaybackSpeed"
	| "LetterSpacing"
	| "LineHeight"
	| "CursorBlink"
	| "WindowBar"
	| "WindowBarSize"
	| "BorderRadius"
	| "Margin"
	| "MarginFill";

export interface TypeCommand {
	type: "Type";
	text: string;
	speed?: number;
}

export interface KeyCommand {
	type: "Key";
	key: string;
	count?: number;
}

export interface SleepCommand {
	type: "Sleep";
	duration: number;
	unit: "ms" | "s";
}

export interface WaitCommand {
	type: "Wait";
	pattern: string;
	timeout?: number;
}

// ── hise-cli extensions ─────────────────────────────────────────────

export interface ExpectCommand {
	type: "Expect";
	pattern: string;
	region?: "output" | "topbar" | "statusbar" | "input";
}

export interface SnapshotCommand {
	type: "Snapshot";
	name: string;
}

export interface AnnotationCommand {
	type: "Annotation";
	text: string;
	duration?: number;
}

export interface HideCommand {
	type: "Hide";
}

export interface ShowCommand {
	type: "Show";
}
