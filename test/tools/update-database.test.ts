import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdbToSql } from "cdb-converter";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertWriteStatement,
	registerUpdateDatabase,
} from "../../src/tools/update-database";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

/** Read `GAM_config.gene_i_date` back out of a written `.cdb` file. */
async function readGameDate(cdbPath: string): Promise<number> {
	const SQL = await initSqlJs();
	const db = cdbToSql(await readFile(cdbPath), SQL);
	try {
		const result = db.exec("SELECT gene_i_date FROM GAM_config LIMIT 1");
		return Number(result[0]?.values?.[0]?.[0]);
	} finally {
		db.close();
	}
}

describe("updateDatabase", () => {
	let mcp: MockMcpServer;
	let outDir: string;

	beforeEach(async () => {
		mcp = createMockMcpServer();
		registerUpdateDatabase(mcp.server);
		outDir = await mkdtemp(join(tmpdir(), "pcm-update-"));
	});

	afterEach(async () => {
		await rm(outDir, { recursive: true, force: true });
	});

	it("registers the pcm_update_database tool", () => {
		expect(mcp.getTool("pcm_update_database")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"applies an UPDATE and writes the change to a new .cdb for %s",
		async (_name, path) => {
			const outputPath = join(outDir, "edited.cdb");
			const result = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			expect(result.isError).toBeUndefined();
			expect(result.structuredContent).toMatchObject({
				outputPath,
				rowsModified: 1,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			// The change must actually persist in the written file.
			expect(await readGameDate(outputPath)).toBe(20991231);
		},
	);

	it.each(databaseFixtures)(
		"leaves the source save untouched for %s",
		async (_name, path) => {
			const before = await stat(path);
			const outputPath = join(outDir, "edited.cdb");

			await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			const after = await stat(path);
			expect(after.size).toBe(before.size);
			expect(after.mtimeMs).toBe(before.mtimeMs);
		},
	);

	it.each(databaseFixtures)(
		"refuses to overwrite the source database for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath: path,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: "outputPath must differ from the source database — the input .cdb is never overwritten.",
			});
		},
	);

	it.each(databaseFixtures)(
		"rejects a non-.cdb output path for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath: join(outDir, "edited.txt"),
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: expect.stringMatching(/must be a \.cdb file/),
			});
		},
	);

	it.each(databaseFixtures)(
		"refuses to overwrite an existing output file for %s",
		async (_name, path) => {
			const outputPath = join(outDir, "edited.cdb");
			// First write succeeds and creates the file.
			const first = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});
			expect(first.isError).toBeUndefined();

			// A second write to the same path must not clobber it.
			const second = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath,
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});
			expect(second.isError).toBe(true);
			expect(second.content[0]).toEqual({
				type: "text",
				text: expect.stringMatching(/already exists/),
			});
		},
	);

	it.each(databaseFixtures)(
		"errors when the output directory does not exist for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath: join(outDir, "missing", "edited.cdb"),
				statement: "UPDATE GAM_config SET gene_i_date = 20991231",
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: expect.stringMatching(/Output directory does not exist/),
			});
		},
	);

	it.each(databaseFixtures)(
		"maps a missing table to a schema-discovery hint for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_update_database", {
				databasePath: path,
				outputPath: join(outDir, "edited.cdb"),
				statement: "UPDATE not_a_table SET x = 1",
			});

			expect(result.isError).toBe(true);
			expect(result.content[0]).toEqual({
				type: "text",
				text: 'Table "not_a_table" does not exist in this database — use pcm_list_tables to list available tables.',
			});
		},
	);

	describe("assertWriteStatement", () => {
		describe("allowed statements", () => {
			it("accepts an UPDATE", () => {
				const s = "UPDATE foo SET bar = 1";
				expect(assertWriteStatement(s)).toBe(s);
			});

			it("accepts an INSERT", () => {
				const s = "INSERT INTO foo (id) VALUES (1)";
				expect(assertWriteStatement(s)).toBe(s);
			});

			it("accepts a DELETE", () => {
				const s = "DELETE FROM foo WHERE id = 1";
				expect(assertWriteStatement(s)).toBe(s);
			});

			it("strips a single trailing semicolon", () => {
				expect(assertWriteStatement("DELETE FROM foo;")).toBe(
					"DELETE FROM foo",
				);
			});

			it("trims surrounding whitespace", () => {
				expect(assertWriteStatement("  UPDATE foo SET x = 1  ")).toBe(
					"UPDATE foo SET x = 1",
				);
			});

			it("accepts a lowercase opener", () => {
				expect(assertWriteStatement("update foo set x = 1")).toBe(
					"update foo set x = 1",
				);
			});

			it("accepts a semicolon inside a string literal", () => {
				const s = "UPDATE foo SET note = ';'";
				expect(assertWriteStatement(s)).toBe(s);
			});

			it("accepts a WITH … UPDATE CTE (write behind a CTE)", () => {
				const s = "WITH x AS (SELECT 1) UPDATE foo SET a = 1";
				expect(assertWriteStatement(s)).toBe(s);
			});
		});

		describe("empty / blank statements", () => {
			it("rejects an empty string", () => {
				expect(() => assertWriteStatement("")).toThrowError(
					"Statement is empty.",
				);
			});

			it("rejects a bare semicolon", () => {
				expect(() => assertWriteStatement(";")).toThrowError(
					"Statement is empty.",
				);
			});
		});

		describe("multiple statements", () => {
			it("rejects two statements separated by a semicolon", () => {
				expect(() =>
					assertWriteStatement("UPDATE foo SET x = 1; DELETE FROM foo"),
				).toThrowError("Only a single statement is allowed");
			});
		});

		describe("disallowed openers", () => {
			it("rejects a SELECT", () => {
				expect(() => assertWriteStatement("SELECT * FROM foo")).toThrowError(
					"Only a single INSERT, UPDATE or DELETE",
				);
			});

			it("rejects a WITH … SELECT (a read behind a CTE)", () => {
				expect(() =>
					assertWriteStatement("WITH x AS (SELECT 1) SELECT * FROM x"),
				).toThrowError("Only a single INSERT, UPDATE or DELETE");
			});

			it("rejects DROP TABLE", () => {
				expect(() => assertWriteStatement("DROP TABLE foo")).toThrowError(
					"Only a single INSERT, UPDATE or DELETE",
				);
			});

			it("rejects CREATE TABLE", () => {
				expect(() =>
					assertWriteStatement("CREATE TABLE foo (id INTEGER)"),
				).toThrowError("Only a single INSERT, UPDATE or DELETE");
			});

			it("rejects ATTACH as a standalone opener", () => {
				expect(() =>
					assertWriteStatement("ATTACH DATABASE 'evil.db' AS e"),
				).toThrowError("Only a single INSERT, UPDATE or DELETE");
			});
		});
	});
});
