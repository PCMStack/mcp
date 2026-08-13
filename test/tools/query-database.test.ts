import { beforeEach, describe, expect, it } from "vitest";
import {
	assertReadOnlyQuery,
	registerQueryDatabase,
} from "../../src/tools/query-database";
import { databaseFixtures } from "../fixtures/database.fixture";
import { createMockMcpServer } from "../mocks/mock-mcp-server";
import type { MockMcpServer } from "../mocks/mock-mcp-server";

describe("queryDatabase", () => {
	let mcp: MockMcpServer;

	beforeEach(() => {
		mcp = createMockMcpServer();
		registerQueryDatabase(mcp.server);
	});

	it("registers the pcm_query_database tool", () => {
		expect(mcp.getTool("pcm_query_database")).toBeDefined();
		expect(mcp.registerTool).toHaveBeenCalledOnce();
	});

	it.each(databaseFixtures)(
		"runs a read-only SELECT against %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_query_database", {
				databasePath: path,
				query: "SELECT COUNT(*) AS n FROM STA_race",
			});

			expect(result.isError).toBeUndefined();
			expect(result.structuredContent).toMatchObject({ rowCount: 1 });
		},
	);

	it.each(databaseFixtures)(
		"rejects a WITH … DELETE CTE for %s",
		async (_name, path) => {
			const result = await mcp.callTool("pcm_query_database", {
				databasePath: path,
				query: "WITH x AS (SELECT 1) DELETE FROM STA_race",
			});

			expect(result.isError).toBe(true);
			expect(result.content).toEqual([
				{
					type: "text",
					text: "Only read-only SELECT (or WITH … SELECT) queries are allowed.",
				},
			]);
		},
	);

	describe("assertReadOnlyQuery", () => {
		describe("allowed queries", () => {
			it("accepts a simple SELECT", () => {
				const q = "SELECT * FROM DYN_cyclist";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts SELECT with a trailing semicolon (strips it)", () => {
				expect(assertReadOnlyQuery("SELECT 1;")).toBe("SELECT 1");
			});

			it("accepts SELECT with trailing semicolon and whitespace", () => {
				// trim() runs before the semicolon strip, so a space before ';' is preserved
				expect(assertReadOnlyQuery("SELECT 1 ;  ")).toBe("SELECT 1 ");
			});

			it("accepts SELECT with leading/trailing whitespace", () => {
				expect(assertReadOnlyQuery("  SELECT id FROM foo  ")).toBe(
					"SELECT id FROM foo",
				);
			});

			it("accepts a WITH … SELECT (CTE)", () => {
				const q =
					"WITH cte AS (SELECT id FROM foo) SELECT * FROM cte WHERE id > 5";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts lowercase select", () => {
				expect(assertReadOnlyQuery("select * from bar")).toBe(
					"select * from bar",
				);
			});

			it("accepts mixed-case SELECT", () => {
				expect(assertReadOnlyQuery("Select id From foo")).toBe(
					"Select id From foo",
				);
			});

			it("accepts SELECT containing a column named 'update_date' (keyword inside identifier)", () => {
				const q = "SELECT update_date FROM DYN_cyclist";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts a SELECT whose string literal contains a keyword like 'create'", () => {
				const q = "SELECT * FROM foo WHERE name LIKE '%create%'";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts a SELECT with a semicolon inside a string literal", () => {
				const q = "SELECT ';' AS semi";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts a SELECT whose WHERE literal contains a semicolon", () => {
				const q = "SELECT * FROM foo WHERE note = 'a;b'";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts a SELECT with a semicolon inside a quoted identifier", () => {
				const q = 'SELECT "weird;col" FROM foo';
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts a SELECT with a semicolon inside a comment", () => {
				const q = "SELECT 1 -- ; not a statement";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("keeps the trailing-semicolon strip working alongside a literal semicolon", () => {
				expect(assertReadOnlyQuery("SELECT ';' AS semi;")).toBe(
					"SELECT ';' AS semi",
				);
			});

			it("accepts a SELECT using the read-only REPLACE() function", () => {
				const q = "SELECT REPLACE(name,'a','b') FROM foo";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts SELECT with ORDER BY, LIMIT, GROUP BY", () => {
				const q =
					"SELECT name, COUNT(*) AS n FROM foo GROUP BY name ORDER BY n DESC LIMIT 10";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});

			it("accepts SELECT with a JOIN", () => {
				const q = "SELECT a.id, b.name FROM a INNER JOIN b ON a.id = b.a_id";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});
		});

		describe("empty / blank queries", () => {
			it("rejects an empty string", () => {
				expect(() => assertReadOnlyQuery("")).toThrowError("Query is empty.");
			});

			it("rejects a string that is only whitespace", () => {
				expect(() => assertReadOnlyQuery("   ")).toThrowError(
					"Query is empty.",
				);
			});

			it("rejects a bare semicolon", () => {
				expect(() => assertReadOnlyQuery(";")).toThrowError("Query is empty.");
			});

			it("rejects whitespace + semicolon", () => {
				expect(() => assertReadOnlyQuery("  ;  ")).toThrowError(
					"Query is empty.",
				);
			});
		});

		describe("multiple statements", () => {
			it("rejects two SELECT statements separated by a semicolon", () => {
				expect(() => assertReadOnlyQuery("SELECT 1; SELECT 2")).toThrowError(
					"Only a single statement is allowed",
				);
			});

			it("rejects SELECT followed by a write statement", () => {
				expect(() =>
					assertReadOnlyQuery("SELECT 1; DROP TABLE foo"),
				).toThrowError("Only a single statement is allowed");
			});
		});

		describe("non-SELECT openers", () => {
			it("rejects a bare INSERT", () => {
				expect(() =>
					assertReadOnlyQuery("INSERT INTO foo VALUES (1)"),
				).toThrowError("Only read-only SELECT");
			});

			it("rejects UPDATE", () => {
				expect(() =>
					assertReadOnlyQuery("UPDATE foo SET bar = 1"),
				).toThrowError("Only read-only SELECT");
			});

			it("rejects DELETE", () => {
				expect(() => assertReadOnlyQuery("DELETE FROM foo")).toThrowError(
					"Only read-only SELECT",
				);
			});

			it("rejects DROP TABLE", () => {
				expect(() => assertReadOnlyQuery("DROP TABLE foo")).toThrowError(
					"Only read-only SELECT",
				);
			});

			it("rejects CREATE TABLE", () => {
				expect(() =>
					assertReadOnlyQuery("CREATE TABLE foo (id INTEGER)"),
				).toThrowError("Only read-only SELECT");
			});

			it("rejects PRAGMA", () => {
				expect(() =>
					assertReadOnlyQuery("PRAGMA table_info(foo)"),
				).toThrowError("Only read-only SELECT");
			});
		});

		describe("ATTACH / DETACH", () => {
			it("rejects ATTACH stacked after a SELECT", () => {
				expect(() =>
					assertReadOnlyQuery("SELECT * FROM foo; ATTACH DATABASE 'x' AS y"),
				).toThrowError("Only a single statement is allowed");
			});

			it("rejects ATTACH as a standalone statement opener", () => {
				expect(() =>
					assertReadOnlyQuery("ATTACH DATABASE 'evil.db' AS e"),
				).toThrowError("Only read-only SELECT");
			});

			it("rejects DETACH as a standalone statement opener", () => {
				expect(() => assertReadOnlyQuery("DETACH DATABASE e")).toThrowError(
					"Only read-only SELECT",
				);
			});
		});

		describe("write detection via the statement identifier", () => {
			it("rejects a WITH … DELETE CTE (write behind a read opener)", () => {
				expect(() =>
					assertReadOnlyQuery("WITH x AS (SELECT 1) DELETE FROM foo"),
				).toThrowError("Only read-only SELECT");
			});

			it("rejects a WITH … INSERT CTE", () => {
				expect(() =>
					assertReadOnlyQuery(
						"WITH x AS (SELECT 1) INSERT INTO foo SELECT * FROM x",
					),
				).toThrowError("Only read-only SELECT");
			});

			it("accepts a SELECT merely mentioning a write keyword in a literal", () => {
				const q = "SELECT * FROM foo WHERE note = 'please update'";
				expect(assertReadOnlyQuery(q)).toBe(q);
			});
		});
	});
});
