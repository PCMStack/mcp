import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mapRatings, ratingsColumns, ratingsSchema } from "../schemas/cyclist";
import { getTableColumnNames, withCdb } from "../cdb";

const cyclistSchema = z.object({
	id: z.number().describe("Cyclist ID (IDcyclist)"),
	firstName: z.string().describe("First name (gene_sz_firstname)"),
	lastName: z.string().describe("Last name (gene_sz_lastname)"),
	country: z
		.string()
		.nullable()
		.describe("Country name (STA_country.gene_sz_flag), e.g. `France`"),
	...ratingsSchema.shape,
	currentAbility: z
		.number()
		.nullable()
		.describe(
			"Current ability (value_f_current_ability) — null on databases that pre-date this column",
		),
});

const MAX_RESULTS = 10;

const outputSchema = z.object({
	cyclists: z.array(cyclistSchema).describe("Matching cyclists"),
	truncated: z
		.boolean()
		.describe(
			`Whether more matches exist beyond the ${MAX_RESULTS} returned — narrow the search with a longer name to see them`,
		),
});

export function registerSearchCyclist(server: McpServer): void {
	server.registerTool(
		"pcm_search_cyclist",
		{
			title: "Search PCM cyclist by name",
			description: `Search for a cyclist in a Pro Cycling Manager \`.cdb\` database by first name and/or last name (case-insensitive partial match). Returns up to ${MAX_RESULTS} matching cyclists with all their ratings and their country name; \`truncated\` is true when more matches exist beyond the ${MAX_RESULTS} returned.`,
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				firstName: z
					.string()
					.optional()
					.describe(
						"First name to search for (partial match, case-insensitive)",
					),
				lastName: z
					.string()
					.optional()
					.describe(
						"Last name to search for (partial match, case-insensitive)",
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
		async ({ databasePath, firstName = "", lastName = "" }) =>
			withCdb(databasePath, (db) => {
				const columnNames = getTableColumnNames(db, "DYN_cyclist");
				const hasMediumMountain = columnNames.has("charac_i_medium_mountain");
				const hasCurrentAbility = columnNames.has("value_f_current_ability");

				const stmt = db.prepare(
					`SELECT
						c.IDcyclist,
						c.gene_sz_firstname,
						c.gene_sz_lastname,
						${ratingsColumns(hasMediumMountain)},
						${hasCurrentAbility ? "c.value_f_current_ability" : "NULL"} AS currentAbility,
						co.gene_sz_flag            AS country
					FROM DYN_cyclist c
					LEFT JOIN STA_region r   ON c.fkIDregion = r.IDregion
					LEFT JOIN STA_country co ON r.fkIDcountry = co.IDcountry
					WHERE LOWER(c.gene_sz_lastname)  LIKE LOWER(:lastName)
					  AND LOWER(c.gene_sz_firstname) LIKE LOWER(:firstName)
					ORDER BY c.gene_sz_lastname, c.gene_sz_firstname, c.IDcyclist
					LIMIT ${MAX_RESULTS + 1}`,
				);

				const cyclists: z.infer<typeof cyclistSchema>[] = [];
				let truncated = false;
				try {
					const first = firstName.trim();
					const last = lastName.trim();
					if (first.length === 0 && last.length === 0) {
						throw new Error("Provide at least one of firstName or lastName.");
					}

					stmt.bind({
						":lastName": `%${last}%`,
						":firstName": `%${first}%`,
					});

					while (stmt.step()) {
						if (cyclists.length >= MAX_RESULTS) {
							truncated = true;
							break;
						}
						const row = stmt.getAsObject();
						cyclists.push({
							id: Number(row.IDcyclist),
							firstName: String(row.gene_sz_firstname),
							lastName: String(row.gene_sz_lastname),
							country: row.country != null ? String(row.country) : null,
							...mapRatings(row),
							currentAbility:
								row.currentAbility != null ? Number(row.currentAbility) : null,
						});
					}
				} finally {
					stmt.free();
				}

				const output: z.infer<typeof outputSchema> = {
					cyclists,
					truncated,
				};
				return output;
			}),
	);
}
