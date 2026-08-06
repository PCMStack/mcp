import { beforeEach, describe, expect, it } from "vitest";
import { registerListTables } from "../../src/tools/list-tables";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";
import { databaseFixtures } from "../fixtures/database.fixture";

describe("listTables", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerListTables(mcp.server);
	});

	it("registers the pcm_list_tables tool", () => {
		expect(mcp.getTool("pcm_list_tables")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"returns every table for %s",
		async (name, path) => {
			const result = await mcp.callTool("pcm_list_tables", {
				databasePath: path,
			});

			expect(result.structuredContent).toBeDefined();
			expect(result.structuredContent).toMatchSnapshot();
		},
	);
});
