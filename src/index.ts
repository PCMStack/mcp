import { readFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index";

const { version, description } = JSON.parse(
	readFileSync(join(__dirname, "../package.json"), "utf-8"),
) as { version: string; description: string };

const server = new McpServer({
	name: "pcm-mcp",
	version,
	description,
});

registerTools(server);

async function main() {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("PCM MCP Server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
