import { cdbToSql } from "cdb-converter";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { registerUpdateCyclistRatings } from "../../src/tools/update-cyclist-ratings";
import { databaseFixtures } from "../fixtures/database.fixture";
import type { MockMcpServer } from "../mocks/mock-mcp-server";
import { createMockMcpServer } from "../mocks/mock-mcp-server";

/** Read the first cyclist ID out of a `.cdb` file. */
async function readFirstCyclistId(cdbPath: string): Promise<number> {
	const SQL = await initSqlJs();
	const db = cdbToSql(await readFile(cdbPath), SQL);
	try {
		const result = db.exec(
			"SELECT IDcyclist FROM DYN_cyclist ORDER BY IDcyclist LIMIT 1",
		);
		return Number(result[0]?.values?.[0]?.[0]);
	} finally {
		db.close();
	}
}

/** Read a cyclist's rating columns back out of a written `.cdb` file. */
async function readRatings(
	cdbPath: string,
	cyclistId: number,
	columns: string[],
): Promise<number[]> {
	const SQL = await initSqlJs();
	const db = cdbToSql(await readFile(cdbPath), SQL);
	try {
		const result = db.exec(
			`SELECT ${columns.join(", ")} FROM DYN_cyclist WHERE IDcyclist = ${cyclistId}`,
		);
		return (result[0]?.values?.[0] ?? []).map(Number);
	} finally {
		db.close();
	}
}

describe("updateCyclistRatings", () => {
	let mcp: MockMcpServer;
	let outDir: string;

	const inputSchema = () =>
		z.object(mcp.getTool("pcm_update_cyclist_ratings")?.config.inputSchema);

	const parseArgs = (args: Record<string, unknown>) =>
		inputSchema().parse(args) as Record<string, unknown>;

	beforeEach(async () => {
		mcp = createMockMcpServer();
		registerUpdateCyclistRatings(mcp.server);
		outDir = await mkdtemp(join(tmpdir(), "pcm-ratings-"));
	});

	afterEach(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it("registers the pcm_update_cyclist_ratings tool", () => {
		expect(mcp.getTool("pcm_update_cyclist_ratings")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"updates ratings and writes the change to a new .cdb for %s",
		async (_name, path) => {
			const cyclistId = await readFirstCyclistId(path);
			const outputPath = join(outDir, "edited.cdb");

			const result = await mcp.callTool("pcm_update_cyclist_ratings", {
				databasePath: path,
				outputPath,
				cyclistId,
				ratings: { sprint: 81, mountain: 72 },
			});

			expect(result.isError).toBeUndefined();
			expect(result.structuredContent).toMatchObject({
				outputPath,
				cyclist: {
					id: cyclistId,
					sprint: 81,
					mountain: 72,
				},
			});
			expect(
				await readRatings(outputPath, cyclistId, [
					"charac_i_sprint",
					"charac_i_mountain",
				]),
			).toEqual([81, 72]);
		},
	);

	it.each(databaseFixtures)(
		"only changes the ratings that were passed for %s",
		async (_name, path) => {
			const cyclistId = await readFirstCyclistId(path);
			const before = await readRatings(path, cyclistId, [
				"charac_i_plain",
				"charac_i_cobble",
			]);
			const outputPath = join(outDir, "edited.cdb");

			await mcp.callTool("pcm_update_cyclist_ratings", {
				databasePath: path,
				outputPath,
				cyclistId,
				ratings: { sprint: 81 },
			});

			expect(
				await readRatings(outputPath, cyclistId, [
					"charac_i_plain",
					"charac_i_cobble",
				]),
			).toEqual(before);
		},
	);

	it.each(databaseFixtures)(
		"errors on an unknown cyclist ID for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_update_cyclist_ratings", {
				databasePath: path,
				outputPath: join(outDir, "edited.cdb"),
				cyclistId: 999999999,
				ratings: { sprint: 81 },
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: "No cyclist with IDcyclist = 999999999 in this database — use pcm_search_cyclist to find the right ID.",
			});
		},
	);

	it.each(databaseFixtures)(
		"errors when no rating is provided for %s",
		async (_name, path) => {
			const cyclistId = await readFirstCyclistId(path);
			const result = await mcp.callTool("pcm_update_cyclist_ratings", {
				databasePath: path,
				outputPath: join(outDir, "edited.cdb"),
				cyclistId,
				ratings: {},
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: "Provide at least one rating to change in `ratings`.",
			});
		},
	);

	it.each(databaseFixtures)(
		"accepts the lowest allowed rating (50) for %s",
		async (_name, path) => {
			const cyclistId = await readFirstCyclistId(path);
			const outputPath = join(outDir, "edited.cdb");

			const result = await mcp.callTool(
				"pcm_update_cyclist_ratings",
				parseArgs({
					databasePath: path,
					outputPath,
					cyclistId,
					ratings: { sprint: 50 },
				}),
			);

			expect(result.isError).toBeUndefined();
			expect(
				await readRatings(outputPath, cyclistId, ["charac_i_sprint"]),
			).toEqual([50]);
		},
	);

	it("rejects a rating below the minimum (49)", () => {
		const result = inputSchema().safeParse({
			databasePath: "/saves/career.cdb",
			outputPath: "/saves/edited.cdb",
			cyclistId: 1,
			ratings: { sprint: 49 },
		});

		expect(result.success).toBe(false);
		expect(result.error?.issues[0]).toMatchObject({
			path: ["ratings", "sprint"],
			code: "too_small",
			minimum: 50,
		});
	});

	it.each(
		databaseFixtures.filter(([, , hasMediumMountain]) => hasMediumMountain),
	)("sets mediumMountain for %s", async (_name, path) => {
		const cyclistId = await readFirstCyclistId(path);
		const outputPath = join(outDir, "edited.cdb");
		const result = await mcp.callTool("pcm_update_cyclist_ratings", {
			databasePath: path,
			outputPath,
			cyclistId,
			ratings: { mediumMountain: 77 },
		});

		expect(result.isError).toBeUndefined();
		expect(
			await readRatings(outputPath, cyclistId, ["charac_i_medium_mountain"]),
		).toEqual([77]);
	});

	it.each(
		databaseFixtures.filter(([, , hasMediumMountain]) => !hasMediumMountain),
	)(
		"rejects mediumMountain on databases that pre-date the column for %s",
		async (_name, path) => {
			const cyclistId = await readFirstCyclistId(path);
			const result = await mcp.callTool("pcm_update_cyclist_ratings", {
				databasePath: path,
				outputPath: join(outDir, "edited.cdb"),
				cyclistId,
				ratings: { mediumMountain: 77 },
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: "This database pre-dates the charac_i_medium_mountain column — mediumMountain cannot be set on it.",
			});
		},
	);
});
