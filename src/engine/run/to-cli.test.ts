import { describe, expect, it } from "vitest";
import { translateHscToCli } from "./to-cli.js";

describe("translateHscToCli", () => {
	it("translates dsp host selection and cwd-only add parents", () => {
		const source = [
			"#!/usr/bin/env hise-cli run",
			"# graph",
			"/dsp",
			"cd CabMicSelector",
			"add container.multi as \"PairSplit\"",
			"cd PairSplit",
			"add container.chain as \"SelectedPair\"",
			"set SelectedPair.Folded true",
		].join("\n");

		const result = translateHscToCli(source);

		expect(result.lines).toEqual([
			"#!/usr/bin/env bash",
			"# graph",
			"# hsc-context: /dsp",
			"# hsc-context: cd CabMicSelector",
			"hise-cli dsp add --module CabMicSelector --type container.multi --id PairSplit",
			"# hsc-context: cd PairSplit",
			"hise-cli dsp add --module CabMicSelector --type container.chain --id SelectedPair --parent PairSplit",
			"hise-cli dsp set --module CabMicSelector --node SelectedPair --param Folded --value true",
		]);
	});

	it("fans out chained commands into clean direct CLI invocations", () => {
		const source = [
			"/builder",
			"set A.bypassed true, B.bypassed true",
			"/exit",
		].join("\n");

		const result = translateHscToCli(source);

		expect(result.lines).toEqual([
			"# hsc-context: /builder",
			"hise-cli builder set --module A --bypassed true",
			"hise-cli builder set --module B --bypassed true",
			"# hsc-context: /exit",
		]);
	});

	it("serializes DSP complex data assignments", () => {
		const source = [
			"/dsp",
			"cd ScriptFX1",
			"set_complex_data Env.Table index 3, Lfo.SliderPack.1 index -1",
		].join("\n");

		const result = translateHscToCli(source);

		expect(result.lines).toEqual([
			"# hsc-context: /dsp",
			"# hsc-context: cd ScriptFX1",
			"hise-cli dsp set-complex-data --module ScriptFX1 --node Env --type Table --index 3",
			"hise-cli dsp set-complex-data --module ScriptFX1 --node Lfo --type SliderPack --slot 1 --index -1",
		]);
	});
});
