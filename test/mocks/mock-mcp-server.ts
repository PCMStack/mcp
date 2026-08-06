import type { MockInstance } from "vitest";
import { vi } from "vitest";
import {
	McpServer,
	type ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";

interface RegisteredTool {
	name: string;
	config: any;
	callback: ToolCallback<any>;
}

export interface MockMcpServer {
	/** The object to pass where an `McpServer` is expected. */
	server: McpServer;
	/** Vitest spy behind `server.registerTool`, for call assertions. */
	registerTool: MockInstance<McpServer["registerTool"]>;
	/** Every tool registered so far, in registration order. */
	tools: RegisteredTool[];
	/** Look up a registered tool by its name. */
	getTool(name: string): RegisteredTool | undefined;
	/** Invoke a registered tool's callback by name. */
	callTool(
		name: string,
		args: Record<string, unknown>,
	): ReturnType<ToolCallback<any>>;
}

/**
 * Build a fake `McpServer` for unit tests. Only `registerTool` is implemented;
 * it records each registration so tests can inspect the config or invoke the
 * tool callback directly.
 *
 * @example
 * const mcp = createMockMcpServer();
 * registerGetTableSchema(mcp.server);
 * const result = await mcp.callTool("pcm_get_table_schema", { databasePath, tableName });
 */
export function createMockMcpServer(): MockMcpServer {
	const tools: RegisteredTool[] = [];

	// A real `McpServer`, so no cast is needed to satisfy the tool
	// registration functions. Only `registerTool` is exercised; spying on it
	// records each registration and suppresses the real side effects.
	const server = new McpServer({ name: "mock", version: "0.0.0" });

	const registerTool = vi
		.spyOn(server, "registerTool")
		.mockImplementation((name, config, callback) => {
			tools.push({
				name,
				config,
				callback: callback as ToolCallback<any>,
			});
			return {} as ReturnType<McpServer["registerTool"]>;
		});

	const getTool = (name: string) => tools.find((t) => t.name === name);

	const callTool = (name: string, args: Record<string, unknown>) => {
		const tool = getTool(name);
		if (!tool) {
			throw new Error(
				`Tool "${name}" was not registered. Registered: ${
					tools.map((t) => t.name).join(", ") || "(none)"
				}`,
			);
		}
		// The second arg is the RequestHandlerExtra, unused by these tools.
		return tool.callback(args as never, {} as any);
	};

	return { server, registerTool, tools, getTool, callTool };
}
