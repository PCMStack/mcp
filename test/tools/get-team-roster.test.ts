import { beforeEach, describe, expect, it } from "vitest";
import { registerGetTeamRoster } from "../../src/tools/get-team-roster";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

describe("getTeamRoster", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerGetTeamRoster(mcp.server);
	});

	it("registers the pcm_get_team_roster tool", () => {
		expect(mcp.getTool("pcm_get_team_roster")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"returns the roster for a given team for %s",
		async (_, path) => {
			const result = await mcp.callTool("pcm_get_team_roster", {
				databasePath: path,
				teamId: 1,
			});

			expect(result.structuredContent).toBeDefined();
			expect(result.structuredContent).toMatchSnapshot();
		},
	);

	it("returns an error for an unknown team", async () => {
		const result = await mcp.callTool("pcm_get_team_roster", {
			databasePath: databaseFixtures[0][1],
			teamId: 999999,
		});

		expect(result.isError).toBe(true);
	});
});
