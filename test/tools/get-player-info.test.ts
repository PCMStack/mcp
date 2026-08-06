import { beforeEach, describe, expect, it } from "vitest";
import { registerGetPlayerInfo } from "../../src/tools/get-player-info";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

describe("getPlayerInfo", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerGetPlayerInfo(mcp.server);
	});

	it("registers the pcm_get_player_info tool", () => {
		expect(mcp.getTool("pcm_get_player_info")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	// The official-release fixtures are databases, not played careers, so they
	// have no active human player (GAM_user.game_i_active = 1). The tool should
	// surface that as a graceful error rather than throwing.
	it.each(databaseFixtures)(
		"errors when there is no active player for %s",
		async (name, path) => {
			const result = await mcp.callTool("pcm_get_player_info", {
				databasePath: path,
			});

			expect(result.isError).toBe(true);
		},
	);
});
