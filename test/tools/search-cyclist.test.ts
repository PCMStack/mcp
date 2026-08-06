import { beforeEach, describe, expect, it } from "vitest";
import { registerSearchCyclist } from "../../src/tools/search-cyclist";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

describe("searchCyclist", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerSearchCyclist(mcp.server);
	});

	it("registers the pcm_search_cyclist tool", () => {
		expect(mcp.getTool("pcm_search_cyclist")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"finds cyclists by last name for %s",
		async (_, path) => {
			const result = await mcp.callTool("pcm_search_cyclist", {
				databasePath: path,
				lastName: "van der",
			});

			expect(result.structuredContent).toBeDefined();
			expect(result.structuredContent).toMatchSnapshot();
		},
	);

	it("caps results at 10 and flags truncation for a broad search", async () => {
		const result = await mcp.callTool("pcm_search_cyclist", {
			databasePath: databaseFixtures[0][1],
			lastName: "a",
		});

		const output = result.structuredContent as {
			cyclists: unknown[];
			truncated: boolean;
		};
		expect(output.cyclists).toHaveLength(10);
		expect(output.truncated).toBe(true);
	});

	it("returns an error when neither name is provided", async () => {
		const result = await mcp.callTool("pcm_search_cyclist", {
			databasePath: databaseFixtures[0][1],
		});

		expect(result.isError).toBe(true);
	});
});
