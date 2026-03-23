import type { HiseConnection, HiseResponse } from "../engine/hise.js";

export interface CapturedCliCall {
	endpoint: string;
	body: object;
	response: HiseResponse;
}

export class CapturingHiseConnection implements HiseConnection {
	lastPostCall: CapturedCliCall | null = null;

	constructor(private readonly connection: HiseConnection) {}

	async get(endpoint: string): Promise<HiseResponse> {
		return this.connection.get(endpoint);
	}

	async post(endpoint: string, body: object): Promise<HiseResponse> {
		const response = await this.connection.post(endpoint, body);
		this.lastPostCall = { endpoint, body, response };
		return response;
	}

	async probe(): Promise<boolean> {
		return this.connection.probe();
	}

	destroy(): void {
		this.connection.destroy();
	}

	getLastReplResponse(): HiseResponse | null {
		return this.lastPostCall?.endpoint === "/api/repl"
			? this.lastPostCall.response
			: null;
	}
}
