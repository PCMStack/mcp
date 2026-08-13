import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildStartlistXml } from "../helpers";
import { withCdb } from "../cdb";

const outputSchema = z.object({
	fileName: z
		.string()
		.describe(
			"Suggested file name for the startlist, derived from STA_race.gene_sz_filename (e.g. `c0_almeria.xml`)",
		),
	xml: z.string().describe("Generated PCM startlist XML document"),
});

export function registerGenerateStartlistXml(server: McpServer): void {
	server.registerTool(
		"pcm_generate_startlist_xml",
		{
			title: "Generate PCM startlist XML",
			description:
				'Generate a Pro Cycling Manager startlist XML document from a list of teams and their cyclist rosters. Looks up the race in the `.cdb` database by `IDrace` to derive the output file name from `STA_race.gene_sz_filename` (e.g. `c0_almeria.xml`). Returns both the file name and the XML as text. The XML is a `<startlist>` root containing `<team id="N">` elements, each with self-closing `<cyclist id="N" />` children. Team and cyclist IDs map to the PCM `DYN_team.IDteam` and `DYN_cyclist.IDcyclist` columns and can be looked up with `pcm_search_cyclist` or `pcm_query_database`. The number of cyclists per team is free.',
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				raceId: z
					.number()
					.int()
					.describe(
						"Race ID (STA_race.IDrace) used to derive the output file name",
					),
				teams: z
					.array(
						z.object({
							id: z
								.number()
								.int()
								.describe("Team ID (PCM DYN_team.IDteam / fkIDteam)"),
							cyclists: z
								.array(z.number().int())
								.describe(
									"Cyclist IDs (DYN_cyclist.IDcyclist) for this team's roster",
								),
						}),
					)
					.describe(
						"Teams entered in the race, each with its roster of cyclist IDs",
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
		async ({ databasePath, raceId, teams }) =>
			withCdb(databasePath, (db) => {
				const stmt = db.prepare(
					"SELECT gene_sz_filename FROM STA_race WHERE IDrace = :raceId",
				);
				let filenameBase: string;
				try {
					stmt.bind({ ":raceId": raceId });
					if (!stmt.step()) {
						throw new Error(`No race found with IDrace ${raceId} in STA_race.`);
					}
					const value = stmt.getAsObject().gene_sz_filename;
					if (value == null || String(value).length === 0) {
						throw new Error(`Race ${raceId} has no gene_sz_filename.`);
					}
					filenameBase = String(value);
				} finally {
					stmt.free();
				}

				const output: z.infer<typeof outputSchema> = {
					fileName: resolveStartlistFileName(filenameBase),
					xml: buildStartlistXml(teams),
				};
				return output;
			}),
	);
}

/**
 * Resolve the startlist file name for a race from its `STA_race` row.
 *
 * PCM stores the base name in `STA_race.gene_sz_filename` (e.g. `c0_almeria`);
 * the startlist file is that base name with a `.xml` extension.
 */
export function resolveStartlistFileName(filenameBase: string): string {
	return filenameBase.endsWith(".xml") ? filenameBase : `${filenameBase}.xml`;
}
