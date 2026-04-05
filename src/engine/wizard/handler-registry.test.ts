import { describe, expect, it } from "vitest";
import { WizardHandlerRegistry } from "./handler-registry.js";

describe("WizardHandlerRegistry", () => {
	it("registers and retrieves task handlers", () => {
		const registry = new WizardHandlerRegistry();
		const handler = async () => ({ success: true, message: "ok" });
		registry.registerTask("myTask", handler);
		expect(registry.getTask("myTask")).toBe(handler);
	});

	it("returns undefined for missing task handlers", () => {
		const registry = new WizardHandlerRegistry();
		expect(registry.getTask("nonexistent")).toBeUndefined();
	});

	it("registers and retrieves init handlers", () => {
		const registry = new WizardHandlerRegistry();
		const handler = async () => ({ key: "value" });
		registry.registerInit("myInit", handler);
		expect(registry.getInit("myInit")).toBe(handler);
	});

	it("returns undefined for missing init handlers", () => {
		const registry = new WizardHandlerRegistry();
		expect(registry.getInit("nonexistent")).toBeUndefined();
	});
});
