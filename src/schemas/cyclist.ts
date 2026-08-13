import { z } from "zod";

/**
 * Per-terrain ability ratings shared by every tool that returns a cyclist
 * (`pcm_search_cyclist`, `pcm_get_team_roster`). These map one-to-one to the
 * `charac_i_*` columns on `DYN_cyclist`.
 *
 * Spread `ratingsSchema.shape` into a cyclist's output schema to keep the
 * ratings flat, and use {@link mapRatings} to read them off a result row (both
 * expect the columns to be aliased to the field names below).
 */
export const ratingsSchema = z.object({
	plain: z.number().describe("Plain rating (charac_i_plain)"),
	mountain: z.number().describe("Mountain rating (charac_i_mountain)"),
	mediumMountain: z
		.number()
		.nullable()
		.describe(
			"Medium mountain rating (charac_i_medium_mountain) — null on databases that pre-date this column",
		),
	downhilling: z.number().describe("Downhilling rating (charac_i_downhilling)"),
	cobble: z.number().describe("Cobblestone rating (charac_i_cobble)"),
	timeTrial: z.number().describe("Time trial rating (charac_i_timetrial)"),
	prologue: z.number().describe("Prologue rating (charac_i_prologue)"),
	sprint: z.number().describe("Sprint rating (charac_i_sprint)"),
	acceleration: z
		.number()
		.describe("Acceleration rating (charac_i_acceleration)"),
	endurance: z.number().describe("Endurance rating (charac_i_endurance)"),
	resistance: z.number().describe("Resistance rating (charac_i_resistance)"),
	recuperation: z
		.number()
		.describe("Recuperation rating (charac_i_recuperation)"),
	hill: z.number().describe("Hill rating (charac_i_hill)"),
	baroudeur: z.number().describe("Baroudeur rating (charac_i_baroudeur)"),
});

/**
 * Maps each {@link ratingsSchema} field to its `DYN_cyclist` column. Single
 * source of truth for tools that write ratings back (the read path keeps its
 * own aliased fragment in {@link ratingsColumns}).
 */
export const ratingColumns = {
	plain: "charac_i_plain",
	mountain: "charac_i_mountain",
	mediumMountain: "charac_i_medium_mountain",
	downhilling: "charac_i_downhilling",
	cobble: "charac_i_cobble",
	timeTrial: "charac_i_timetrial",
	prologue: "charac_i_prologue",
	sprint: "charac_i_sprint",
	acceleration: "charac_i_acceleration",
	endurance: "charac_i_endurance",
	resistance: "charac_i_resistance",
	recuperation: "charac_i_recuperation",
	hill: "charac_i_hill",
	baroudeur: "charac_i_baroudeur",
} as const satisfies Record<keyof z.infer<typeof ratingsSchema>, string>;

export type RatingField = keyof typeof ratingColumns;

/** SQL `SELECT` fragment that aliases the rating columns to {@link ratingsSchema}'s
 * field names. `mediumMountain` falls back to `NULL` on databases that pre-date the
 * `charac_i_medium_mountain` column. */
export function ratingsColumns(hasMediumMountain: boolean): string {
	return `c.charac_i_plain           AS plain,
			c.charac_i_mountain        AS mountain,
			${hasMediumMountain ? "c.charac_i_medium_mountain" : "NULL"} AS mediumMountain,
			c.charac_i_downhilling     AS downhilling,
			c.charac_i_cobble          AS cobble,
			c.charac_i_timetrial       AS timeTrial,
			c.charac_i_prologue        AS prologue,
			c.charac_i_sprint          AS sprint,
			c.charac_i_acceleration    AS acceleration,
			c.charac_i_endurance       AS endurance,
			c.charac_i_resistance      AS resistance,
			c.charac_i_recuperation    AS recuperation,
			c.charac_i_hill            AS hill,
			c.charac_i_baroudeur       AS baroudeur`;
}

/** Read the rating fields off a query row aliased per {@link ratingsColumns}. */
export function mapRatings(
	row: Record<string, unknown>,
): z.infer<typeof ratingsSchema> {
	return {
		plain: Number(row.plain),
		mountain: Number(row.mountain),
		mediumMountain:
			row.mediumMountain != null ? Number(row.mediumMountain) : null,
		downhilling: Number(row.downhilling),
		cobble: Number(row.cobble),
		timeTrial: Number(row.timeTrial),
		prologue: Number(row.prologue),
		sprint: Number(row.sprint),
		acceleration: Number(row.acceleration),
		endurance: Number(row.endurance),
		resistance: Number(row.resistance),
		recuperation: Number(row.recuperation),
		hill: Number(row.hill),
		baroudeur: Number(row.baroudeur),
	};
}
