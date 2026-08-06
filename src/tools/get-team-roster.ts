import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mapRatings, ratingsColumns, ratingsSchema } from "../schemas/cyclist";
import { ageFromYmd } from "../helpers";
import { getGameDate, getTableColumnNames, withCdb } from "../cdb";

const cyclistSchema = z.object({
	id: z.number().describe("Cyclist ID (IDcyclist)"),
	firstName: z.string().describe("First name (gene_sz_firstname)"),
	lastName: z.string().describe("Last name (gene_sz_lastname)"),
	country: z
		.string()
		.nullable()
		.describe("Country name (STA_country.gene_sz_flag), e.g. `France`"),
	age: z
		.number()
		.nullable()
		.describe(
			"Age in years, derived from gene_i_birthdate and the current game date (GAM_config.gene_i_date). Null when the birth date is missing.",
		),
	type: z
		.string()
		.nullable()
		.describe(
			"Rider type key (STA_type_rider.CONSTANT via fkIDtype_rider), e.g. sprint, mountain, tour, timetrial, flat, ardennaises, flandriennes. Null when unset.",
		),
	overall: z
		.number()
		.nullable()
		.describe(
			"Overall ability (value_f_current_ability) — null on databases that pre-date this column.",
		),
	contractEndYear: z
		.number()
		.nullable()
		.describe(
			"Year the active contract ends (DYN_contract_cyclist.iYearEnd). Null when no active contract is found.",
		),
	wage: z
		.number()
		.nullable()
		.describe(
			"Salary for the contract period (DYN_contract_cyclist.finan_i_period_wage). Null when no active contract is found.",
		),
	value: z
		.number()
		.nullable()
		.describe(
			"Market value (value_f_capital) — null on databases that pre-date this column.",
		),
	...ratingsSchema.shape,
});

const outputSchema = z.object({
	teamId: z.number().describe("Team ID the roster belongs to (IDteam)"),
	cyclists: z
		.array(cyclistSchema)
		.describe("Roster cyclists, ordered by overall ability (highest first)"),
});

export function registerGetTeamRoster(server: McpServer): void {
	server.registerTool(
		"pcm_get_team_roster",
		{
			title: "Get PCM team roster",
			description:
				"List the roster of a team in a Pro Cycling Manager `.cdb` database. Defaults to the active human player's team (GAM_user.game_i_active = 1) when `teamId` is omitted. Joins DYN_cyclist with its active DYN_contract_cyclist and STA_type_rider, and for each cyclist returns name, country, age, rider type, overall ability (note globale), contract end year, wage, market value and all per-terrain ability ratings (plain, mountain, medium mountain, downhilling, cobble, time trial, prologue, sprint, acceleration, endurance, resistance, recuperation, hill, baroudeur). Ordered by overall ability, highest first.",
			inputSchema: {
				databasePath: z
					.string()
					.describe("Absolute path to the .cdb database file"),
				teamId: z
					.number()
					.int()
					.optional()
					.describe(
						"Team ID (IDteam) whose roster to list. Defaults to the active player's team when omitted.",
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
		async ({ databasePath, teamId }) =>
			withCdb(databasePath, (db, file) => {
				// Resolve the target team: explicit teamId, else the active player's team.
				let resolvedTeamId = teamId;
				if (resolvedTeamId == null) {
					const teamResult = db.exec(
						"SELECT fkIDteam_duplicate FROM GAM_user WHERE game_i_active = 1",
					);
					const value = teamResult[0]?.values?.[0]?.[0];
					if (value == null) {
						throw new Error(
							`No active player (game_i_active = 1) found in ${file.name}; pass teamId explicitly.`,
						);
					}
					resolvedTeamId = Number(value);
				}

				const teamStmt = db.prepare(
					"SELECT 1 FROM DYN_team WHERE IDteam = :teamId LIMIT 1",
				);
				try {
					teamStmt.bind({ ":teamId": resolvedTeamId });
					if (!teamStmt.step()) {
						throw new Error(
							`Team ${resolvedTeamId} not found in ${file.name}.`,
						);
					}
				} finally {
					teamStmt.free();
				}

				// The current in-game date (YYYYMMDD) is the reference point for age.
				const currentYmd = getGameDate(db);

				const columnNames = getTableColumnNames(db, "DYN_cyclist");
				const hasCurrentAbility = columnNames.has("value_f_current_ability");
				const hasCapital = columnNames.has("value_f_capital");
				const hasMediumMountain = columnNames.has("charac_i_medium_mountain");

				const stmt = db.prepare(
					`SELECT
						c.IDcyclist                AS id,
						c.gene_sz_firstname        AS firstName,
						c.gene_sz_lastname         AS lastName,
						c.gene_i_birthdate         AS birthdate,
						${hasCurrentAbility ? "c.value_f_current_ability" : "NULL"} AS overall,
						${hasCapital ? "c.value_f_capital" : "NULL"} AS value,
						tr.CONSTANT                AS type,
						ct.iYearEnd                AS contractEndYear,
						ct.finan_i_period_wage     AS wage,
						co.gene_sz_flag            AS country,
						${ratingsColumns(hasMediumMountain)}
					FROM DYN_cyclist c
					LEFT JOIN STA_type_rider tr ON c.fkIDtype_rider = tr.IDtype_rider
					LEFT JOIN STA_region r    ON c.fkIDregion = r.IDregion
					LEFT JOIN STA_country co  ON r.fkIDcountry = co.IDcountry
					LEFT JOIN DYN_contract_cyclist ct
						ON ct.fkIDcyclist = c.IDcyclist AND ct.gene_b_active_contract = 1
					WHERE c.fkIDteam = :teamId
					ORDER BY overall DESC, c.gene_sz_lastname ASC`,
				);

				const cyclists: z.infer<typeof cyclistSchema>[] = [];
				try {
					stmt.bind({ ":teamId": resolvedTeamId });
					while (stmt.step()) {
						const row = stmt.getAsObject();
						const rawBirthdate =
							row.birthdate != null ? Number(row.birthdate) : null;
						const birthdate =
							rawBirthdate != null && rawBirthdate >= 10000000
								? rawBirthdate
								: null;
						cyclists.push({
							id: Number(row.id),
							firstName: String(row.firstName),
							lastName: String(row.lastName),
							country: row.country != null ? String(row.country) : null,
							age:
								currentYmd != null && birthdate != null
									? ageFromYmd(currentYmd, birthdate)
									: null,
							type: row.type != null ? String(row.type) : null,
							overall: row.overall != null ? Number(row.overall) : null,
							contractEndYear:
								row.contractEndYear != null
									? Number(row.contractEndYear)
									: null,
							wage: row.wage != null ? Number(row.wage) : null,
							value: row.value != null ? Number(row.value) : null,
							...mapRatings(row),
						});
					}
				} finally {
					stmt.free();
				}

				const output: z.infer<typeof outputSchema> = {
					teamId: resolvedTeamId,
					cyclists,
				};
				return output;
			}),
	);
}
