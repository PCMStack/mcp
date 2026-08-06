import { beforeEach, describe, expect, it } from "vitest";
import { registerGetTableSchema } from "../../src/tools/get-table-schema";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";
import { databaseFixtures } from "../fixtures/database.fixture";

describe("getTableSchema", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerGetTableSchema(mcp.server);
	});

	it("registers the pcm_get_table_schema tool", () => {
		expect(mcp.getTool("pcm_get_table_schema")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"returns STA_race table schema for %s",
		async (_, path) => {
			const result = await mcp.callTool("pcm_get_table_schema", {
				databasePath: path,
				tableName: "STA_race",
			});

			expect(result.structuredContent).toBeDefined();
			expect(result.structuredContent).toMatchSnapshot();
		},
	);
});
