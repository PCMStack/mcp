import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { withCdb } from "../cdb";

const teamSchema = z.object({
	id: z.number().describe("Team ID (IDteam)"),
	name: z.string().describe("Team name (gene_sz_name)"),
	shortName: z.string().describe("Team short name (gene_sz_shortname)"),
	division: z
		.string()
		.nullable()
		.describe("Division name (STA_division.CONSTANT via fkIDdivision)"),
	country: z
		.string()
		.nullable()
		.describe("Country name (STA_country.gene_sz_flag via fkIDcountry)"),
	evaluation: z
		.number()
		.describe("Team current evaluation (value_f_current_evaluation)"),
	manager: z
		.string()
		.describe("General manager name (gene_sz_manager_general)"),
});

const MAX_RESULTS = 10;

const outputSchema = z.object({
	teams: z.array(teamSchema).describe("Matching teams"),
	truncated: z
		.boolean()
		.describe(
			`Whether more matches exist beyond the ${MAX_RESULTS} returned — narrow the search with a longer name to see them`,
		),
});

export function registerSearchTeam(server: McpServer): void {
	server.registerTool(
		"pcm_search_team",
		{
			title: "Search PCM team by name",
			description: `Search for a team in a Pro Cycling Manager \`.cdb\` database by name (case-insensitive partial match against both the full name and the short name). Returns up to ${MAX_RESULTS} matching teams with their division name, country name, evaluation and general manager; \`truncated\` is true when more matches exist beyond the ${MAX_RESULTS} returned.`,
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				name: z
					.string()
					.describe(
						"Team name to search for (partial match, case-insensitive)",
					),
			},
			outputSchema,
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
		},
		async ({ databasePath, name }) =>
			withCdb(databasePath, (db) => {
				const stmt = db.prepare(
					`SELECT
						t.IDteam AS id,
						t.gene_sz_name AS name,
						t.gene_sz_shortname AS shortName,
						d.CONSTANT AS division,
						c.gene_sz_flag AS country,
						t.value_f_current_evaluation AS evaluation,
						t.gene_sz_manager_general AS manager
					FROM DYN_team t
					LEFT JOIN STA_division d ON t.fkIDdivision = d.IDdivision
					LEFT JOIN STA_country c ON t.fkIDcountry = c.IDcountry
					WHERE LOWER(t.gene_sz_name)      LIKE LOWER(:name)
					   OR LOWER(t.gene_sz_shortname) LIKE LOWER(:name)
					ORDER BY t.gene_sz_name, t.IDteam
					LIMIT ${MAX_RESULTS + 1}`,
				);

				const teams: z.infer<typeof teamSchema>[] = [];
				let truncated = false;
				try {
					const query = name.trim();
					if (query.length === 0) {
						throw new Error("Provide a non-empty name to search for.");
					}

					stmt.bind({ ":name": `%${query}%` });

					while (stmt.step()) {
						if (teams.length >= MAX_RESULTS) {
							truncated = true;
							break;
						}
						const row = stmt.getAsObject();
						teams.push({
							id: Number(row.id),
							name: String(row.name),
							shortName: String(row.shortName),
							division: row.division != null ? String(row.division) : null,
							country: row.country != null ? String(row.country) : null,
							evaluation: Number(row.evaluation),
							manager: String(row.manager),
						});
					}
				} finally {
					stmt.free();
				}

				const output: z.infer<typeof outputSchema> = {
					teams,
					truncated,
				};
				return output;
			}),
	);
}
