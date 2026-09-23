import type { Server } from "node:http";

export interface ResearchServerOptions {
	port?: number;
	openBrowser?: boolean;
	docsUrl?: string;
	siteUrl?: string;
	silent?: boolean;
}

export function launchResearchServer(options?: ResearchServerOptions): Promise<Server>;
