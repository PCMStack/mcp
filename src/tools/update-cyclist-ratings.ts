import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	mapRatings,
	type RatingField,
	ratingColumns,
	ratingsColumns,
	ratingsSchema,
} from "../schemas/cyclist";
import { getTableColumnNames, withCdb, writeCdb } from "../cdb";

const ratingValue = z.number().int().min(50).max(85);

const newRatingsSchema = z.object({
	plain: ratingValue.optional().describe("New plain rating (charac_i_plain)"),
	mountain: ratingValue
		.optional()
		.describe("New mountain rating (charac_i_mountain)"),
	mediumMountain: ratingValue
		.optional()
		.describe(
			"New medium mountain rating (charac_i_medium_mountain) — rejected on databases that pre-date this column",
		),
	downhilling: ratingValue
		.optional()
		.describe("New downhilling rating (charac_i_downhilling)"),
	cobble: ratingValue
		.optional()
		.describe("New cobblestone rating (charac_i_cobble)"),
	timeTrial: ratingValue
		.optional()
		.describe("New time trial rating (charac_i_timetrial)"),
	prologue: ratingValue
		.optional()
		.describe("New prologue rating (charac_i_prologue)"),
	sprint: ratingValue
		.optional()
		.describe("New sprint rating (charac_i_sprint)"),
	acceleration: ratingValue
		.optional()
		.describe("New acceleration rating (charac_i_acceleration)"),
	endurance: ratingValue
		.optional()
		.describe("New endurance rating (charac_i_endurance)"),
	resistance: ratingValue
		.optional()
		.describe("New resistance rating (charac_i_resistance)"),
	recuperation: ratingValue
		.optional()
		.describe("New recuperation rating (charac_i_recuperation)"),
	hill: ratingValue.optional().describe("New hill rating (charac_i_hill)"),
	baroudeur: ratingValue
		.optional()
		.describe("New baroudeur rating (charac_i_baroudeur)"),
});

const outputSchema = z.object({
	outputPath: z
		.string()
		.describe("Absolute path of the modified .cdb database that was written"),
	cyclist: z
		.object({
			id: z.number().describe("Cyclist ID (IDcyclist)"),
			firstName: z.string().describe("First name (gene_sz_firstname)"),
			lastName: z.string().describe("Last name (gene_sz_lastname)"),
			...ratingsSchema.shape,
		})
		.describe("The cyclist with their full ratings after the update"),
});

export function registerUpdateCyclistRatings(server: McpServer): void {
	server.registerTool(
		"pcm_update_cyclist_ratings",
		{
			title: "Update a cyclist's ratings (writes a new .cdb)",
			description:
				"Change one or more ability ratings of a cyclist in a Pro Cycling Manager `.cdb` database and write the result to a NEW `.cdb` file. The source database is never modified: the edited database is serialized to `outputPath`, which must differ from `databasePath`. Only the ratings passed in `ratings` are changed; the cyclist's full ratings after the update are returned. Use `pcm_search_cyclist` to find the cyclist's ID first.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the source .cdb database file"),
				outputPath: z
					.string()
					.describe(
						"Absolute path of the .cdb file to write the modified database to. Must differ from databasePath, sit in an existing directory, and not already exist (existing files are never overwritten).",
					),
				cyclistId: z
					.number()
					.int()
					.describe(
						"ID of the cyclist to modify (DYN_cyclist.IDcyclist — find it with pcm_search_cyclist)",
					),
				ratings: newRatingsSchema.describe(
					"Ratings to change (50–85). Only the fields provided are updated; the others keep their current value.",
				),
			},
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: false,
			},
		},
		async ({ databasePath, outputPath, cyclistId, ratings }) =>
			withCdb(
				databasePath,
				async (db, file) => {
					const changes = Object.entries(ratings).filter(
						([, value]) => value !== undefined,
					) as [RatingField, number][];
					if (changes.length === 0) {
						throw new Error(
							"Provide at least one rating to change in `ratings`.",
						);
					}

					const hasMediumMountain = getTableColumnNames(db, "DYN_cyclist").has(
						"charac_i_medium_mountain",
					);
					if (!hasMediumMountain && ratings.mediumMountain !== undefined) {
						throw new Error(
							"This database pre-dates the charac_i_medium_mountain column — mediumMountain cannot be set on it.",
						);
					}

					const setClause = changes
						.map(([field]) => `${ratingColumns[field]} = ?`)
						.join(", ");
					db.run(`UPDATE DYN_cyclist SET ${setClause} WHERE IDcyclist = ?`, [
						...changes.map(([, value]) => value),
						cyclistId,
					]);

					if (db.getRowsModified() === 0) {
						const check = db.prepare(
							"SELECT 1 FROM DYN_cyclist WHERE IDcyclist = ? LIMIT 1",
						);
						try {
							check.bind([cyclistId]);
							if (!check.step()) {
								throw new Error(
									`No cyclist with IDcyclist = ${cyclistId} in this database — use pcm_search_cyclist to find the right ID.`,
								);
							}
						} finally {
							check.free();
						}
					}

					const stmt = db.prepare(
						`SELECT
							c.gene_sz_firstname,
							c.gene_sz_lastname,
							${ratingsColumns(hasMediumMountain)}
						FROM DYN_cyclist c
						WHERE c.IDcyclist = :id`,
					);
					let cyclist: z.infer<typeof outputSchema>["cyclist"];
					try {
						stmt.bind({ ":id": cyclistId });
						stmt.step();
						const row = stmt.getAsObject();
						cyclist = {
							id: cyclistId,
							firstName: String(row.gene_sz_firstname),
							lastName: String(row.gene_sz_lastname),
							...mapRatings(row),
						};
					} finally {
						stmt.free();
					}

					const written = await writeCdb(db, outputPath, file.path);

					const output: z.infer<typeof outputSchema> = {
						outputPath: written,
						cyclist,
					};
					return output;
				},
				{ queryOnly: false },
			),
	);
}
