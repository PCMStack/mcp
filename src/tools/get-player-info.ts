import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withCdb } from "../cdb";

const outputSchema = z.object({
	login: z.string().describe("Player login (game_sz_login)"),
	teamId: z.number().describe("Team ID (IDteam)"),
	teamName: z.string().describe("Team name (gene_sz_name)"),
	teamShortName: z.string().describe("Team short name (gene_sz_shortname)"),
	division: z
		.string()
		.describe("Current division name (STA_division.CONSTANT via fkIDdivision)"),
	nextDivision: z
		.string()
		.describe(
			"Next season division name (STA_division.CONSTANT via fkIDnextdivision)",
		),
	country: z
		.string()
		.describe("Country name (STA_country.gene_sz_flag via fkIDcountry)"),
	evaluation: z
		.number()
		.describe("Team current evaluation (value_f_current_evaluation)"),
	manager: z
		.string()
		.describe("General manager name (gene_sz_manager_general)"),
});

export function registerGetPlayerInfo(server: McpServer): void {
	server.registerTool(
		"pcm_get_player_info",
		{
			title: "Get PCM player info",
			description:
				"Get the active human player and their team from a Pro Cycling Manager `.cdb` database. Joins GAM_user (game_i_active = 1) with DYN_team, STA_division (current and next), and STA_country to return the player login plus team details (name, division name, country name, evaluation and manager).",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
			},
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ databasePath }) =>
			withCdb(databasePath, (db, file) => {
				const stmt = db.prepare(
					`SELECT
						u.game_sz_login AS login,
						t.IDteam AS teamId,
						t.gene_sz_name AS teamName,
						t.gene_sz_shortname AS teamShortName,
						d.CONSTANT AS division,
						nd.CONSTANT AS nextDivision,
						c.gene_sz_flag AS country,
						t.value_f_current_evaluation AS evaluation,
						t.gene_sz_manager_general AS manager
					FROM GAM_user u
					JOIN DYN_team t ON u.fkIDteam_duplicate = t.IDteam
					JOIN STA_division d ON t.fkIDdivision = d.IDdivision
					JOIN STA_division nd ON t.fkIDnextdivision = nd.IDdivision
					JOIN STA_country c ON t.fkIDcountry = c.IDcountry
					WHERE u.game_i_active = 1`,
				);

				let row: Record<string, unknown>;
				try {
					if (!stmt.step()) {
						throw new Error(
							`No active player (game_i_active = 1) found in ${file.name}.`,
						);
					}
					row = stmt.getAsObject();
				} finally {
					stmt.free();
				}

				const output: z.infer<typeof outputSchema> = {
					login: String(row.login),
					teamId: Number(row.teamId),
					teamName: String(row.teamName),
					teamShortName: String(row.teamShortName),
					division: String(row.division),
					nextDivision: String(row.nextDivision),
					country: String(row.country),
					evaluation: Number(row.evaluation),
					manager: String(row.manager),
				};

				return output;
			}),
	);
}
