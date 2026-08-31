import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	type CdbDatabase,
	getGameDate,
	getTableColumnNames,
	withCdb,
} from "../cdb";
import { getCareerValue, stageDate } from "../helpers";

const objectiveSchema = z.object({
	id: z.number().describe("Objective ID (DYN_objectif.IDobjectif)"),
	type: z
		.string()
		.describe(
			"Objective type key (STA_objectif_type.CONSTANT via fkIDobjectif_type), e.g. WIN, TOP_3, TOP_10, MAILLOT_SPRINTER, STAGE_WIN_1, PARTICIPATION, EFFECTIF, VISIBILITY_5.",
		),
	achievedType: z
		.string()
		.nullable()
		.describe(
			"Best result actually achieved so far, as an objective type key (STA_objectif_type.CONSTANT via fkIDobjectif_type_achieved). Null while the objective is still open or unrated.",
		),
	status: z
		.enum(["ACHIEVED", "PARTIAL", "FAILED", "IN_PROGRESS"])
		.describe(
			'Where the objective stands, from comparing STA_objectif_type.gene_i_coeff (higher coefficient = harder result) between target and achieved type, and the race dates against the current game date. "ACHIEVED": the achieved result is at least as good as the target. "PARTIAL": the race is over and something was achieved, but short of the target (e.g. a top 5 when the target was the win). "FAILED": the race is over with nothing achieved. "IN_PROGRESS": the race has not finished yet, or carries no date to tell.',
		),
	raceId: z
		.number()
		.nullable()
		.describe(
			"Race ID the objective is about (fkIDrace). Null when not race-specific.",
		),
	raceName: z
		.string()
		.nullable()
		.describe(
			"Race name (STA_race.gene_sz_race_name). Null when not race-specific.",
		),
	startDate: z
		.string()
		.nullable()
		.describe(
			"Date of the race's first stage as YYYY-MM-DD, when the objective is race-specific. Null otherwise.",
		),
	endDate: z
		.string()
		.nullable()
		.describe(
			"Date of the race's last stage as YYYY-MM-DD — same as startDate for a one-day race. Null when not race-specific.",
		),
	achievedByCyclistId: z
		.number()
		.nullable()
		.describe(
			"Cyclist ID of the rider who produced the achieved result (fkIDcyclist).",
		),
	achievedByCyclistName: z
		.string()
		.nullable()
		.describe("Name of the rider who produced the achieved result."),
	difficulty: z
		.number()
		.nullable()
		.describe(
			"Difficulty rating (value_i_difficulty) — null on databases that pre-date this column.",
		),
});

const seasonObjectiveSchema = z.object({
	type: z
		.string()
		.describe(
			'Season objective key: "WINS" (number of victories the team must collect over the season) or "RANKING" (position the team must reach in the ranking).',
		),
	target: z
		.number()
		.describe(
			"Target value: a number of wins for WINS, a ranking position for RANKING (lower is better).",
		),
	current: z
		.number()
		.nullable()
		.describe(
			"Where the team stands right now — wins collected so far for WINS, current ranking position for RANKING. Null before the game has computed any ranking.",
		),
	achieved: z
		.boolean()
		.describe(
			"Whether `current` already meets `target` (at least, for WINS; at most, for RANKING). False while `current` is unknown.",
		),
});

const outputSchema = z.object({
	teamId: z
		.number()
		.describe("Team ID of the active human player (IDteam), for reference"),
	season: z
		.number()
		.nullable()
		.describe(
			"Season year the objectives belong to, from the current game date (GAM_config.gene_i_date). Null on a database that has never been played.",
		),
	objectives: z
		.array(objectiveSchema)
		.describe(
			"Race objectives in calendar order, earliest race first; objectives with no dated race come last.",
		),
	seasonObjectives: z
		.array(seasonObjectiveSchema)
		.describe(
			"Season-long objectives, which are not tied to a race: wins to collect over the season and ranking position to reach. Empty on editions that pre-date them or when the sponsors set none.",
		),
});

export function registerGetTeamObjectives(server: McpServer): void {
	server.registerTool(
		"pcm_get_team_objectives",
		{
			title: "Get PCM team season objectives",
			description:
				"List the objectives the sponsors set for the human player's team in a Pro Cycling Manager `.cdb` database. `objectives` holds the race objectives, earliest race first: target type, race with its dates, difficulty, and the result achieved so far with the rider who produced it. `seasonObjectives` holds the season-long ones recent editions add — wins to collect and ranking position to reach — with the team's current standing. Objectives only exist in a played career — an unplayed official release returns empty lists.",
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
				const teamResult = db.exec(
					"SELECT fkIDteam_duplicate FROM GAM_user WHERE game_i_active = 1",
				);
				const teamId = teamResult[0]?.values?.[0]?.[0];
				if (teamId == null) {
					throw new Error(
						`No active player (game_i_active = 1) found in ${file.name} — season objectives only exist in a played career.`,
					);
				}

				const gameDate = getGameDate(db);
				const season = gameDate != null ? Math.floor(gameDate / 10000) : null;
				const hasDifficulty = getTableColumnNames(db, "DYN_objectif").has(
					"value_i_difficulty",
				);

				const stmt = db.prepare(
					`SELECT
						o.IDobjectif           AS id,
						t.CONSTANT             AS type,
						t.gene_i_coeff         AS targetCoeff,
						a.CONSTANT             AS achievedType,
						a.gene_i_coeff         AS achievedCoeff,
						o.fkIDrace             AS raceId,
						r.gene_sz_race_name    AS raceName,
						fs.gene_i_computed_date AS startComputedDate,
						fs.gene_i_day          AS startDay,
						fs.gene_i_month        AS startMonth,
						ls.gene_i_computed_date AS endComputedDate,
						ls.gene_i_day          AS endDay,
						ls.gene_i_month        AS endMonth,
						o.fkIDcyclist          AS cyclistId,
						c.gene_sz_firstname    AS cyclistFirstName,
						c.gene_sz_lastname     AS cyclistLastName,
						${hasDifficulty ? "o.value_i_difficulty" : "NULL"} AS difficulty
					FROM DYN_objectif o
					JOIN STA_objectif_type t ON o.fkIDobjectif_type = t.IDobjectif_type
					LEFT JOIN STA_objectif_type a
						ON o.fkIDobjectif_type_achieved = a.IDobjectif_type
					LEFT JOIN STA_race r     ON o.fkIDrace = r.IDrace
					LEFT JOIN STA_stage fs   ON r.fkIDfirst_stage = fs.IDstage
					LEFT JOIN STA_stage ls   ON r.fkIDlast_stage = ls.IDstage
					LEFT JOIN DYN_cyclist c  ON o.fkIDcyclist = c.IDcyclist
					ORDER BY o.IDobjectif ASC`,
				);

				const objectives: z.infer<typeof objectiveSchema>[] = [];
				try {
					while (stmt.step()) {
						const row = stmt.getAsObject();
						const rawRaceId = row.raceId != null ? Number(row.raceId) : null;
						const rawCyclistId =
							row.cyclistId != null ? Number(row.cyclistId) : null;
						const targetCoeff =
							row.targetCoeff != null ? Number(row.targetCoeff) : null;
						const achievedCoeff =
							row.achievedType != null && row.achievedCoeff != null
								? Number(row.achievedCoeff)
								: null;

						const startDate = stageDate(
							row.startComputedDate,
							row.startDay,
							row.startMonth,
							season,
						);
						const endDate = stageDate(
							row.endComputedDate,
							row.endDay,
							row.endMonth,
							season,
						);

						objectives.push({
							id: Number(row.id),
							type: String(row.type),
							achievedType:
								row.achievedType != null ? String(row.achievedType) : null,
							status: objectiveStatus(
								targetCoeff,
								achievedCoeff,
								endDate,
								gameDate,
							),
							raceId: rawRaceId != null && rawRaceId > 0 ? rawRaceId : null,
							raceName: row.raceName != null ? String(row.raceName) : null,
							startDate,
							endDate,
							achievedByCyclistId:
								rawCyclistId != null && rawCyclistId > 0 ? rawCyclistId : null,
							achievedByCyclistName:
								row.cyclistLastName != null
									? `${row.cyclistFirstName ?? ""} ${row.cyclistLastName}`.trim()
									: null,
							difficulty:
								row.difficulty != null ? Number(row.difficulty) : null,
						});
					}
				} finally {
					stmt.free();
				}

				objectives.sort((a, b) => {
					if (a.startDate !== b.startDate) {
						if (a.startDate == null) {
							return 1;
						}
						if (b.startDate == null) {
							return -1;
						}
						return a.startDate < b.startDate ? -1 : 1;
					}
					return a.id - b.id;
				});

				const output: z.infer<typeof outputSchema> = {
					teamId: Number(teamId),
					season,
					objectives,
					seasonObjectives: readSeasonObjectives(db, Number(teamId)),
				};
				return output;
			}),
	);
}

/**
 * Where an objective stands, from the target and achieved coefficients and
 * whether the race is behind the current game date.
 *
 * PCM keeps no status of its own: it only stamps the best result achieved so
 * far on the objective, so a target missed and a target not yet played look
 * alike in the data. The race's last stage is what separates them — until the
 * game date passes it, the objective is still open, and anything already
 * achieved may still be improved on.
 */
function objectiveStatus(
	targetCoeff: number | null,
	achievedCoeff: number | null,
	endDate: string | null,
	gameDate: number | null,
): z.infer<typeof objectiveSchema>["status"] {
	if (
		achievedCoeff != null &&
		targetCoeff != null &&
		achievedCoeff >= targetCoeff
	) {
		return "ACHIEVED";
	}

	const endYmd = endDate != null ? Number(endDate.replaceAll("-", "")) : null;
	const over = gameDate != null && endYmd != null && gameDate > endYmd;
	if (!over) {
		return "IN_PROGRESS";
	}
	// A coefficient of 0 is PCM's floor (PARTICIPATION, RECORD): reaching it
	// says nothing was really achieved.
	return achievedCoeff != null && achievedCoeff > 0 ? "PARTIAL" : "FAILED";
}

/**
 * The sponsors' season-long objectives, which recent PCM editions keep in
 * `GAM_career_data` rather than in `DYN_objectif`: a number of wins to collect
 * and a ranking position to reach over the whole season. A `0` target means the
 * sponsors set no such objective, and an edition that pre-dates the feature has
 * neither key — both cases yield no entry.
 */
function readSeasonObjectives(
	db: CdbDatabase,
	teamId: number,
): z.infer<typeof seasonObjectiveSchema>[] {
	const seasonObjectives: z.infer<typeof seasonObjectiveSchema>[] = [];

	const winTarget = getCareerValue(db, "SPONSOR_OBJECTIVE_WIN");
	if (winTarget != null && winTarget > 0) {
		// The victories ranking counts a team's wins for the season.
		const wins = getTeamRanking(db, teamId, "VICTOIRES")?.points ?? null;
		seasonObjectives.push({
			type: "WINS",
			target: winTarget,
			current: wins,
			achieved: wins != null && wins >= winTarget,
		});
	}

	const rankTarget = getCareerValue(db, "SPONSOR_OBJECTIVE_RANKING");
	if (rankTarget != null && rankTarget > 0) {
		// SEASONAL is the ranking for the season under way; WORLD is the rolling
		// one older editions of this ranking system expose instead.
		const rank =
			getTeamRanking(db, teamId, "SEASONAL")?.rank ??
			getTeamRanking(db, teamId, "WORLD")?.rank ??
			null;
		const current = rank != null && rank > 0 ? rank : null;
		seasonObjectives.push({
			type: "RANKING",
			target: rankTarget,
			current,
			achieved: current != null && current <= rankTarget,
		});
	}

	return seasonObjectives;
}

/**
 * The team's row in one of PCM's rankings (`DYN_ranking`), looked up by the
 * ranking's `CONSTANT` — the numeric ids differ between editions.
 *
 * Returns null when the ranking doesn't exist in this database or the game has
 * never computed it, which is the case for every unplayed official release.
 */
function getTeamRanking(
	db: CdbDatabase,
	teamId: number,
	rankingConstant: string,
): { points: number; rank: number } | null {
	if (getTableColumnNames(db, "DYN_ranking").size === 0) {
		return null;
	}
	const result = db.exec(
		`SELECT r.value_i_points, r.value_i_rank
		FROM DYN_ranking r
		JOIN STA_ranking_type rt ON r.fkIDranking_type = rt.IDranking_type
		JOIN STA_ranking_item ri ON r.fkIDitem_type = ri.IDranking_item
		WHERE ri.CONSTANT = 'TEAM'
			AND rt.CONSTANT = $ranking
			AND r.fkIDitem = $teamId
		LIMIT 1`,
		{ $ranking: rankingConstant, $teamId: teamId },
	);
	const row = result[0]?.values?.[0];
	if (row == null) {
		return null;
	}
	return { points: Number(row[0]), rank: Number(row[1]) };
}
