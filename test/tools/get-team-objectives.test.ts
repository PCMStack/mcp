import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdbToSql } from "cdb-converter";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCdb } from "../../src/cdb";
import { registerGetTeamObjectives } from "../../src/tools/get-team-objectives";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

/** The PCM 2025 fixture, the only one whose schema has value_i_difficulty. */
const pcm2025 = databaseFixtures[databaseFixtures.length - 1][1];

/**
 * Copy the PCM 2025 fixture into `outputPath` with `statements` applied.
 *
 * An official release has no objectives — DYN_objectif is only filled by a
 * played career — so the join and mapping can only be exercised against a
 * database seeded here. The fixture itself is never touched: `writeCdb`
 * refuses to write over its source.
 */
async function seedDatabase(
	statements: string[],
	outputPath: string,
): Promise<string> {
	const SQL = await initSqlJs();
	const db = cdbToSql(await readFile(pcm2025), SQL, { preciseTypes: true });
	try {
		for (const statement of statements) {
			db.run(statement);
		}
		return await writeCdb(db, outputPath, pcm2025);
	} finally {
		db.close();
	}
}

/** Make the active human player manage team 1 on 5 June 2026. */
const startCareer = [
	"UPDATE GAM_config SET gene_i_date = 20260605",
	"UPDATE GAM_user SET game_i_active = 0",
	"UPDATE GAM_user SET game_i_active = 1, fkIDteam_duplicate = 1 WHERE IDuser = 1",
];

describe("getTeamObjectives", () => {
	let mcp: MockMcpServer;
	let outDir: string;

	beforeEach(async () => {
		mcp = createMockMcpServer();
		registerGetTeamObjectives(mcp.server);
		outDir = await mkdtemp(join(tmpdir(), "pcm-objectives-"));
	});

	afterEach(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it("registers the pcm_get_team_objectives tool", () => {
		expect(mcp.getTool("pcm_get_team_objectives")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it("takes no team, only a database path", () => {
		const inputSchema = mcp.getTool("pcm_get_team_objectives")?.config
			.inputSchema;

		expect(Object.keys(inputSchema)).toEqual(["databasePath"]);
	});

	// The objectives are the player's team's by construction, so without an
	// active player there is nothing to report — which is every official
	// release, none of which has ever been played.
	it.each(databaseFixtures)(
		"errors when there is no active player for %s",
		async (_, path) => {
			const result = await mcp.callTool("pcm_get_team_objectives", {
				databasePath: path,
			});

			expect(result.isError).toBe(true);
		},
	);

	it("returns no objectives for a career that has none", async () => {
		const databasePath = await seedDatabase(
			startCareer,
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			teamId: 1,
			season: 2026,
			objectives: [],
			seasonObjectives: [],
		});
	});

	it("returns the race objectives", async () => {
		const WIN = 1;
		const TOP_10 = 4;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				// A top-10 on Paris - Roubaix, already won by Davide Cimolai.
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${TOP_10}, 4, ${WIN}, 1, 10, 1945, 50000, 3, '()')`,
				// A win, nothing achieved yet, so no rider attached.
				`INSERT INTO DYN_objectif (${columns}) VALUES (2, ${WIN}, 0, 0, 1, 0, 0, 120000, 8, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			teamId: 1,
			season: 2026,
			objectives: [
				{
					id: 1,
					type: "TOP_10",
					achievedType: "WIN",
					status: "ACHIEVED",
					raceId: 4,
					raceName: "Paris - Roubaix",
					startDate: "2026-04-13",
					endDate: "2026-04-13",
					achievedByCyclistId: 1945,
					achievedByCyclistName: "Davide Cimolai",
					difficulty: 3,
				},
				{
					id: 2,
					type: "WIN",
					achievedType: null,
					status: "IN_PROGRESS",
					raceId: null,
					raceName: null,
					startDate: null,
					endDate: null,
					achievedByCyclistId: null,
					achievedByCyclistName: null,
					difficulty: 8,
				},
			],
			seasonObjectives: [],
		});
	});

	it("orders the objectives by date, undated ones last", async () => {
		const WIN = 1;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				// Seeded out of calendar order: race 25 runs in July, race 4 in April.
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${WIN}, 25, 0, 1, 0, 0, 50000, 3, '()')`,
				`INSERT INTO DYN_objectif (${columns}) VALUES (2, ${WIN}, 4, 0, 1, 0, 0, 50000, 3, '()')`,
				// No race at all, so nothing to place it in the calendar.
				`INSERT INTO DYN_objectif (${columns}) VALUES (3, ${WIN}, 0, 0, 1, 0, 0, 50000, 3, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		const objectives = (
			result.structuredContent as {
				objectives: { id: number; startDate: string | null }[];
			}
		).objectives;

		expect(objectives.map((objective) => objective.id)).toEqual([2, 1, 3]);
		expect(objectives.map((objective) => objective.startDate)).toEqual([
			"2026-04-13",
			"2026-07-05",
			null,
		]);
	});

	// A played career stamps the resolved date on the stage; the day/month
	// fallback only matters on a database the game has never advanced.
	it("dates the race from the stage computed date when the career has one", async () => {
		const TOP_10 = 4;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				// Tour de France (race 25), a stage race the career has dated.
				"UPDATE STA_stage SET gene_i_computed_date = 20260704 WHERE IDstage = (SELECT fkIDfirst_stage FROM STA_race WHERE IDrace = 25)",
				"UPDATE STA_stage SET gene_i_computed_date = 20260726 WHERE IDstage = (SELECT fkIDlast_stage FROM STA_race WHERE IDrace = 25)",
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${TOP_10}, 25, 0, 1, 10, 0, 50000, 3, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.structuredContent).toMatchObject({
			objectives: [{ startDate: "2026-07-04", endDate: "2026-07-26" }],
		});
	});

	// A result short of the target on a race that is over is a partial success,
	// so the status must compare the two coefficients rather than merely check
	// for a result.
	it("marks an objective partial when the result falls short of the target", async () => {
		const WIN = 1;
		const TOP_10 = 4;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				// Paris - Roubaix (race 4) ran in April, two months before the
				// current game date, so the top 10 is all this objective will get.
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${WIN}, 4, ${TOP_10}, 1, 0, 0, 50000, 3, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.structuredContent).toMatchObject({
			objectives: [{ type: "WIN", achievedType: "TOP_10", status: "PARTIAL" }],
		});
	});

	it("marks an objective failed when its race is over with nothing achieved", async () => {
		const WIN = 1;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${WIN}, 4, 0, 1, 0, 0, 50000, 3, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.structuredContent).toMatchObject({
			objectives: [{ type: "WIN", achievedType: null, status: "FAILED" }],
		});
	});

	// A stage race under way can already carry a result the rest of the race
	// may still improve on, so it stays open until its last stage is behind.
	it("keeps an objective in progress while its race has not finished", async () => {
		const WIN = 1;
		const TOP_10 = 4;
		const columns =
			"IDobjectif, fkIDobjectif_type, fkIDrace, fkIDobjectif_type_achieved, fkIDsponsor, value_i_rank, fkIDcyclist, value_f_dotation, value_i_difficulty, value_ilist_interest";

		const databasePath = await seedDatabase(
			[
				...startCareer,
				// The Tour de France (race 25) runs in July, after the game date.
				`INSERT INTO DYN_objectif (${columns}) VALUES (1, ${WIN}, 25, ${TOP_10}, 1, 0, 0, 50000, 3, '()')`,
			],
			join(outDir, "career.cdb"),
		);

		const result = await mcp.callTool("pcm_get_team_objectives", {
			databasePath,
		});

		expect(result.structuredContent).toMatchObject({
			objectives: [
				{ type: "WIN", achievedType: "TOP_10", status: "IN_PROGRESS" },
			],
		});
	});
	// The season-long objectives live outside DYN_objectif: recent editions keep
	// them in GAM_career_data, with the team's standing in DYN_ranking.
	describe("season objectives", () => {
		const rankingColumns =
			"IDranking, fkIDitem_type, fkIDranking_type, fkIDitem, value_i_points, value_i_rank, value_i_last_rank, value_i_conti_rank, value_i_conti_last_rank";
		const TEAM = 3;
		const VICTOIRES = 3;
		const SEASONAL = 6;

		it("reports the wins and ranking targets with the team's standing", async () => {
			const databasePath = await seedDatabase(
				[
					...startCareer,
					"UPDATE GAM_career_data SET value = 12 WHERE CONSTANT = 'SPONSOR_OBJECTIVE_WIN'",
					"UPDATE GAM_career_data SET value = 5 WHERE CONSTANT = 'SPONSOR_OBJECTIVE_RANKING'",
					// 14 wins so far, but only 9th in the seasonal ranking.
					`INSERT INTO DYN_ranking (${rankingColumns}) VALUES (1, ${TEAM}, ${VICTOIRES}, 1, 14, 2, 2, 0, 0)`,
					`INSERT INTO DYN_ranking (${rankingColumns}) VALUES (2, ${TEAM}, ${SEASONAL}, 1, 850, 9, 8, 0, 0)`,
				],
				join(outDir, "career.cdb"),
			);

			const result = await mcp.callTool("pcm_get_team_objectives", {
				databasePath,
			});

			expect(result.isError).toBeFalsy();
			expect(result.structuredContent).toMatchObject({
				seasonObjectives: [
					{ type: "WINS", target: 12, current: 14, achieved: true },
					{ type: "RANKING", target: 5, current: 9, achieved: false },
				],
			});
		});

		// Another team's rows must not be mistaken for the player's.
		it("ignores rankings that belong to another team", async () => {
			const databasePath = await seedDatabase(
				[
					...startCareer,
					"UPDATE GAM_career_data SET value = 12 WHERE CONSTANT = 'SPONSOR_OBJECTIVE_WIN'",
					`INSERT INTO DYN_ranking (${rankingColumns}) VALUES (1, ${TEAM}, ${VICTOIRES}, 2, 14, 1, 1, 0, 0)`,
				],
				join(outDir, "career.cdb"),
			);

			const result = await mcp.callTool("pcm_get_team_objectives", {
				databasePath,
			});

			expect(result.structuredContent).toMatchObject({
				seasonObjectives: [
					{ type: "WINS", target: 12, current: null, achieved: false },
				],
			});
		});

		// A career the game has not yet ranked leaves the standing unknown, which
		// is not the same as having missed the objective.
		it("leaves the standing null when the game has computed no ranking", async () => {
			const databasePath = await seedDatabase(
				[
					...startCareer,
					"UPDATE GAM_career_data SET value = 3 WHERE CONSTANT = 'SPONSOR_OBJECTIVE_RANKING'",
				],
				join(outDir, "career.cdb"),
			);

			const result = await mcp.callTool("pcm_get_team_objectives", {
				databasePath,
			});

			expect(result.structuredContent).toMatchObject({
				seasonObjectives: [
					{ type: "RANKING", target: 3, current: null, achieved: false },
				],
			});
		});

		// A zero target is PCM's "the sponsors asked for nothing", not a goal of
		// zero wins — and it is what an untouched career carries.
		it("skips a target the sponsors did not set", async () => {
			const databasePath = await seedDatabase(
				startCareer,
				join(outDir, "career.cdb"),
			);

			const result = await mcp.callTool("pcm_get_team_objectives", {
				databasePath,
			});

			expect(result.structuredContent).toMatchObject({ seasonObjectives: [] });
		});
	});
});
