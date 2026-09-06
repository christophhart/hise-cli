import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { registerBunOAuthFlows as registerAgentOAuthFlows } from "../../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/bun-oauth.js";

let registered = false;

/** Register OAuth flows statically so bundled builds resolve Codex auth. */
export function registerPiOAuthFlows(): void {
	if (registered) return;
	registerBunOAuthFlows();
	// The published coding-agent package currently carries an isolated pi-ai
	// runtime. Register its static OAuth loaders too for standalone Bun builds.
	registerAgentOAuthFlows();
	registered = true;
}
