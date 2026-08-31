import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerListSaves } from "./list-saves";
import { registerValidateDatabase } from "./validate-database";
import { registerListTables } from "./list-tables";
import { registerGetTableSchema } from "./get-table-schema";
import { registerGetPlayerInfo } from "./get-player-info";
import { registerGetTeamRoster } from "./get-team-roster";
import { registerGetTeamObjectives } from "./get-team-objectives";
import { registerQueryDatabase } from "./query-database";
import { registerUpdateCyclistRatings } from "./update-cyclist-ratings";
import { registerUpdateDatabase } from "./update-database";
import { registerSearchCyclist } from "./search-cyclist";
import { registerGenerateStartlistXml } from "./generate-startlist-xml";
import { registerSearchTeam } from "./search-team";

export function registerTools(server: McpServer): void {
	registerListSaves(server);
	registerValidateDatabase(server);
	registerListTables(server);
	registerGetTableSchema(server);
	registerGetPlayerInfo(server);
	registerGetTeamRoster(server);
	registerGetTeamObjectives(server);
	registerQueryDatabase(server);
	registerUpdateDatabase(server);
	registerUpdateCyclistRatings(server);
	registerSearchCyclist(server);
	registerGenerateStartlistXml(server);
	registerSearchTeam(server);
}
