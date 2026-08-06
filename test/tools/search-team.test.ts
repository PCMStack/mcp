import { beforeEach, describe, expect, it } from "vitest";
import { registerSearchTeam } from "../../src/tools/search-team";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

describe("searchTeam", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerSearchTeam(mcp.server);
	});

	it("registers the pcm_search_team tool", () => {
		expect(mcp.getTool("pcm_search_team")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)("finds teams by name for %s", async (_, path) => {
		const result = await mcp.callTool("pcm_search_team", {
			databasePath: path,
			name: "movistar",
		});

		expect(result.structuredContent).toBeDefined();
		expect(result.structuredContent).toMatchSnapshot();
	});

	it("caps results at 10 and flags truncation for a broad search", async () => {
		const result = await mcp.callTool("pcm_search_team", {
			databasePath: databaseFixtures[0][1],
			name: "a",
		});

		const output = result.structuredContent as {
			teams: unknown[];
			truncated: boolean;
		};
		expect(output.teams).toHaveLength(10);
		expect(output.truncated).toBe(true);
	});

	it("returns an error when the name is empty", async () => {
		const result = await mcp.callTool("pcm_search_team", {
			databasePath: databaseFixtures[0][1],
			name: "   ",
		});

		expect(result.isError).toBe(true);
	});
});
